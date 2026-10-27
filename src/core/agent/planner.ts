import { completeChat } from "@/integrations/meterless/client";
import { getEnv } from "@/lib/env";
import { createId } from "@/lib/ids";
import {
  deliberateHeuristicDiagnosis,
  diagnoseMeterlessFailure,
} from "./fallback-diagnosis";
import type { ProviderFallbackDiagnosis } from "@/core/traces/trace-types";
import { getToolPermission } from "@/core/warden/policy";
import { cleanMemoryQuery } from "@/core/memory/retriever";
import { translateRequestToCalcExpressions } from "@/core/execution/calc";
import type { AgentPlan, InferenceMode, PlannedAction, PlanStep } from "./types";

const PLAN_SCHEMA = `Return JSON only:
{"summary": string, "steps": [{"title": string, "instruction": string, "tool": string | null, "args": object, "target": string | null}]}
Allowed tools: fs.list, fs.read, fs.write, notes.create, memory.search, memory.store, calc.evaluate, run_sql, subagent.spawn, skill.invoke.
For requests about Zetaris data, use run_sql instead of memory.search or workspace tools. Use one read-only SELECT.
Never use shell.exec, http.fetch, or fs.delete unless the user explicitly asked; Warden will deny them.
Keep args workspace-relative. Prefer notes.create for short notes.`;

export function isSupportedZetarisDemoRequest(request: string): boolean {
  return /pokeapi\.pikachu_abilities_table|pikachu.{0,80}abilit|abilit.{0,80}pikachu/i.test(
    request,
  );
}

export type RequestIntent = "memory-recall" | "memory-store" | "direct-answer" | "tool-action";

/** True for question-shaped requests (trailing "?", a reply directive, or a
 *  leading question/answer verb). Mirrors the routing gate below; exported so
 *  plan-shape rules and tests share one definition. */
export function isQuestionLike(request: string): boolean {
  const text = request.toLowerCase();
  return (
    /\?/.test(text) ||
    /\breply\b/.test(text) ||
    /(^|\n)(is|are|what|which|who|when|where|why|how|list|name|explain|describe|reply|compute|calculate|evaluate|sort|repeat|reverse|count|convert|compare|increase|say|output|give|write|extract|summarize|summarise|translate)\b/.test(text) ||
    /(^|\n)(in a single sentence|in two|compare)\b/.test(text)
  );
}

/** True when the request asks HOW to perform an action (a safe method or an
 *  explanation) rather than requesting the action itself. General-purpose
 *  phrasing only: "what is the safe/best way", "what is the recommended
 *  method", "how do/can I". Never matches a benchmark, case ID, tool name,
 *  or expected answer. */
export function isAdvisoryHowTo(request: string): boolean {
  const text = request.toLowerCase();
  if (
    /\bwhat(?:'s|\u2019s| is| are)\b.{0,48}\b(safe|safer|safest|correct|best|recommended|proper|right|easiest|preferred)\b.{0,32}\b(way|method|approach|practice|practices)\b/.test(
      text,
    )
  )
    return true;
  if (/\bhow\b.{0,20}\b(do|can|should|would|might)\b.{0,20}\bi\b/.test(text)) return true;
  return false;
}

/** Analysis step that composes the user-facing answer from observed fs.list
 *  entries. Appended only to question-like tool plans that would otherwise
 *  end with raw context-only output and no verifiable answer. */
export function workspaceAnswerStep(): PlanStep {
  const answer = stepFromAction(
    "Answer from the observed workspace listing",
    "Answer the user's question using ONLY the file and directory names observed in the fs.list output above. If the listing is empty, say so explicitly instead of inventing entries. Do not call further tools.",
  );
  answer.analysis = true;
  answer.expectGrounding = "workspace";
  return answer;
}

/** True when a question-like plan executes fs.list but carries no answer
 *  step, so verification could only see context-only output. Narrow: pure
 *  action imperatives and plans that already answer are untouched. */
export function needsWorkspaceAnswerStep(steps: PlanStep[], request: string): boolean {
  if (!isQuestionLike(request)) return false;
  if (steps.some((step) => step.analysis === true)) return false;
  return steps.some((step) => step.action?.tool === "fs.list");
}

/** General intent classification. No benchmark or case IDs; purely phrasing-based.
 *  Order of precedence is enforced by callers: Zetaris policy route first,
 *  dangerous-action route second, then this classifier. */
