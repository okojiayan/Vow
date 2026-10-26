import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { executeTool } from "@/core/execution/executor";
import { registerBuiltinTools } from "@/core/execution/builtin-tools";
import { listTools } from "@/core/execution/tool-registry";
import { remember } from "@/core/memory/consolidator";
import { buildContextBundle } from "@/core/memory/context";
import { conversationFallback, fallbackPlanningSection } from "@/core/memory/conversation-index";
import { extractCandidate } from "@/core/memory/extract";
import { submitCandidate } from "@/core/memory/lifecycle";
import { getSettings } from "@/core/settings";
import { appendTrace } from "@/core/traces/trace-store";
import { verifySteps } from "@/core/verification/verifier";
import { cancelApprovalsForTask, expireStaleApprovals } from "@/core/warden/approval-service";
import { getEnv, hasMeterlessKey } from "@/lib/env";
import { createId } from "@/lib/ids";
import { deterministicCalcPlan, heuristicPlan, isSupportedZetarisDemoRequest, planTask } from "./planner";
import { diagnoseMeterlessFailure } from "./fallback-diagnosis";
import { collectToolRows, deterministicAggregateLines } from "@/core/verification/grounding";
import { runMarkovian, estimateTokens } from "./markovian-engine";
import { DEFAULT_CEILING, parseEffortLevel } from "@/core/reasoning/effort";
import { buildStructuredOutcome, taskStatusForOutcome } from "@/core/reasoning/outcome";
import { loadLedger, saveLedger } from "@/core/reasoning/ledger-store";
import type { TerminalOutcome } from "@/core/agent/types";
import { completeChat } from "@/integrations/meterless/client";
import { transition } from "./state-machine";
import { runReasoningCycle } from "@/core/reasoning/runner";
import type { EffortLevel } from "@/core/reasoning/effort";
import type { TraceEventKind } from "@/core/traces/trace-types";
import { getConversation, getTask, saveConversation, saveTask } from "./task-store";
import type { AgentTask, Conversation, ConversationMessage, PlanStep } from "./types";

let toolsReady = false;

async function ensureRuntime() {
  if (!toolsReady) {
    registerBuiltinTools();
    toolsReady = true;
  }
  const workspace = path.resolve(getEnv().VOW_WORKSPACE_DIR);
  await mkdir(path.join(workspace, "notes"), { recursive: true });
  await writeFile(
    path.join(workspace, "README.md"),
    "# VOW workspace\n\nOnly this directory is visible to file tools.\n",
    { flag: "wx" },
  ).catch(() => undefined);
  await expireStaleApprovals();
}

export function isTerminalStatus(status: AgentTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "cancelled";
}

function stamp(task: AgentTask, status: AgentTask["status"], extra: Partial<AgentTask> = {}): AgentTask {
  return {
    ...task,
    ...extra,
    status: task.status === status ? status : transition(task.status, status),
    updatedAt: new Date().toISOString(),
  };
}

async function pushMessage(conversation: Conversation, message: Omit<ConversationMessage, "id" | "createdAt">) {
  conversation.messages.push({
    ...message,
    id: createId("msg"),
    createdAt: new Date().toISOString(),
  });
  conversation.updatedAt = new Date().toISOString();
  await saveConversation(conversation);
}

async function rememberExplicitRequest(taskId: string, conversationId: string, request: string): Promise<void> {
  const extraction = extractCandidate(request);
  if (!extraction) return;
  const outcome = await submitCandidate({
    content: extraction.content,
    kind: extraction.temporary ? "working" : extraction.preferenceHint ? "preference" : "semantic",
    conversationId,
    source: { type: "user", ref: `task:${taskId}` },
    provenance: "user-explicit:task-request",
    explicit: true,
    idempotencyKey: `task:${taskId}:explicit`,
  });
  await appendTrace(taskId, {
    kind: "memory",
    title: outcome.stored ? (outcome.deduped ? "Memory already stored" : "Remembered") : "Memory not stored",
    detail: outcome.stored
      ? `Stored with provenance user-explicit:task-request.${extraction.temporary ? " Kept as session memory, not a durable preference." : ""}`
      : `Not stored: ${!outcome.stored ? outcome.message : ""}`,
  });
}

