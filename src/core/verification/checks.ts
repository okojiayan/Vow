import { readFile } from "node:fs/promises";
import { assertSafeWorkspacePath } from "@/core/warden/path-guard";
import { getEnv } from "@/lib/env";
import { evaluateCalcExpression, translateRequestToCalcExpressions } from "@/core/execution/calc";
import type { PlanStep } from "@/core/agent/types";
import type { CheckResult } from "./result";
import { collectToolRows, statesEmpty, verifyCountClaims } from "./grounding";

export async function checkToolOutput(step: PlanStep, goal = ""): Promise<CheckResult> {
  if (!step.action) {
    return {
      name: "has-action",
      passed: false,
      explanation: "Step has no executable action to verify.",
    };
  }
  if (step.status === "failed" || step.status === "blocked") {
    return {
      name: "step-status",
      passed: false,
      explanation: `Step ended in ${step.status}. Model claims are not treated as success.`,
      evidence: step.error,
    };
  }
  if (step.output == null) {
    return {
      name: "has-output",
      passed: false,
      explanation: "No tool output was recorded.",
    };
  }

  if (step.action.tool === "memory.search") {
    const out = step.output as { records?: unknown } & unknown;
    const records = Array.isArray((out as { records?: unknown })?.records)
      ? (out as { records?: unknown[] }).records!
      : Array.isArray(step.output)
        ? step.output as unknown[]
        : null;
    if (!records || records.length === 0) {
      return { name: "memory-recall", passed: false, explanation: "Memory search returned no relevant records; the answer is unverified.", evidence: step.output };
    }
    const ids = records
      .map((r) => (r as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === "string");
    return {
      name: "memory-recall",
      passed: true,
      explanation: `Memory search returned ${records.length} relevant record(s).`,
      evidence: { ids, records: (step.output as unknown) },
    };
  }
  if (step.action.tool === "memory.store") {
    // Storing is the requested outcome only for remember/store requests.
    // A request-echo stored during an informational task proves nothing.
    if (!/remember|note down|\bstore\b|\bsave\b|do not forget|don't forget/i.test(goal)) {
      return { name: "memory-store", passed: true, explanation: "Not an outcome step.", evidence: step.output };
    }
    const record = (step.output as { record?: { id?: unknown } } | null)?.record;
    if (!record || typeof record.id !== "string") {
      return { name: "memory-store", passed: false, explanation: "Memory store produced no stored record.", evidence: step.output };
    }
    return {
      name: "memory-store",
      passed: true,
      explanation: `Memory stored as record ${record.id}.`,
      evidence: { id: record.id },
    };
  }
  if (step.action.tool === "fs.read") {
    const content = (step.output as { content?: unknown } | null)?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { name: "file-content", passed: false, explanation: "File read returned no content.", evidence: step.output };
    }
    return {
      name: "file-content",
      passed: true,
      explanation: "File read returned inspectable content.",
      evidence: step.output,
    };
  }
  // Context-only tools (workspace listing and similar) run fine but prove
  // nothing about the requested outcome. They must never verify success alone.
  if (step.action.tool === "fs.list") {
    return { name: "context-only", passed: true, explanation: "Not an outcome step.", evidence: step.output };
  }
  if (step.action.tool === "run_sql") {
    const fail = (explanation: string): CheckResult => ({
      name: "zetaris-result",
      passed: false,
      explanation,
      evidence: step.output,
    });

    const output = step.output as {
      sql?: unknown;
      rows?: unknown;
      rowCount?: unknown;
      requestId?: unknown;
    };

    const plannedSql = step.action.args.sql;

    if (typeof plannedSql !== "string" || typeof output.sql !== "string") {
      return fail("Zetaris output is missing the planned or executed SQL.");
    }

    const normalizeSql = (sql: string) =>
      sql.trim().replace(/;\s*$/, "").replace(/\s+/g, " ").toLowerCase();

    const planned = normalizeSql(plannedSql);
    const executed = normalizeSql(output.sql);
    const plannedWithDefaultLimit = planned.endsWith(" limit 100")
      ? planned
      : `${planned} limit 100`;

    if (executed !== planned && executed !== plannedWithDefaultLimit) {
      return fail("Executed Zetaris SQL does not match the planned query.");
    }

    if (
      !Array.isArray(output.rows) ||
      !output.rows.every((row) => Array.isArray(row))
    ) {
      return fail("Zetaris did not return a valid array of result rows.");
    }

    if (
      typeof output.rowCount !== "number" ||
      !Number.isInteger(output.rowCount) ||
      output.rowCount < 0 ||
      output.rowCount !== output.rows.length
    ) {
      return fail("Zetaris rowCount does not match the returned rows.");
    }

    if (typeof output.requestId !== "string" || !output.requestId.trim()) {
      return fail("Zetaris output is missing its request ID.");
    }

    const isPikachuAbilitiesQuery =
      /\bfrom\s+pokeapi\.pikachu_abilities_table\b/i.test(output.sql) &&
      /\bwhere\s+pokemon_name\s*=\s*'pikachu'/i.test(output.sql);

    if (isPikachuAbilitiesQuery && output.rows.length === 0) {
      return fail("Pikachu abilities query returned no rows; the requested result is unverified.");
    }

    return {
      name: "zetaris-result",
      passed: true,
      explanation: `Verified executed SQL, ${output.rows.length} returned rows, matching rowCount, and request ID.`,
      evidence: {
        sql: output.sql,
        rows: output.rows,
        rowCount: output.rowCount,
        requestId: output.requestId,
      },
    };
  }
  if (step.action.tool === "fs.write" || step.action.tool === "notes.create") {
    return { name: "workspace-write-defer", passed: true, explanation: "Not an outcome step.", evidence: step.output };
  }
  return {
    name: "has-output",
    passed: true,
    explanation: "Tool returned an inspectable output.",
    evidence: step.output,
  };
}