export function classifyIntent(request: string): RequestIntent {
  const text = request.toLowerCase();
  const memoryRecall =
    /\bmemor(y|ies)\b/.test(text) ||
    /\brecall\b/.test(text) ||
    /\bremember\b.{0,12}\?/.test(text) ||
    /^(from|in|using)\b.{0,28}\bmemory\b/.test(text) ||
    /what do you remember|do you remember/.test(text) ||
    /\b(what|which|who|when|where)\b.{0,40}\bmy\b/.test(text) ||
    /\bmy\b.{0,12}(favorite|favourite|preferred|settings|deadline|contact|lead|window|quota|slo|owner|policy|language|region|bucket|code)\b/.test(text);
  // Past-decision recall without explicit memory keywords: "Find the earlier
  // decision about X", "What did we decide?". Requires BOTH a decision noun
  // and a past-reference marker so forward-looking requests ("Make a decision
  // about lunch", "What is the deployment outcome?") are not captured.
  const pastDecisionRecall =
    /\b(decision|decided|decide|conclusion|constraint|agreement|outcome|resolution)\b/.test(text) &&
    /\b(earlier|previous|previously|last time|did we|what was|what were|recall|remember)\b/.test(text);
  // Past-tense verbs ("we decided/agreed/...") imply a prior decision;
    // base forms are only recall when anchored by past auxiliary "did we".
    // This keeps forward-looking "We should agree/decide ..." out of recall.
    const weDecidedRecall =
    /\bwe\b.{0,16}\b(decided|agreed|said|chose|picked|discussed)\b/.test(text) ||
    /\bdid we\b.{0,16}\b(decide|agree|choose|pick|say|discuss)\b/.test(text);
  if (memoryRecall || pastDecisionRecall || weDecidedRecall) return "memory-recall";
  const memoryStore =
    /^\s*(remember|note down|store|save|do not forget|don't forget)\b/.test(text) ||
    /\bremember that\b|\bdo not forget that\b/.test(text);
  if (memoryStore) return "memory-store";
  // Direct informational/transformational questions: answerable from the prompt
  // itself or general knowledge. No tools, no filesystem/memory mutations.
  const questionLike = isQuestionLike(request);
  const toolHint =
    /\b(list files|show workspace|read\s+\S+|create note|delete|remove|shell|fetch\b|query\b.{0,20}(table|database|sql)|search memory)\b/.test(text) ||
    /\b(write|save)\b.{0,30}\b(to|in|as|file|note)\b/.test(text) ||
    /\b(execute|run)\b.{0,24}\b(shell|bash|script)\b/.test(text) ||
    /\blist\b.{0,16}\b(files?|directories|folders|workspace|contents)\b/.test(text) ||
    /\bshow\b.{0,16}\b(files?|workspace|contents)\b/.test(text) ||
    /\b(what|which)\b.{0,20}\b(files?|directories|folders)\b/.test(text) ||
    /\bwhat(?:'s|\u2019s| is)\b.{0,20}\bin\b.{0,20}\b(this|the)\b.{0,20}\bworkspace\b/.test(text);
  // Advisory how-to questions ("what is the safe way to ...", "how do I ...")
  // ask for an explanation, not for the action itself. They are answered from
  // general knowledge even when they name a tool. Memory routes above win.
  if (isAdvisoryHowTo(request)) return "direct-answer";
  if (questionLike && !toolHint) return "direct-answer";
  return "tool-action";
}

/** Allowed tools for model-authored plans. Anything else is dropped so a model
 *  can never invent consequential actions; execution still passes every tool
 *  through executeTool -> Warden authorization per attempt. */
const MODEL_TOOL_ALLOWLIST = new Set([
  "fs.list", "fs.read", "fs.write", "notes.create",
  "memory.search", "memory.store", "calc.evaluate", "run_sql",
  "subagent.spawn", "skill.invoke",
]);

export function sanitizeModelPlan(plan: AgentPlan): { plan: AgentPlan; dropped: string[] } {
  const dropped: string[] = [];
  const steps = plan.steps.filter((step) => {
    if (!step.action) return true;
    if (typeof step.action.tool !== "string" || !MODEL_TOOL_ALLOWLIST.has(step.action.tool)) {
      dropped.push(step.action?.tool ?? "unknown-tool");
      return false;
    }
    if (typeof step.action.args !== "object" || step.action.args === null || Array.isArray(step.action.args)) {
      dropped.push(`${step.action.tool}:bad-args`);
      return false;
    }
    return true;
  });
  return { plan: { ...plan, steps }, dropped };
}

function stepFromAction(title: string, instruction: string, action?: PlannedAction): PlanStep {
  const permission = action ? getToolPermission(action.tool) : undefined;
  const requiresApproval = permission ? permission.defaultEffect === "require_approval" : false;
  return {
    id: createId("step"),
    title,
    instruction,
    action,
    requiresApproval,
    status: "pending",
  };
}

export function heuristicPlan(request: string): AgentPlan {
  const text = request.toLowerCase();
  const steps: PlanStep[] = [];

  if (isSupportedZetarisDemoRequest(request)) {
    const sql = "SELECT ability_name, is_hidden FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu' ORDER BY ability_name LIMIT 100";
    steps.push(stepFromAction(
      "Query Pikachu abilities in Zetaris",
      "Run the approved read-only SQL query and report only the returned rows.",
      { tool: "run_sql", args: { sql }, target: "pokeapi.pikachu_abilities_table" },
    ));
    // Every data query needs a grounded answer over the returned rows; raw
    // rows alone never satisfy the request.
    const summarize = stepFromAction(
      "Summarize Pikachu abilities from returned rows",
      "Answer the request using ONLY the abilities present in the run_sql output rows (counts, names, flags). Do not invent abilities.",
    );
    summarize.analysis = true;
    summarize.expectGrounding = "tool-rows";
    steps.push(summarize);
    return {
      summary: "Deterministic restricted Zetaris plan. This SQL was selected by VOW policy routing, not generated as a free-form model decision.",
      steps,
      inferenceMode: "deterministic",
    };
  }

  if (/\b(rm |delete|unlink|shell|bash|passwd|curl |wget |http)\b/.test(text)) {
    const dangerous = text.includes("http") || text.includes("curl") || text.includes("wget")
      ? "http.fetch"
      : text.includes("delete") || text.includes("rm ")
        ? "fs.delete"
        : "shell.exec";
    steps.push(
      stepFromAction("Requested sensitive action", request, {
        tool: dangerous,
        args: { command: request, path: request },
        target: request,
      }),
    );
  } else if (translateRequestToCalcExpressions(request) !== null) {
    // Deterministic calculation route: the translator validated the request
    // into one or two canonical expressions (symbolic, word-form power, GCD,
    // boolean, string, folded "then" chain, or general word problems such as
    // fractions/averages/discounts/rate-time and rectangle area+perimeter).
    // Every expression was trial-evaluated during translation, so tool calls
    // cannot carry truncated fragments or empty arguments. Anything
    // untranslatable falls through to the informational route below instead
    // of a wrong tool call.
    const expressions = translateRequestToCalcExpressions(request) as string[];
    if (expressions.length === 2) {
      const labels = ["Compute first value", "Compute second value"];
      // Rectangle area+perimeter shape: label steps so the combined summary
      // reports both verified numbers (general shape, no case knowledge).
      const rect = request.match(/rectangle(?:\s+is)?\s+(-?\d+(?:\.\d+)?)\s+by\s+(-?\d+(?:\.\d+)?)/i);
      const titles = rect ? ["Compute area", "Compute perimeter"] : labels;
      expressions.forEach((expression, i) => {
        steps.push(
          stepFromAction(titles[i] ?? `Evaluate expression ${i + 1}`, expression, {
            tool: "calc.evaluate",
            args: { expression },
          }),
        );
      });
    } else {
      const expression = expressions[0];
      steps.push(
        stepFromAction("Evaluate expression", expression, {
          tool: "calc.evaluate",
          args: { expression },
        }),
      );
    }
  } else if (/search memory|what do you remember|recall/.test(text)) {
    steps.push(
      stepFromAction("Search memory", request, {
        tool: "memory.search",
        args: { query: cleanMemoryQuery(request) || request },
      }),
    );
    const recallAnswer = stepFromAction(
      "Answer from recalled memory",
      "Answer ONLY using the memory.search records above. If no relevant record was returned, say what is missing instead of inventing a fact.",
    );
    recallAnswer.analysis = true;
    recallAnswer.expectGrounding = "memory";
    steps.push(recallAnswer);
  } else if (isAdvisoryHowTo(request)) {
    // Advisory how-to questions ask for an explanation of the safe method,
    // not for the action itself. Never auto-execute a tool just because the
    // request names one. General-purpose; no case-specific wording.
    const answer = stepFromAction(
      "Explain the safe method",
      "Answer the user's how-to question directly and briefly from general knowledge, naming the safe read-only tool or method and how to use it. Do not call tools; no filesystem or memory changes are needed.",
    );
    answer.analysis = true;
    answer.expectGrounding = "none";
    steps.push(answer);
  } else if (
    /\blist\b.{0,16}\b(files?|directories|folders|workspace|contents)\b/.test(text) ||
    /\bshow\b.{0,16}\b(files?|workspace|contents)\b/.test(text) ||
    /(^|\n)\s*ls\b/.test(text)
  ) {
    steps.push(stepFromAction("List workspace", "List workspace root", { tool: "fs.list", args: { path: "." } }));
  } else if (/read /.test(text)) {
    const file = request.match(/read\s+([^\s]+)/i)?.[1] ?? "README.md";
    steps.push(stepFromAction("Read file", file, { tool: "fs.read", args: { path: file }, target: file }));
  } else if (/(create|make|write)\s+a?\s*note\b/.test(text) || /(write|save)\s+\S.{0,60}\b(to|in|as|file|note)\b/.test(text)) {
    const title = request.slice(0, 48);
    steps.push(
      stepFromAction("Create note", request, {
        tool: "notes.create",
        args: { title, body: request },
        target: "notes/",
      }),
    );
  } else if (classifyIntent(request) === "memory-recall") {
    steps.push(
      stepFromAction("Recall from memory", `Search project memory for: ${request}`, {
        tool: "memory.search",
        args: { query: cleanMemoryQuery(request) || request },
      }),
    );
    const answer = stepFromAction(
      "Answer from recalled memory",
      "Answer ONLY using the memory.search records above. If no relevant record was returned, say what is missing instead of inventing a fact.",
    );
    answer.analysis = true;
    answer.expectGrounding = "memory";
    steps.push(answer);
  } else if (classifyIntent(request) === "memory-store") {
    steps.push(stepFromAction("Store memory", request, {
      tool: "memory.store",
      args: {
        content: request,
        kind: "observation",
        keywords: request.split(/\s+/).slice(0, 6),
        provenance: "user-request",
      },
    }));
  } else if (classifyIntent(request) === "direct-answer") {
    const answer = stepFromAction(
      "Answer directly",
      "Answer the user's question directly and briefly from the request itself and general knowledge. Do not call tools; no filesystem or memory changes are needed.",
    );
    answer.analysis = true;
    answer.expectGrounding = "none";
    steps.push(answer);
  } else {
    steps.push(stepFromAction("List workspace", "Inspect workspace before acting", { tool: "fs.list", args: { path: "." } }));
    steps.push(
      stepFromAction("Store observation", request, {
        tool: "memory.store",
        args: {
          content: `User asked: ${request}`,
          kind: "observation",
          keywords: request.split(/\s+/).slice(0, 6),
          provenance: "user-request",
        },
      }),
    );
  }

  if (needsWorkspaceAnswerStep(steps, request)) {
    steps.push(workspaceAnswerStep());
  }

  return {
    summary: `Heuristic demo plan for: ${request.slice(0, 120)}`,
    steps,
    inferenceMode: "heuristic-demo",
  };
}

export function parseModelPlan(text: string, fallback: AgentPlan): AgentPlan {
  // Models often wrap JSON in ```json fences or prose despite the JSON-only
  // contract (observed in live canary: validJson=false). Strip fences first,
  // then try the whole trimmed text before falling back to brace extraction.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const attempts: string[] = [candidate];
  const brace = candidate.match(/\{[\s\S]*\}/);
  if (brace && brace[0] !== candidate) attempts.push(brace[0]);
  for (const raw of attempts) {
    try {
      const parsed = JSON.parse(raw) as {
        summary?: string;
        steps?: Array<{ title?: string; instruction?: string; tool?: string | null; args?: Record<string, unknown>; target?: string | null }>;
      };
      if (!parsed.steps?.length) continue;
      return {
        summary: parsed.summary ?? fallback.summary,
        inferenceMode: "live-model",
        steps: parsed.steps.map((step) =>
          stepFromAction(
            step.title ?? "Step",
            step.instruction ?? "",
            step.tool
              ? { tool: step.tool, args: step.args ?? {}, target: step.target ?? undefined }
              : undefined,
          ),
        ),
      };
    } catch {
      continue;
    }
  }
  // Nothing parseable: callers fall back to the deterministic demo plan.
  return fallback;
}

const CALC_FAST_PATH_BLOCK = /\b(rm |delete|unlink|shell|bash|passwd|curl |wget |http)\b/;

/**
 * High-confidence deterministic calculation route (F2 fast path).
 * Returns the canonical calc expression plus a single-step deterministic
 * plan when the request translates unambiguously via the safe translator.
 * Returns null for Zetaris demo requests, dangerous-action requests, or
 * anything the translator cannot handle (caller falls through to the normal
 * model-dependent planning path). No benchmark IDs or expected answers;
 * purely translator-shaped. Mirrors the calc branch of heuristicPlan so the
 * fast path never selects a different tool than offline fallback would.
 */
export function deterministicCalcPlan(
  request: string,
): { expression: string; expressions: string[]; plan: AgentPlan } | null {
  if (isSupportedZetarisDemoRequest(request)) return null;
  if (CALC_FAST_PATH_BLOCK.test(request.toLowerCase())) return null;
  let expressions: string[] | null = null;
  try {
    expressions = translateRequestToCalcExpressions(request);
  } catch {
    return null;
  }
  if (!expressions || expressions.length === 0) return null;
  const steps: PlanStep[] =
    expressions.length === 2
      ? (() => {
          const rect = request.match(/rectangle(?:\s+is)?\s+(-?\d+(?:\.\d+)?)\s+by\s+(-?\d+(?:\.\d+)?)/i);
          const titles = rect ? ["Compute area", "Compute perimeter"] : ["Compute first value", "Compute second value"];
          return expressions.map((expression, i) =>
            stepFromAction(titles[i] ?? `Evaluate expression ${i + 1}`, expression, {
              tool: "calc.evaluate",
              args: { expression },
            }),
          );
        })()
      : [
          stepFromAction("Evaluate expression", expressions[0], {
            tool: "calc.evaluate",
            args: { expression: expressions[0] },
          }),
        ];
  return {
    expression: expressions[0],
    expressions,
    plan: {
      summary: `Deterministic calculation plan for: ${request.slice(0, 120)}`,
      steps,
      inferenceMode: "deterministic",
    },
  };
}

/**
 * SQL routing guard: model-authored run_sql steps are only valid for
 * explicit Zetaris-table requests. A page/endpoint/health accessibility
 * check must never touch SQL — the agent has no HTTP-fetch tool, so such
 * checks are answered directly or verified outside the task, never via a
 * database query. Returns the filtered plan plus the number of dropped steps.
 * Validation itself stays strict: empty SQL still fails safely in Warden and
 * the Zetaris client; this guard only stops the misrouting earlier.
 */
export function dropUnauthorizedSqlSteps(
  plan: AgentPlan,
  request: string,
): { plan: AgentPlan; droppedSql: number } {
  if (isSupportedZetarisDemoRequest(request)) return { plan, droppedSql: 0 };
  const sqlSteps = plan.steps.filter((s) => s.action?.tool === "run_sql");
  if (sqlSteps.length === 0) return { plan, droppedSql: 0 };
  return {
    plan: {
      ...plan,
      summary: `${plan.summary} Dropped ${sqlSteps.length} run_sql step(s): request is not a Zetaris-table request; page/endpoint checks must not use SQL.`,
      steps: plan.steps.filter((s) => s.action?.tool !== "run_sql"),
    },
    droppedSql: sqlSteps.length,
  };
}

export async function planTask(request: string, memoryContext: string): Promise<{
  plan: AgentPlan;
  modelError?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** Structured diagnosis when the plan is a heuristic fallback or a
   *  deliberate heuristic route. Absent for live-model/deterministic plans. */
  fallback?: ProviderFallbackDiagnosis;
}> {
  // Fast path: unambiguous calculations skip the model-dependent planning
  // call entirely (pilot: one 60s completeChat timeout before the identical
  // deterministic calc step). Execution still runs through the Warden-gated
  // calc.evaluate tool plus checkCalc verification.
  const fastPath = deterministicCalcPlan(request);
  if (fastPath) return { plan: fastPath.plan };
  const demo = heuristicPlan(request);
  const modelExpected = getEnv().METERLESS_MODEL || undefined;
  const planStarted = Date.now();
  const result = await completeChat([
    { role: "system", content: `${PLAN_SCHEMA}\nRelevant memory:\n${memoryContext}` },
    { role: "user", content: request },
  ]);
  const planElapsedMs = Date.now() - planStarted;
  if (!result.ok) {
    return {
      plan: { ...demo, inferenceMode: "heuristic-demo" },
      modelError: result.error,
      fallback: diagnoseMeterlessFailure(
        { code: result.code, httpStatus: result.httpStatus },
        "planner",
        { elapsedMs: planElapsedMs, modelExpected },
      ),
    };
  }
  if (isSupportedZetarisDemoRequest(request)) {
    const routedPlan = heuristicPlan(request);
    return {
      plan: {
        ...routedPlan,
        inferenceMode: "deterministic",
        summary:
          "Meterless completed a reasoning call; the executable SQL was still selected by deterministic VOW routing.",
      },
      usage: result.usage,
    };
  }

  const parsed = parseModelPlan(result.text, {
    ...demo,
    inferenceMode: "live-model",
  });
  const { plan: clean, dropped } = sanitizeModelPlan(parsed);
  if (dropped.length > 0) {
    clean.summary += ` Dropped ${dropped.length} non-allowlisted model-authored action(s): ${dropped.join(", ")}.`;
  }
  // SQL routing guard: a UI/page/endpoint smoke check must never reach
  // run_sql. The recorded failure planned run_sql with args.query instead of
  // args.sql for "UI smoke test ping"; Warden correctly denied it 3 times.
  // Drop such steps here so future smoke checks never touch SQL. If nothing
  // actionable remains, fall back to the deterministic heuristic demo plan.
  const sqlGuard = dropUnauthorizedSqlSteps(clean, request);
  if (sqlGuard.droppedSql > 0) {
    if (!sqlGuard.plan.steps.some((s) => s.action)) {
      return {
        plan: {
          ...demo,
          inferenceMode: "heuristic-demo",
          summary: `${demo.summary} (model SQL steps dropped: not a Zetaris request)`,
        },
        usage: result.usage,
        fallback: deliberateHeuristicDiagnosis("planner", "model SQL steps dropped for a non-Zetaris request", {
          elapsedMs: planElapsedMs,
          modelExpected,
        }),
      };
    }
    return { plan: sqlGuard.plan, usage: result.usage };
  }
  // Intent guard (F1): live-model tool plans must not regress planner-explicit
  // informational/memory routes back into unrelated workspace mutations.
  // No benchmark IDs; purely intent-shaped.
  const intent = classifyIntent(request);
  if (intent === "direct-answer") {
    // Planner-explicit standalone analysis is the only verifiable route;
    // model-authored tool plans never carry planner analysis flags.
    return {
      plan: { ...demo, inferenceMode: "heuristic-demo" },
      usage: result.usage,
      fallback: deliberateHeuristicDiagnosis("planner", "direct-answer intent route", {
        elapsedMs: planElapsedMs,
        modelExpected,
      }),
    };
  }
  if (intent === "memory-recall") {
    const hasRecall = clean.steps.some((s) => s.action?.tool === "memory.search");
    if (!hasRecall)
      return {
        plan: { ...demo, inferenceMode: "heuristic-demo" },
        usage: result.usage,
        fallback: deliberateHeuristicDiagnosis("planner", "memory-recall intent without a memory.search step", {
          elapsedMs: planElapsedMs,
          modelExpected,
        }),
      };
  }
  if (intent === "memory-store") {
    const hasStore = clean.steps.some((s) => s.action?.tool === "memory.store");
    if (!hasStore)
      return {
        plan: { ...demo, inferenceMode: "heuristic-demo" },
        usage: result.usage,
        fallback: deliberateHeuristicDiagnosis("planner", "memory-store intent without a memory.store step", {
          elapsedMs: planElapsedMs,
          modelExpected,
        }),
      };
  }
  if (needsWorkspaceAnswerStep(clean.steps, request)) {
    // Question-like live-model plans that list the workspace but compose no
    // answer would end with context-only output that verification must
    // refuse. Append a workspace-grounded answer step so the controller
    // composes the requested answer from observed entries. No new tools, no
    // authorization change; the verifier still enforces grounding.
    clean.steps.push(workspaceAnswerStep());
    clean.summary += " Added a workspace-grounded answer step so the observed listing is composed into the requested answer.";
  }
  return { plan: clean, usage: result.usage };
}

export function inferenceLabel(mode: InferenceMode): string {
  if (mode === "live-model") return "Live Meterless model plan";
  if (mode === "deterministic") return "Deterministic restricted plan";
  return "Explicit heuristic demo mode";
}