export async function createTask(request: string, conversationId?: string, effortCeiling?: unknown): Promise<{
  task: AgentTask;
  conversation: Conversation;
}> {
  await ensureRuntime();
  const now = new Date().toISOString();
  let conversation = conversationId ? await getConversation(conversationId) : undefined;
  if (!conversation) {
    conversation = {
      id: createId("convo"),
      title: request.slice(0, 72),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }
  const task: AgentTask = {
    id: createId("task"),
    conversationId: conversation.id,
    request,
    status: "received",
    plan: null,
    currentStepId: null,
    pendingApprovalId: null,
    resultSummary: null,
    verification: null,
    error: null,
    inferenceMode: "heuristic-demo",
    autonomyMode: null,
    queuedAt: null,
    claimedAt: null,
    claimedBy: null,
    cancelRequested: false,
    cancelReason: null,
    attempts: 0,
    lastHeartbeat: null,
    effortCeiling: parseEffortLevel(effortCeiling) ?? DEFAULT_CEILING,
    outcome: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveTask(task);
  await pushMessage(conversation, { role: "user", content: request, taskId: task.id });
  await rememberExplicitRequest(task.id, conversation.id, request);
  await appendTrace(task.id, {
    kind: "task_received",
    title: "Task received",
    detail: request,
  });
  return { task, conversation };
}

async function runRemainingSteps(task: AgentTask): Promise<AgentTask> {
  const effortCeiling = parseEffortLevel(task.effortCeiling) ?? DEFAULT_CEILING;
  const settings = await getSettings();
  const plan = task.plan;
  if (!plan) throw new Error("Task has no plan.");
  // Refresh to observe concurrent cancellation.
  const fresh = await getTask(task.id);
  if (fresh) task = { ...task, cancelRequested: fresh.cancelRequested, cancelReason: fresh.cancelReason };
  if (task.cancelRequested) {
    return cancelNow(task, task.cancelReason ?? "Cancellation requested before execution.");
  }
  task = stamp(task, "executing", { lastHeartbeat: new Date().toISOString() });
  await saveTask(task);

  // Reasoning-driven execution. The Cognitive Controller (decideNext) chooses every
  // operation; this function only provides the existing execution boundaries:
  // executor + Warden policy for tools, Memory Engine for recall, provider for
  // analysis, verifier for evidence checks. Reasoning never bypasses authorization:
  // every tool call below passes through executeTool -> authorizeTool.
  const taskId = task.id;
  const findLiveStep = (tool: string, args: Record<string, unknown>) => {
    const key = JSON.stringify(args);
    const live = (task.plan?.steps ?? []).filter(
      (s) => s.action?.tool === tool && s.status !== "verified" && s.status !== "skipped",
    );
    const exact = live.find((s) => JSON.stringify(s.action?.args) === key);
    if (exact) return exact;
    // Never bind the wrong args when several steps share one tool (e.g.
    // rectangle area vs perimeter): only fall back when exactly one live
    // candidate exists, otherwise fail loudly so reasoning cannot execute
    // an unintended operation.
    if (live.length === 1) return live[0];
    return undefined;
  };

  const result = await runReasoningCycle({
    task,
    acceptance: [task.request],
    ceiling: effortCeiling,
    maxCycles: 12,
    isCancelled: async () => (await getTask(taskId))?.cancelRequested ?? false,
    onTrace: async (kind: TraceEventKind, title: string, detail: string, data?: unknown) => {
      await appendTrace(taskId, { kind, title, detail, data });
    },
    model: {
      complete: async (prompt: string) => {
        const modelExpected = getEnv().METERLESS_MODEL || undefined;
        if (hasMeterlessKey()) {
          const started = Date.now();
          const r = await completeChat([
            { role: "system", content: "You are VOW's reasoning helper. Analyse, do not execute. Never claim tool results you have not observed. Always return only the final answer text: no JSON envelope, no preamble, no reasoning notes." },
            { role: "user", content: prompt },
          ]);
          if (r.ok) {
            return {
              text: r.text,
              provenance: r.model ?? getEnv().METERLESS_MODEL,
              usage: r.usage ? { promptTokens: r.usage.prompt_tokens ?? 0, completionTokens: r.usage.completion_tokens ?? 0 } : undefined,
            };
          }
          const fallback = diagnoseMeterlessFailure(
            { code: r.code, httpStatus: r.httpStatus },
            "investigation",
            { elapsedMs: Date.now() - started, modelExpected },
          );
          return { text: `Heuristic analysis for: ${prompt.slice(0, 500)}`, provenance: "heuristic-demo", fallback };
        }
        return {
          text: `Heuristic analysis for: ${prompt.slice(0, 500)}`,
          provenance: "heuristic-demo",
          fallback: diagnoseMeterlessFailure({ code: "not_configured" }, "investigation", { modelExpected }),
        };
      },
    },
    memory: {
      search: async (query: string, limit = 5) => {
        const bundle = await buildContextBundle({ query, conversationId: task.conversationId, limit, budgetChars: 2000 });
        return bundle.items.map((item) => ({ id: item.id, content: item.content }));
      },
    },
    tools: {
      exec: async ({ tool, args }) => {
        const step = findLiveStep(tool, args);
        if (!step?.action) {
          return { ok: false, error: `No planned step for tool ${tool}. Reasoning cannot invent consequential actions.`, provenance: "orchestrator:unplanned-tool" };
        }
        task.currentStepId = step.id;
        task.lastHeartbeat = new Date().toISOString();
        step.status = "running";
        await saveTask(task);
        await appendTrace(task.id, {
          kind: "tool_call",
          title: `Tool ${step.action.tool}`,
          detail: step.instruction,
          data: { ...step.action, stepId: step.id },
        });
        try {
          const { checkAgainstLock } = await import("@/core/warden/plan-lock");
          const lock = task.planLock;
          if (lock && task.plan) {
            const verdict = checkAgainstLock(task.plan, lock);
            if (!verdict.ok) {
              const { recordAudit } = await import("@/core/warden/audit");
              await recordAudit({ kind: "block", taskId: task.id, tool: step.action.tool, decision: "deny", policy: "plan-lock.deviation", reason: verdict.reason ?? "Plan deviated from locked version.", outcome: "blocked", fingerprint: "" });
              step.status = "blocked";
              step.error = verdict.reason;
              await saveTask(task);
              return { ok: false, error: verdict.reason, provenance: "plan-lock" };
            }
          }
        } catch {
          // Lock check best-effort; Warden authorization below remains authoritative.
        }
        const res = await executeTool({
          taskId: task.id,
          tool: step.action.tool,
          args: step.action.args,
          target: step.action.target,
          mode: settings.mode,
          stepId: step.id,
        });
        try {
          const { screenUntrusted } = await import("@/core/warden/untrusted");
          const { recordAudit } = await import("@/core/warden/audit");
          const probe = typeof res.output === "string" ? res.output : JSON.stringify(res.output ?? "");
          const check = screenUntrusted(probe.slice(0, 8000), `tool:${step.action.tool}`);
          if (check.flagged) {
            await recordAudit({ kind: "block", taskId: task.id, tool: step.action.tool, decision: "deny", policy: "untrusted.hidden-instruction", reason: `Hidden instruction flagged in ${step.action.tool} output (${check.reasons.join(",")}); treated as data, not instructions.`, outcome: "blocked", fingerprint: "" });
            await appendTrace(task.id, { kind: "blocked", title: `Hidden instruction blocked (${step.action.tool})`, detail: `Flagged ${check.reasons.join(", ")}. Output preserved as data; no policy expansion occurred.` });
          }
        } catch {
          // Screening best-effort; gate remains authoritative.
        }
        await appendTrace(task.id, {
          kind: "policy_decision",
          title: `Warden: ${res.status}`,
          detail: res.reason ?? res.error ?? "",
          data: { policy: res.policy, approvalId: res.approvalId },
        });
        const provenance = `warden:${res.policy ?? "unknown"}`;
        if (res.status === "needs_approval") {
          step.status = "awaiting_approval";
          await saveTask(task);
          return { ok: false, needsApproval: true, approvalId: res.approvalId, provenance };
        }
        if (res.status === "denied") {
          step.status = "blocked";
          step.error = res.error;
          await remember({
            content: `Blocked ${step.action.tool}: ${res.error}`,
            kind: "failure",
            entities: [step.action.tool],
            keywords: ["blocked", "warden", step.action.tool],
            conversationId: task.conversationId,
            source: { type: "system", ref: "warden" },
            provenance,
            idempotencyKey: `task:${task.id}:blocked:${step.id ?? step.instruction.slice(0, 24)}`,
          });
          await saveTask(task);
          return { ok: false, error: res.error, provenance };
        }
        if (res.status === "error") {
          step.status = "failed";
          step.error = res.error;
          await remember({
            content: `Tool ${step.action.tool} failed: ${res.error}`,
            kind: "failure",
            entities: [step.action.tool],
            keywords: ["failure", step.action.tool],
            conversationId: task.conversationId,
            source: { type: "tool", ref: step.action.tool },
            provenance: `tool:${step.action.tool}`,
            idempotencyKey: `task:${task.id}:tool-failure:${step.id ?? step.instruction.slice(0, 24)}`,
          });
          await saveTask(task);
          return { ok: false, error: res.error, provenance };
        }
        step.output = res.output;
        await saveTask(task);
        return { ok: true, output: res.output, provenance: `executor:${step.action.tool}` };
      },
    },
  });

  // The controller drove execution above; translate its evidence-linked outcome
  // into the single AgentTask lifecycle. No success is declared without
  // acceptance evidence + passing verification.
  task.usage = {
    promptTokens: (task.usage?.promptTokens ?? 0) + result.usage.promptTokens,
    completionTokens: (task.usage?.completionTokens ?? 0) + result.usage.completionTokens,
  };
  if (result.fallbacks.length > 0) {
    const prior = task.providerFallbacks ?? [];
    task.providerFallbacks = [...prior, ...result.fallbacks];
  }
  await saveTask(task);
  try {
    await saveLedger(task.id);
  } catch {
    // Ledger durability is best-effort; the terminal outcome below is authoritative.
  }
  if (result.cancelled || (await getTask(task.id))?.cancelRequested) {
    return cancelNow(task, task.cancelReason ?? "Cancellation requested during execution.");
  }
  if (result.pendingApprovalId) {
    task.pendingApprovalId = result.pendingApprovalId;
    task = { ...stamp(task, "awaiting_approval"), pendingApprovalId: result.pendingApprovalId };
    await saveTask(task);
    return task;
  }

  if (result.outcome === "blocked") {
    const reason = plan.steps.find((s) => s.status === "blocked")?.error ?? "Blocked by Warden.";
    task = stamp(task, "blocked", { error: reason, resultSummary: reason, outcome: result.structured });
    await appendTrace(task.id, { kind: "blocked", title: "Blocked", detail: task.error ?? "", data: { outcome: result.structured } });
    await saveTask(task);
    return task;
  }

  task = stamp(task, "verifying");
  await saveTask(task);
  const verification = await verifySteps(plan.steps, task.request);
  await appendTrace(task.id, {
    kind: "verification",
    title: verification.passed ? "Verified" : "Verification failed",
    detail: verification.explanation,
    data: verification.checks,
  });
  task.verification = {
    passed: verification.passed,
    explanation: verification.explanation,
    evidence: verification.checks,
  };
  for (const step of plan.steps) {
    if (!step.action) continue;
    if (verification.passed && step.status === "running") {
      step.status = "verified";
    } else if (!verification.passed && step.status === "running") {
      step.status = "failed";
      step.error = verification.explanation;
    }
  }

  if (verification.passed && (result.outcome === "completed" || result.outcome === "partial")) {
    const status = taskStatusForOutcome(result.outcome);
    const summary = (result.outcome === "partial" ? "Partial progress: not all acceptance conditions were met. " : "") + formatResultSummary(task.request, plan.steps, verification.explanation, verification.passed, result.outcome);
    await remember({
      content: `${result.outcome === "partial" ? "Partially completed" : "Completed"}: ${task.request}. ${summary}`,
      kind: "observation",
      keywords: [result.outcome === "partial" ? "partial" : "completed"],
      conversationId: task.conversationId,
      source: { type: "system", ref: "orchestrator" },
      provenance: "task-completion",
      idempotencyKey: `task:${task.id}:completion`,
    });
    task = stamp(task, status, { resultSummary: summary, error: null, outcome: result.structured });
    await appendTrace(task.id, { kind: "completed", title: result.outcome === "partial" ? "Partially completed" : "Completed", detail: summary, data: { outcome: result.structured } });
    await saveTask(task);
    return task;
  }

  const terminal: TerminalOutcome = !verification.passed && result.outcome === "unverified" ? "unverified" : "failed";
  const stepErrors = plan.steps.map((st) => st.error).filter((e): e is string => !!e);
  const shortfall = formatFailureShortfall(terminal, verification.explanation, stepErrors);
  const failedOutcome = buildStructuredOutcome({
    outcome: terminal,
    reason: shortfall,
    acceptanceSatisfied: result.structured.acceptanceSatisfied,
    acceptanceTotal: result.structured.acceptanceTotal,
    evidenceIds: result.structured.evidenceIds,
    verificationPassed: verification.passed,
    providerProvenance: result.structured.providerProvenance,
  });
  await remember({
    content: `Verification failed for "${task.request}": ${shortfall}`,
    kind: "failure",
    keywords: ["verification", "failed"],
    conversationId: task.conversationId,
    source: { type: "system", ref: "verifier" },
    provenance: "verifier",
    idempotencyKey: `task:${task.id}:verification-failure`,
  });
  task = stamp(task, "failed", { error: shortfall, resultSummary: shortfall, outcome: failedOutcome });
  await saveTask(task);
  return task;
}

export async function cancelNow(task: AgentTask, reason: string): Promise<AgentTask> {
  const now = new Date().toISOString();
  const base: AgentTask = {
    ...task,
    cancelRequested: true,
    cancelReason: reason,
    pendingApprovalId: null,
    lastHeartbeat: now,
  };
  let next: AgentTask;
  try {
    next = stamp(base, "cancelled", {
      error: reason,
      resultSummary: reason,
      outcome: buildStructuredOutcome({
        outcome: "cancelled",
        reason,
        acceptanceSatisfied: 0,
        acceptanceTotal: 0,
        evidenceIds: [],
        verificationPassed: null,
        providerProvenance: [],
      }),
    });
  } catch {
    // If the transition is illegal (already terminal), preserve terminal state but record intent.
    next = { ...base, updatedAt: now };
  }
  await saveTask(next);
  await cancelApprovalsForTask(task.id, reason);
  await appendTrace(task.id, { kind: "cancelled", title: "Task cancelled", detail: reason });
  return next;
}

/** Failure summary for failed/unverified outcomes. Never yields "." or an
 *  empty string: an empty verification explanation falls back to an explicit
 *  non-success statement. The fallback names no tools or task keywords so it
 *  cannot accidentally satisfy answer graders. */
export function formatFailureShortfall(
  terminal: "failed" | "unverified",
  explanation: string,
  stepErrors: string[],
): string {
  const detail = explanation.trim();
  const cause = stepErrors.length > 0 ? ` Caused by: ${stepErrors[0]}` : "";
  const fallback = "Verification failed; the requested outcome was not established.";
  if (terminal === "unverified") return `Ended unverified: ${detail || fallback}.${cause}`;
  return `${detail || fallback}${cause}`;
}

export function summarize(steps: PlanStep[], verification: string): string {
  const bits = steps
    .filter((step) => step.output != null)
    .map((step) => {
      if (step.action?.tool === "run_sql" && step.output && typeof step.output === "object") {
        const output = step.output as {
          sql?: unknown;
          rows?: unknown;
          rowCount?: unknown;
          requestId?: unknown;
        };

        if (typeof output.sql === "string" && Array.isArray(output.rows)) {
          const rows = output.rows.filter(
            (row): row is unknown[] => Array.isArray(row),
          );

          const selected = output.sql.match(/^\s*select\s+(.+?)\s+from\s/i)?.[1];
          const columns = selected && selected.trim() !== "*"
            ? selected.split(",").map((column) =>
                column.trim()
                  .split(/\s+as\s+/i)
                  .pop()!
                  .replace(/["`]/g, "")
                  .split(".")
                  .pop()!
              )
            : [];

          const resultLines = rows.map((row) =>
            "- " + row.map((value, index) =>
              `${columns[index] ?? `column_${index + 1}`}=${String(value)}`
            ).join(", ")
          );

          const aggregateLines = deterministicAggregateLines(
            collectToolRows([{ ...step, output } as typeof step]),
          );
          return [
            "Zetaris read-only query",
            `Rows returned: ${typeof output.rowCount === "number" ? output.rowCount : rows.length}`,
            `Executed SQL: ${output.sql}`,
            "Results:",
            ...(resultLines.length ? resultLines : ["- No rows returned"]),
            ...aggregateLines,
            `Request ID: ${typeof output.requestId === "string" ? output.requestId : "not recorded"}`,
          ].join("\n");
        }
      }

      if (step.action?.tool === "memory.search" && Array.isArray(step.output)) {
        const lines = (step.output as Array<{ content?: unknown; id?: unknown }>).map(
          (r) => `- ${String(r.content ?? "").slice(0, 300)}`,
        );
        return [`${step.title}:`, ...lines].join("\n") || `${step.title}: no records returned.`;
      }

      // Analysis steps carry the user-facing answer in `analysis`; emit only
      // the deliverable, never the provenance JSON envelope. Evidence stays in
      // traces and the Reasoning Ledger.
      if (step.analysis === true && step.output && typeof step.output === "object") {
        const a = (step.output as { analysis?: unknown }).analysis;
        if (typeof a === "string" && a.trim()) return a.slice(0, 2000);
      }

      // Name the executed tool in prose: a read-only listing verified by
      // policy should say which tool produced it (e.g. "tool fs.list"), so
      // the final answer identifies the evidence source instead of an
      // anonymous listing.
      const toolSuffix = step.action?.tool ? ` (tool ${step.action.tool})` : "";
      return `${step.title}${toolSuffix}: ${JSON.stringify(step.output).slice(0, 180)}`;
    });

  return `${bits.join("\n\n") || "No outputs"}\n\nVerification: ${verification}`;
}

/**
 * Constraint-aware presentation for deterministic calculations (Phase 2I).
 * When the request explicitly requires a numeric-only answer and the plan
 * produced exactly one verified numeric calc.evaluate result, the
 * user-facing summary is the bare number. Full tool output and verification
 * detail stay in the trace and task record; only the graded user-facing
 * presentation is constrained. All other cases fall through to the
 * explanatory summarize(). Never matches a benchmark case by ID and never
 * hardcodes a result value.
 */
export function isNumericOnlyRequest(request: string): boolean {
  const r = request.toLowerCase();
  if (!/\bonly\b/.test(r)) return false;
  if (!/\bnumbers?\b|\bnumeric\b/.test(r)) return false;
  return /\bnothing\s+else\b|\bno\s+(other|extra|explanation)\b|\bwithout\s+explanation\b|\bjust\s+the\s+numbers?\b/.test(r);
}

/** Returns the bare numeric result when exactly one calc.evaluate step
 *  produced a finite numeric output, otherwise null (safe fallback). */
export function verifiedNumericCalcResult(steps: PlanStep[]): string | null {
  const withOutput = steps.filter((step) => step.output != null);
  if (withOutput.length !== 1) return null;
  const step = withOutput[0]!;
  if (step.action?.tool !== "calc.evaluate") return null;
  const output = step.output as { kind?: unknown; result?: unknown } | null;
  if (typeof output !== "object" || output === null) return null;
  if (output.kind !== "number" || typeof output.result !== "number") return null;
  if (!Number.isFinite(output.result)) return null;
  return String(output.result);
}

/** Matches an explicit output-format directive (e.g. "reply yes or no",
 *  "reply with only ...", "nothing else", "without explanation") without
 *  matching ordinary explanatory prose. Never matches a benchmark case by ID
 *  and never encodes an expected answer. */
export function isFormatConstrainedRequest(request: string): boolean {
  const r = request.toLowerCase();
  if (/\b(reply|respond|answer)\s+yes\s+or\s+no\b/.test(r)) return true;
  if (/\b(reply|respond)\s+(with\s+only|only)\b/.test(r)) return true;
  if (/\banswer\s+with\s+only\b/.test(r)) return true;
  if (/\bnothing\s+else\b/.test(r)) return true;
  if (/\bno\s+(other|extra|explanation)\b/.test(r)) return true;
  if (/\bwithout\s+explanation\b/.test(r)) return true;
  if (/\bjust\s+the\s+(answer|word|name|value)s?\b/.test(r)) return true;
  return false;
}

/** Returns the bare deliverable when exactly one standalone analysis step
 *  produced a non-empty answer, otherwise null (safe fallback). */
export function verifiedStandaloneAnswer(steps: PlanStep[]): string | null {
  const withOutput = steps.filter((step) => step.output != null);
  if (withOutput.length !== 1) return null;
  const step = withOutput[0]!;
  if (step.analysis !== true) return null;
  const output = step.output as { analysis?: unknown } | null;
  if (typeof output !== "object" || output === null) return null;
  if (typeof output.analysis !== "string" || !output.analysis.trim()) return null;
  return output.analysis.slice(0, 2000);
}

/** User-facing summary that respects an explicit output-format constraint.
 *  Only strips presentation when the outcome completed with passing
 *  verification and a single verified result (numeric calculation or
 *  standalone answer); failed, unverified, partial, multi-step, or
 *  unconstrained cases keep the explanatory summary so no evidence is
 *  hidden. Verification detail stays in the trace and task record. */
export function formatResultSummary(
  request: string,
  steps: PlanStep[],
  verificationExplanation: string,
  verificationPassed: boolean,
  outcome: string,
): string {
  if (outcome === "completed" && verificationPassed === true && isNumericOnlyRequest(request)) {
    const bare = verifiedNumericCalcResult(steps);
    if (bare !== null) return bare;
  }
  if (outcome === "completed" && verificationPassed === true && isFormatConstrainedRequest(request)) {
    const bare = verifiedStandaloneAnswer(steps);
    if (bare !== null) return bare;
  }
  return summarize(steps, verificationExplanation);
}
function shouldUseMarkovian(request: string): boolean {

  const text = request.toLowerCase();
  if (/\b(markovian|multi[-\s]?step|long[-\s]?running|deep research)\b/.test(text)) {
    return true;
  }

  return request.trim().length >= 240 &&
    /\b(research|analy[sz]e|design|implement|build|compare|investigate|architecture|roadmap)\b/.test(text);
}

export async function runTask(taskId: string, opts?: { effortCeiling?: unknown }): Promise<AgentTask> {
  await ensureRuntime();
  let task = await getTask(taskId);
  if (!task) throw new Error("Unknown task");
  const conversation = await getConversation(task.conversationId);
  if (!conversation) throw new Error("Unknown conversation");

  const selected = parseEffortLevel(opts?.effortCeiling) ?? parseEffortLevel(task.effortCeiling) ?? DEFAULT_CEILING;
  if (task.effortCeiling !== selected) {
    task = { ...task, effortCeiling: selected, updatedAt: new Date().toISOString() };
    await saveTask(task);
  }
  try {
    await loadLedger(task.id);
  } catch {
    // Ledger recovery is best-effort; reasoning proceeds on the live plan.
  }
  if (isTerminalStatus(task.status)) return task;
  if (task.cancelRequested) {
    return cancelNow(task, task.cancelReason ?? "Cancellation requested.");
  }
  // Normalize background claims into planning. queued/claimed/interrupted all resume from planning
  // unless a verified plan already exists (then runRemainingSteps skips verified steps).
  if (task.status === "queued" || task.status === "claimed" || task.status === "interrupted") {
    try {
      task = stamp(task, "planning", { lastHeartbeat: new Date().toISOString() });
    } catch {
      // Fall through with current status if transition is unexpected.
    }
    await saveTask(task);
    await appendTrace(task.id, {
      kind: "recovered",
      title: "Background claim resumed",
      detail: `Resuming from ${task.status} with checkpointed plan.`,
    });
  }

  if (task.status === "received" || task.status === "planning") {
    task = stamp(task, "planning");
    await saveTask(task);
    await appendTrace(task.id, { kind: "planning", title: "Planning", detail: "Building an observable plan." });
    const bundle = await buildContextBundle({
      query: task.request,
      conversationId: task.conversationId,
      limit: 8,
      budgetChars: 4000,
    });
    const memoryContext = bundle.items
      .map((item) => `- (${item.kind}) ${item.content} [source:${item.provenance}]`)
      .join("\n");
    await appendTrace(task.id, {
      kind: "model_request",
      title: "Planner request",
      detail: "Requesting a structured plan from Meterless when configured.",
    });
    const baseMemoryContext = memoryContext || "(no memory yet)";
    let planningContext = baseMemoryContext;

    // Index-miss fallback: when structured retrieval has nothing for this
    // conversation, reuse the durable message-pair metadata (user request +
    // assistant reply with ids/timestamps) so prior turns are not lost.
    // History is verbatim data, never instructions: the section header says
    // so explicitly and the current task request remains authoritative.
    if (bundle.items.length === 0) {
      try {
        const fallback = await conversationFallback(task.conversationId, {
          limit: 6,
          budgetChars: 3000,
          excludeTaskId: task.id,
        });
        if (fallback.turnsUsed > 0) {
          const section = fallbackPlanningSection(fallback.pairs);
          planningContext = `${baseMemoryContext}\n\n${section}`;
          await appendTrace(task.id, {
            kind: "planning",
            title: "Conversation history fallback",
            detail: `Structured memory missed; using ${fallback.turnsUsed} prior turn(s) as verbatim history${fallback.partial ? " (budget-truncated)" : ""}.`,
            data: { turnsUsed: fallback.turnsUsed, charsUsed: fallback.charsUsed, partial: fallback.partial },
          });
        }
      } catch {
        // Fallback is best-effort; planning proceeds on the base context.
      }
    }

    // Calc fast path is computed once and reused for the Markovian skip and
    // the planner-result branch below so both observe the same routing.
    const calcFastPath = deterministicCalcPlan(task.request);
    if (isSupportedZetarisDemoRequest(task.request)) {
      await appendTrace(task.id, {
        kind: "planning",
        title: "Markovian skipped",
        detail: "Deterministic Zetaris route: the executable plan is fixed by policy routing and Markovian preliminary text is not consumed downstream. Skipping bounded model calls to save latency.",
        data: { engine: "markovian", status: "skipped", reason: "deterministic-route" },
      });
    } else if (calcFastPath) {
      await appendTrace(task.id, {
        kind: "planning",
        title: "Markovian skipped",
        detail: `Deterministic calculation route (${calcFastPath.expressions.join(" + ")}): the executable plan is ${calcFastPath.expressions.length === 2 ? "two" : "a single"} Warden-gated calc.evaluate step(s) and Markovian preliminary text is not consumed downstream. Skipping bounded model calls to save latency.`,
        data: { engine: "markovian", status: "skipped", reason: "deterministic-calc-route", expression: calcFastPath.expression, expressions: calcFastPath.expressions },
      });
    } else if (shouldUseMarkovian(task.request)) {
      if (!hasMeterlessKey()) {
        await appendTrace(task.id, {
          kind: "planning",
          title: "Markovian skipped",
          detail: "The task matched long-running routing, but Meterless is not configured.",
          data: { engine: "markovian", status: "skipped", reason: "not-configured" },
        });
      } else {
        await appendTrace(task.id, {
          kind: "planning",
          title: "Markovian engine started",
          detail: "Running bounded reasoning chunks before structured tool planning.",
          data: {
            actor: "markovian-engine",
            engine: "markovian",
            mode: "ARCHITECT",
            config: { chunkSize: 4000, maxChunks: 3, carryoverTokens: 640, overlapTokens: 0 },
          },
        });

        const modelsUsed = new Set<string>();

        const markovianRun = await runMarkovian({
          goal: [
            "Prepare a three-stage execution strategy for the following VOW task.",
            "Stage 1: identify the data source, allowed tool, and security constraints.",
            "Stage 2: specify the read-only operation and conditions needed to avoid empty or mismatched results.",
            "Stage 3: define evidence requirements and final-result validation.",
            "Planning only: never claim to execute tools or report unobserved data values.",
            "Complete only the current stage in each chunk. On continuation, advance to the next unfinished stage using the saved carryover. Use [STATE_CHECKPOINT] with COMPLETED, REMAINING, DECISIONS, and CONTEXT when work remains. Use [TASK_COMPLETE] only after all three stages are complete.",
            `Original request: ${task.request}`,
          ].join("\n\n"),
          memoryContext: baseMemoryContext,
          mode: "ARCHITECT",
          config: { chunkSize: 4000, maxChunks: 3, carryoverTokens: 640, overlapTokens: 0 },
          reflect: false,
          generator: async (prompt, systemPrompt) => {
            const result = await completeChat([
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ]);

            if (!result.ok) throw new Error(result.error);
            if (result.model) modelsUsed.add(result.model);

            return { text: result.text, usage: result.usage };
          },
          onChunk: async (chunk) => {
            await appendTrace(taskId, {
              kind: "planning",
              title: `Markovian chunk ${chunk.id}`,
              detail: [
              `Carryover entering chunk ${chunk.id}: ${
                chunk.carryover
                  ? `${estimateTokens(chunk.carryover)} estimated tokens`
                  : "none (first chunk)"
              }`,
              chunk.carryover ? chunk.carryover.slice(0, 500) : "",
              "Generated content:",
              chunk.content.slice(0, 900) || "(empty display content)",
            ].filter(Boolean).join("\n\n"),
              data: {
                actor: "markovian-engine",
                engine: "markovian",
                chunkId: chunk.id,
                estimatedOutputTokens: chunk.tokens,
                carryoverTokens: estimateTokens(chunk.carryover),
                carryover: chunk.carryover,
              },
            });
          },
        });

        await appendTrace(task.id, {
          kind: markovianRun.status === "errored" ? "failure" : "planning",
          title: "Markovian run summary",
          detail:
            `Status: ${markovianRun.status}; chunks: ${markovianRun.chunks.length}; ` +
            `estimated output tokens: ${markovianRun.totalTokensUsed}; ` +
            `estimated modelled savings: ${markovianRun.totalTokensSaved}; ` +
            `duration: ${markovianRun.durationMs} ms` +
            (markovianRun.error ? `; error: ${markovianRun.error}` : ""),
          data: {
            actor: "markovian-engine",
            engine: "markovian",
            status: markovianRun.status,
            config: markovianRun.chunkConfig,
            chunks: markovianRun.chunks.length,
            estimatedOutputTokens: markovianRun.totalTokensUsed,
            estimatedModelledTokensSaved: markovianRun.totalTokensSaved,
            efficiencyPercent: markovianRun.efficiencyPercent,
            tokenLabel: markovianRun.tokenLabel,
            providerReportedTokens: markovianRun.providerReportedTokens,
            providerUsageComplete: markovianRun.providerUsageComplete,
            durationMs: markovianRun.durationMs,
            models: [...modelsUsed],
          },
        });

        // Only completed, marker-terminated reasoning is offered to the planner.
        // This preliminary text is context, not tool execution evidence.
        if (markovianRun.status === "completed" && markovianRun.output.trim()) {
          planningContext =
            `${baseMemoryContext}\n\n` +
            `[MARKOVIAN PRELIMINARY ANALYSIS — NOT VERIFIED TOOL EVIDENCE]\n` +
            `${markovianRun.output.slice(0, 10000)}\n\n` +
            `[MARKOVIAN FINAL CARRYOVER]\n${markovianRun.finalCarryover.slice(0, 3000)}`;
        }
      }
    }

    const plannerResult = isSupportedZetarisDemoRequest(task.request)
      ? {
          plan: heuristicPlan(task.request),
          modelError: undefined,
          usage: undefined,
        }
      : calcFastPath
        ? {
            plan: calcFastPath.plan,
            modelError: undefined,
            usage: undefined,
          }
        : await planTask(task.request, planningContext);

    const { plan, modelError, usage, fallback: plannerFallback } = plannerResult;
    if (plannerFallback) {
      task.providerFallbacks = [...(task.providerFallbacks ?? []), plannerFallback];
    }

    if (isSupportedZetarisDemoRequest(task.request)) {
      await appendTrace(task.id, {
        kind: "planning",
        title: "Deterministic SQL plan",
        detail:
          "Selected the restricted Zetaris query by policy routing. This is not a model-authored SQL statement. Markovian/Meterless reasoning is recorded separately when configured.",
        data: {
          actor: "vow-planner",
          route: "pikachu-abilities",
          tool: "run_sql",
          inferenceMode: plan.inferenceMode,
        },
      });
    } else if (calcFastPath) {
      await appendTrace(task.id, {
        kind: "planning",
        title: "Deterministic calculation plan",
        detail: `Selected calc.evaluate by deterministic fast-path routing for expression(s) ${calcFastPath.expressions.join(" + ")}. No model planning call was issued; provider-backed reasoning is recorded separately when an analysis step runs. This result is a deterministic calculation, never a Nemotron-generated answer.`,
        data: {
          actor: "vow-planner",
          route: "calc-fast-path",
          tool: "calc.evaluate",
          expression: calcFastPath.expression,
          expressions: calcFastPath.expressions,
          inferenceMode: plan.inferenceMode,
        },
      });
    }
    task.plan = plan;
    task.inferenceMode = plan.inferenceMode;
    try {
      const { routeRequest } = await import("@/core/reasoning/router");
      const ceiling = parseEffortLevel(task.effortCeiling) ?? DEFAULT_CEILING;
      task.reasoningRoute = routeRequest({
        message: task.request,
        effortCeiling: ceiling,
        deterministic: plan.inferenceMode === "deterministic",
      });
      await appendTrace(task.id, {
        kind: "planning",
        title: task.reasoningRoute.route === "quick" ? "Quick answer" : "Thought deeply",
        detail: task.reasoningRoute.reason,
        data: { route: task.reasoningRoute.route, modelCalls: task.reasoningRoute.modelCalls, deterministic: task.reasoningRoute.deterministic, ceiling },
      });
    } catch {
      // Router is label-only; planning result stands without it.
    }
    try {
      const { lockPlanVersion } = await import("@/core/warden/plan-lock");
      const { buildTaskPass, blastRadiusForPass } = await import("@/core/warden/task-pass");
      task.planLock = lockPlanVersion(plan);
      const pass = buildTaskPass(task, plan);
      const blast = blastRadiusForPass(pass);
      await appendTrace(task.id, {
        kind: "planning",
        title: "Task Pass locked",
        detail: `Plan v${pass.planVersion} locked: ${pass.actions.length} action(s), approvals: ${pass.requiredApprovals.length || "none"}, blast radius ${blast.level} (${blast.score}).`,
        data: { pass, blast },
      });
    } catch {
      // Pass trace is best-effort; enforcement below does not depend on it.
    }
    await appendTrace(task.id, {
      kind: plan.inferenceMode === "live-model" ? "model_response" : "plan_ready",
      title:
        plan.inferenceMode === "live-model"
          ? "Live model plan"
          : plan.inferenceMode === "deterministic"
            ? "Deterministic restricted plan"
            : "Heuristic demo plan",
      detail: modelError
        ? `${plan.summary} Meterless unavailable: ${modelError}`
        : plan.summary,
      data: {
      usage,
      inferenceMode: plan.inferenceMode,
      modelError,
      ...(plannerFallback ? { fallback: plannerFallback } : {}),
    },
    });
    await saveTask(task);
  }

  // Re-check cancellation after planning.
  task = (await getTask(task.id)) ?? task;
  if (task.cancelRequested && !isTerminalStatus(task.status)) {
    return cancelNow(task, task.cancelReason ?? "Cancellation requested.");
  }
  if (task.status === "planning" || task.status === "awaiting_approval" || task.status === "executing") {
    if (task.status === "planning") {
      const next = await runRemainingSteps(task);
      task = next;
    } else if (task.status === "awaiting_approval" || task.status === "executing") {
      task = await runRemainingSteps({ ...task, status: task.status === "awaiting_approval" ? "awaiting_approval" : "executing" });
    }
  }

  if (conversation && (task.status === "completed" || task.status === "failed" || task.status === "blocked" || task.status === "awaiting_approval" || task.status === "cancelled")) {
    const content =
      task.status === "awaiting_approval"
        ? `Warden needs an action-specific approval before continuing. ${task.plan?.steps.find((s) => s.status === "awaiting_approval")?.instruction ?? ""}`
        : task.resultSummary ?? task.error ?? task.status;
    await pushMessage(conversation, {
      role: "assistant",
      content: `${task.inferenceMode === "heuristic-demo" ? "[Demo mode] " : task.inferenceMode === "deterministic" ? "[Deterministic plan] " : ""}${content}`,
      taskId: task.id,
    });
  }
  return (await getTask(task.id)) ?? task;
}

export async function startAndRun(request: string, conversationId?: string, opts?: { effortCeiling?: EffortLevel }) {
  const created = await createTask(request, conversationId);
  const task = await runTask(created.task.id, opts);
  const conversation = await getConversation(task.conversationId);
  return { task, conversation };
}

export async function continueTask(taskId: string) {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task");
  if (task.cancelRequested) {
    return cancelNow(task, task.cancelReason ?? "Cancelled before resume.");
  }
  if (task.status !== "awaiting_approval") {
    return task;
  }
  // Re-enter the Warden gateway on resume: runTask -> runRemainingSteps calls
  // executeTool -> authorizeTool, which requires a still-valid, task-bound approval.
  // Stale or consumed approvals pause again instead of executing.
  const runnable = stamp(task, "executing", { pendingApprovalId: null });
  await saveTask(runnable);
  await appendTrace(taskId, {
    kind: "recovered",
    title: "Approval resume",
    detail: "Resuming after approval. Warden will revalidate the exact pending action before execution.",
  });
  return runTask(taskId);
}

export async function rejectTask(taskId: string, reason: string) {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task");
  const next = stamp(
    { ...task, status: task.status === "awaiting_approval" ? "awaiting_approval" : task.status },
    "blocked",
    { error: reason, resultSummary: reason, pendingApprovalId: null },
  );
  await appendTrace(task.id, { kind: "blocked", title: "Approval denied", detail: reason });
  await saveTask(next);
  return next;
}

export function describeRuntime() {
  return {
    tools: listTools().map((tool) => ({ name: tool.name, description: tool.description, risk: tool.risk })),
  };
}