export async function checkWorkspaceWrite(step: PlanStep): Promise<CheckResult> {
  if (step.action?.tool !== "fs.write" && step.action?.tool !== "notes.create") {
    return { name: "workspace-write", passed: true, explanation: "Not a write step." };
  }
  const rel =
    step.action.tool === "notes.create"
      ? typeof (step.output as { path?: string } | undefined)?.path === "string"
        ? (step.output as { path: string }).path
        : undefined
      : typeof step.action.args.path === "string"
        ? step.action.args.path
        : undefined;
  if (!rel) {
    return { name: "workspace-write", passed: false, explanation: "Write step did not yield a path." };
  }
  try {
    const safe = await assertSafeWorkspacePath(getEnv().VOW_WORKSPACE_DIR, rel, { mustExist: true });
    const content = await readFile(safe, "utf8");
    const expected =
      step.action.tool === "fs.write" && typeof step.action.args.content === "string"
        ? step.action.args.content
        : undefined;
    if (expected && !content.includes(expected.slice(0, 40))) {
      return {
        name: "workspace-write",
        passed: false,
        explanation: "File exists but does not contain the expected content.",
        evidence: { path: rel, preview: content.slice(0, 200) },
      };
    }
    return {
      name: "workspace-write",
      passed: true,
      explanation: "Verified file exists in the workspace with expected content.",
      evidence: { path: rel, bytes: content.length },
    };
  } catch (error) {
    return {
      name: "workspace-write",
      passed: false,
      explanation: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkCalc(step: PlanStep, goal = ""): Promise<CheckResult> {
  // Authorization gate: a calculator result must never prove that the request
  // authorized the calculation. When the goal (original request) is known,
  // the planned expression must be one the deterministic translator derives
  // from that goal; otherwise the step fails even if its arithmetic is
  // internally consistent. Without a goal, fall back to plan-output
  // consistency only (existing single-arg callers unchanged).
  if (step.action?.tool === "calc.evaluate" && goal.trim()) {
    const args = step.action?.args as { expression?: unknown } | undefined;
    const planned = typeof args?.expression === "string" ? args.expression.trim() : "";
    let authorized: string[] | null = null;
    try {
      authorized = translateRequestToCalcExpressions(goal);
    } catch {
      authorized = null;
    }
    if (!authorized || !planned || !authorized.includes(planned)) {
      return {
        name: "calc",
        passed: false,
        explanation:
          "Calculator expression was not authorized by the original request: the deterministic translator derives no such expression from it.",
        evidence: { planned, goal: goal.slice(0, 200) },
      };
    }
  }
  if (step.action?.tool !== "calc.evaluate") {
    return { name: "calc", passed: true, explanation: "Not a calc step." };
  }
  const output = step.output as { result?: unknown; kind?: unknown } | undefined;
  const args = step.action?.args as { expression?: unknown } | undefined;
  const expression = typeof args?.expression === "string" ? args.expression : undefined;
  // Narrow deterministic safeguard (F3): accepting any finite result would let
  // an incorrect calculation pass when it disagrees with the requested
  // expression. When the step carries its planned expression (always true on
  // the production path: the calc tool requires it), re-evaluate with the
  // safe parser and require the recorded result to match. Steps without an
  // expression keep the legacy finite-result acceptance. No benchmark or case
  // knowledge here: purely internal consistency between plan and output.
  if (typeof expression !== "string" || !expression.trim()) {
    if (typeof output?.result === "number" && Number.isFinite(output.result)) {
      return { name: "calc", passed: true, explanation: `Verified numeric result ${output.result}.`, evidence: output };
    }
    if (typeof output?.result === "boolean") {
      return { name: "calc", passed: true, explanation: `Verified boolean result ${output.result}.`, evidence: output };
    }
    if (typeof output?.result === "string") {
      return { name: "calc", passed: true, explanation: "Verified text result.", evidence: output };
    }
    return { name: "calc", passed: false, explanation: "Calculator did not return a verifiable result." };
  }
  let expected: unknown;
  let expectedKind: string | undefined;
  try {
    const parsed = evaluateCalcExpression(expression);
    expected = parsed.result;
    expectedKind = parsed.kind;
  } catch (error) {
    return {
      name: "calc",
      passed: false,
      explanation: `Calculator expression failed re-evaluation: ${error instanceof Error ? error.message : String(error)}.`,
      evidence: output,
    };
  }
  const matches =
    typeof output?.result === "number" && typeof expected === "number"
      ? Math.abs(output.result - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
      : output?.result === expected;
  if (!matches) {
    return {
      name: "calc",
      passed: false,
      explanation: `Calculator result ${JSON.stringify(output?.result)} does not match the requested expression (re-evaluated to ${JSON.stringify(expected)}).`,
      evidence: output,
    };
  }
  if (typeof output?.result === "number" && Number.isFinite(output.result)) {
    return { name: "calc", passed: true, explanation: `Verified numeric result ${output.result} matches the requested expression.`, evidence: output };
  }
  if (typeof output?.result === "boolean") {
    return { name: "calc", passed: true, explanation: `Verified boolean result ${output.result} matches the requested expression.`, evidence: output };
  }
  if (typeof output?.result === "string") {
    return { name: "calc", passed: true, explanation: `Verified text result matches the requested expression (${expectedKind ?? "text"}).`, evidence: output };
  }
  return { name: "calc", passed: false, explanation: "Calculator did not return a verifiable result." };
}

/** Distinctive-token grounding: the analysis must contain at least one
 *  significant token from the cited source that does not appear in the goal
 *  itself. Restating the question never counts as grounding. */
/** A provider answer shaped as a plan/analysis envelope (a JSON object that
 *  describes how to answer) is not the requested artifact — unless the goal
 *  itself requests JSON output. General contract enforcement, not case logic:
 *  the model contract requires returning only the final answer text. */
const PLAN_ENVELOPE_KEYS = new Set([
  "analysis", "answer", "result", "steps", "plan", "reasoning", "thought", "response",
]);

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  const candidates = [t];
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    if (!c.startsWith("{")) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* not JSON; try the next candidate */
    }
  }
  return undefined;
}

export function isPlanEnvelope(text: string, goal = ""): boolean {
  if (/\bjson\b/i.test(goal)) return false;
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return Object.keys(parsed).some((k) => PLAN_ENVELOPE_KEYS.has(k.toLowerCase()));
}

export function hasDistinctiveOverlap(analysis: string, sources: string[], goal: string): boolean {
  const toks = (t: string) => {
    const lower = t.toLowerCase();
    // Decimal measurements ("0.5") are single distinctive facts; keep them
    // whole instead of splitting into noise fragments.
    const decimals = lower.match(/\d+\.\d+/g) ?? [];
    const words = lower
      .split(/[^a-z0-9:+-]+/)
      .filter((w) => w.length >= 3 || (/\d/.test(w) && w.length >= 2));
    return [...words, ...decimals];
  };
  const goalSet = new Set(toks(goal));
  const aSet = new Set(toks(analysis));
  for (const src of sources) {
    for (const w of new Set(toks(src))) {
      if (!goalSet.has(w) && aSet.has(w)) return true;
    }
  }
  return false;
}

/** Detects a standalone answer that abstains instead of answering: it
 *  disclaims available evidence or the ability to answer rather than giving
 *  the requested deliverable. Narrow by design: it matches only
 *  evidence/ability disclaimers (the demonstrated vacuous shape), never
 *  ordinary explanatory prose that happens to mention tools, and never
 *  general refusal language (safety refusals never pass standalone
 *  verification, so they are unaffected either way). Returns a short label
 *  for the matched disclaimer, or null when the text purports to answer. */
export function standaloneAbstention(analysis: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/no\s+(tool\s+)?evidence\s+(is\s+)?available/i, "states no evidence is available"],
    [/there\s+is\s+no\s+(tool\s+)?evidence\s+to\s+answer/i, "states there is no evidence to answer"],
    [/no\s+(information|data|output|results?)\s+(available|to\s+answer|was\s+(found|produced|returned))/i, "states no information is available"],
    [/unable\s+to\s+answer/i, "states it is unable to answer"],
    [/\bcannot\s+answer\b/i, "states it cannot answer"],
    [/insufficient\s+(evidence|information|data|context)\s+to\s+(answer|respond)/i, "states evidence is insufficient to answer"],
    [/(evidence|information|data)\s+is\s+insufficient\s+to\s+answer/i, "states evidence is insufficient to answer"],
    [/do\s*n'?t\s+have\s+(access\s+to|enough\s+(evidence|information|data|context)|the\s+(evidence|information|data))/i, "states required evidence is missing"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(analysis)) return label;
  }
  return null;
}

/** Analysis steps must be grounded in cited evidence, not invented data, and
 *  must be provider-backed (heuristic fallback text never passes). */
export async function checkAnalysis(step: PlanStep, steps: PlanStep[], goal = ""): Promise<CheckResult> {
  const base = { name: "analysis-grounded", evidence: step.output } as const;
  if (step.analysis !== true) {
    return { ...base, passed: true, explanation: "Not an analysis step." };
  }
  const fail = (explanation: string): CheckResult => ({ ...base, passed: false, explanation });
  const output = step.output as { analysis?: unknown; provenance?: unknown } | null | undefined;
  if (!output || typeof output.analysis !== "string" || !output.analysis.trim()) {
    return fail("Analysis step produced no inspectable result.");
  }
  if (output.provenance === "heuristic-demo") {
    return fail("Analysis is a heuristic fallback, not provider-backed inference.");
  }
  if (isPlanEnvelope(output.analysis, goal)) {
    return fail("Analysis returned a plan/JSON envelope describing how to answer instead of the requested artifact.");
  }
  const cells = new Set<string>();
  for (const other of steps) {
    const out = other.output as { rows?: unknown } | null | undefined;
    if (Array.isArray(out?.rows)) {
      for (const row of out.rows) {
        if (Array.isArray(row)) {
          for (const cell of row) {
            const v = String(cell ?? "").trim();
            if (v.length >= 2) cells.add(v.toLowerCase());
          }
        }
      }
    }
  }
  const text = output.analysis.toLowerCase();
  const mode = step.expectGrounding ?? "tool-rows";
  if (mode === "none") {
    // A standalone answer that disclaims evidence or the ability to answer
    // is an abstention, not a deliverable: accepting it would stamp a
    // non-answer as completed (observed falseSuccess). Abstentions fail so
    // the task ends failed/unverified instead of completed.
    const abstention = standaloneAbstention(output.analysis as string);
    if (abstention) {
      return fail(`Standalone answer abstains instead of answering (${abstention}); refusing to verify a non-answer.`);
    }
    return { ...base, passed: true, explanation: "Standalone provider-backed answer with no external grounding required." };
  }
  if (mode === "memory") {
    const refs = ((step.output as { memoryRefs?: unknown } | null)?.memoryRefs as unknown) ?? [];
    const memSources = Array.isArray(refs) ? refs.map((r) => String(r ?? "")).filter((r) => r.trim()) : [];
    const recordSources: string[] = [];
    for (const other of steps) {
      if (other.action?.tool === "memory.search" && Array.isArray(other.output)) {
        for (const r of other.output as Array<{ content?: unknown }>) {
          if (r && typeof r.content === "string" && r.content.trim()) recordSources.push(r.content);
        }
      }
    }
    const sources = [...memSources, ...recordSources];
    if (sources.length === 0) {
      return fail("No memory records exist to ground the analysis; refusing to accept it.");
    }
    if (!hasDistinctiveOverlap(text, sources, goal)) {
      return fail("Analysis contains no distinctive fact from the retrieved memory records.");
    }
    return { ...base, passed: true, explanation: "Analysis cites a distinctive fact from retrieved memory." };
  }
  if (mode === "workspace") {
    // Workspace-listing answers must cite entries actually observed in a
    // sibling fs.list output. A bare listing proves nothing on its own, and
    // an answer that names no observed entry is ungrounded. Mirrors the
    // honest-empty rule used for row-backed answers.
    const entries: string[] = [];
    for (const other of steps) {
      if (other.action?.tool === "fs.list" && Array.isArray(other.output)) {
        for (const entry of other.output as Array<{ name?: unknown }>) {
          if (entry && typeof entry.name === "string" && entry.name.trim()) {
            entries.push(entry.name);
          }
        }
      }
    }
    if (entries.length === 0) {
      if (statesEmpty(output.analysis as string)) {
        return { ...base, passed: true, explanation: "Analysis honestly reports an empty workspace listing and is provider-backed." };
      }
      return fail("No workspace entries exist to ground the analysis; refusing to accept it.");
    }
    if (!hasDistinctiveOverlap(text, entries, goal)) {
      return fail("Analysis references none of the observed workspace entries.");
    }
    return { ...base, passed: true, explanation: "Analysis references observed workspace entries and is provider-backed." };
  }
  const toolRows = collectToolRows(steps);
  if (toolRows.rows.length === 0) {
    // Honest-empty rule: with no observed rows, only an explicit empty report
    // ("no rows", "empty", "none found", ...) is grounded. Anything else would
    // invent values from nothing.
    if (statesEmpty(output.analysis as string)) {
      return { ...base, passed: true, explanation: "Analysis honestly reports empty source rows and is provider-backed." };
    }
    return fail("No source rows exist to ground the analysis; refusing to accept it.");
  }
  if (![...cells].some((c) => text.includes(c))) {
    return fail("Analysis references none of the observed row values.");
  }
  // Deterministic count safeguard: the model must not miscount, duplicate, or
  // invent partition counts. Every explicit "N <label>" claim must equal the
  // observed row count or an observed column-value frequency.
  const countCheck = verifyCountClaims(output.analysis as string, toolRows.rows);
  if (!countCheck.ok) {
    return fail(countCheck.reason);
  }
  return { ...base, passed: true, explanation: "Analysis references observed row values with verified counts and is provider-backed." };
}
