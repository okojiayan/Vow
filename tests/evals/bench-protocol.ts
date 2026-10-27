/* Resilient staged-execution protocol for the frozen 100-case benchmark.
 * Pure helpers only: no network, no model calls, no scoring changes.
 * Cases, graders, model identity, decoding and scoring live in the harness;
 * this module only slices batches, classifies transport failures, trips a
 * circuit breaker, and computes supplementary (non-scoring) rate views. */

export interface BatchConfig {
  batchSize: number;
  batchIndex: number;
  cooldownMs: number;
  cbThreshold: number;
}

export function getBatchConfig(env: Record<string, string | undefined> = process.env): BatchConfig {
  const num = (v: string | undefined, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
  };
  return {
    batchSize: num(env.BENCH_BATCH_SIZE, 100),
    batchIndex: Math.max(0, Math.floor(Number(env.BENCH_BATCH_INDEX ?? 0)) || 0),
    cooldownMs: Math.max(0, Math.floor(Number(env.BENCH_COOLDOWN_MS ?? 0)) || 0),
    cbThreshold: num(env.BENCH_CB_THRESHOLD, 6),
  };
}

/** Deterministic slice of the ordered case list. Matched A/B pairing is
 *  preserved because both modes iterate the same slice in the same order. */
export function sliceBatch<T extends { id: string }>(items: T[], size: number, index: number): T[] {
  const s = Math.max(1, Math.floor(size));
  const i = Math.max(0, Math.floor(index));
  return items.slice(i * s, i * s + s);
}

/** Case IDs in targets with no saved record yet (checkpoint resume). */
export function pendingIds(targets: Array<{ id: string }>, savedIds: Set<string>): string[] {
  return targets.filter((t) => !savedIds.has(t.id)).map((t) => t.id);
}

const INFRA_PATTERNS = [
  /http 50[23]\b/i,
  /\btimed?\s?out/i,
  /\btimeout\b/i,
  /aborted due to timeout/i,
  /aborterror/i,
  /econn(?:refused|reset|aborted)?/i,
  /enotfound/i,
  /socket hang up/i,
  /network/i,
  /fetch failed/i,
  /empty model/i,
  /no healthy/i,
  /service unavailable/i,
];

/** True when an error string describes infrastructure/transport failure rather
 *  than a task-quality outcome. Applied to error text only, never to answers. */
export function isInfraFailureText(text: string | null | undefined): boolean {
  if (!text) return false;
  return INFRA_PATTERNS.some((re) => re.test(text));
}

/** True when a run executed but the serving model is not the intended one.
 *  Null (unknown) model is not a mismatch — only a positive mismatch trips. */
export function isIdentityMismatch(runModel: string | null, liveModel: string): boolean {
  if (!runModel) return false;
  return runModel !== liveModel;
}

export interface BreakerObservation {
  infra: boolean;
  caseId: string;
  mode: string;
  detail: string;
}

export interface BreakerSnapshot {
  tripped: boolean;
  consecutive: number;
  total: number;
  threshold: number;
  reason: string | null;
  atCaseId: string | null;
  atMode: string | null;
  atTime: string | null;
}

/** Trips after `threshold` consecutive infra observations; any successful
 *  provider execution resets the streak. Bounded: observation only. */
export class CircuitBreaker {
  consecutive = 0;
  total = 0;
  tripped = false;
  reason: string | null = null;
  atCaseId: string | null = null;
  atMode: string | null = null;
  atTime: string | null = null;

  constructor(readonly threshold: number = 6) {}

  observe(o: BreakerObservation): boolean {
    if (this.tripped) return true;
    if (o.infra) {
      this.consecutive += 1;
      this.total += 1;
      if (this.consecutive >= this.threshold) {
        this.tripped = true;
        this.reason = `Circuit breaker tripped after ${this.consecutive} consecutive infrastructure failures (last: ${o.mode} ${o.caseId}: ${o.detail}).`;
        this.atCaseId = o.caseId;
        this.atMode = o.mode;
        this.atTime = new Date().toISOString();
      }
    } else {
      this.consecutive = 0;
    }
    return this.tripped;
  }

  snapshot(): BreakerSnapshot {
    return {
      tripped: this.tripped,
      consecutive: this.consecutive,
      total: this.total,
      threshold: this.threshold,
      reason: this.reason,
      atCaseId: this.atCaseId,
      atMode: this.atMode,
      atTime: this.atTime,
    };
  }
}

export interface RateSplit {
  assigned: number;
  passed: number;
  endToEndPct: number;
  providerOk: number;
  infraFailed: number;
  passedGivenProviderOk: number;
  conditionalPct: number | null;
}

/** Supplementary reporting view (does not alter scoring): end-to-end rate
 *  over all assigned runs vs. task-quality rate conditional on the provider
 *  having executed. Infrastructure failures stay visible in the denominator
 *  of the end-to-end rate and are counted separately. */
export function splitRates(runs: Array<{ pass: boolean; ok: boolean }>): RateSplit {
  const assigned = runs.length;
  const passed = runs.filter((r) => r.pass).length;
  const infraFailed = runs.filter((r) => !r.ok).length;
  const providerOk = assigned - infraFailed;
  const passedGivenProviderOk = runs.filter((r) => r.ok && r.pass).length;
  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
  return {
    assigned,
    passed,
    endToEndPct: pct(passed, assigned),
    providerOk,
    infraFailed,
    passedGivenProviderOk,
    conditionalPct: providerOk === 0 ? null : pct(passedGivenProviderOk, providerOk),
  };
}

/* ---- Result provenance (measurement only, no scoring changes) ----
 * plannerPath distinguishes how a run's result was actually produced, from
 * observed trace evidence only. It never substitutes the configured model
 * name for an observed provider response:
 * - "provider-analysis": a live provider response was observed (a
 *   model_response carrying a real model identity, or a live-model plan).
 * - "mixed": provider-backed analysis combined with tool-grounded evidence.
 * - "deterministic-tool": no provider response observed; the deliverable came
 *   from deterministic local tools (e.g. calc.evaluate) and passed
 *   verification against that tool evidence.
 * - "tool-grounded": no provider response observed; external tools (memory,
 *   SQL, shell) grounded the result.
 * - "heuristic-fallback": no provider response and no grounding tool output;
 *   the result (if any) is heuristic/demo text.
 * - "not-invoked": the run never executed (transport/timeout/crash before
 *   any planning or inference step). */
export type PlannerPath =
  | "provider-analysis"
  | "mixed"
  | "deterministic-tool"
  | "tool-grounded"
  | "heuristic-fallback"
  | "not-invoked";

/** Tools whose outputs are fully deterministic local computations. */
export const DETERMINISTIC_TOOLS = new Set(["calc.evaluate"]);

export function classifyPlannerPath(input: {
  executed: boolean;
  providerProvenance: string[];
  planInferenceModes: string[];
  toolNames: string[];
  verified: boolean | null;
}): PlannerPath {
  if (!input.executed) return "not-invoked";
  const realProvider =
    input.providerProvenance.some((prov) => prov !== "heuristic-demo") ||
    input.planInferenceModes.includes("live-model");
  const grounded = input.toolNames.length > 0;
  if (realProvider && grounded) return "mixed";
  if (realProvider) return "provider-analysis";
  if (grounded) {
    return input.toolNames.every((t) => DETERMINISTIC_TOOLS.has(t)) && input.verified === true
      ? "deterministic-tool"
      : "tool-grounded";
  }
  return "heuristic-fallback";
}

/* ---- Stability-gate evaluation, checkpoint validation, outdir guard ----
 * Pure helpers (no network, no scoring changes). The gate script and the
 * harness share these rules so the mocked tests verify the real contract. */

/** Minimum consecutive successful inference probes a gate must show. */
export const GATE_MIN_CHATS = 3;

/* ---- Benchmark timeout policy (pure, no network) ----
 * Observed Nightshift behavior (see docs/evals/intelligence-repair-pass.md):
 * /models 200 in ~5.2s, minimal chats 200 in ~17.8s / ~13.1s / ~2.2s, with
 * genuine successes needing 39-45s. The prior harness used 4s for
 * probeMeterless(), 8s for the inline /models fetch, and 30s for chat calls,
 * so healthy-but-slow responses were classified as infra failures.
 * Selected policy (benchmark-only, production defaults unchanged):
 * - modelCallTimeoutMs: 60s per model call (both modes, gate + preflight).
 *   Bounded (15s..120s clamp) with margin over the slowest observed success.
 * - taskDeadlineMs: 300s per full VOW task (Mode B race deadline). Bounded
 *   (120s..600s) and floored at 3x the per-call timeout so a task can make
 *   several sequential model calls plus orchestration overhead.
 * Gate, preflight probe, inline listing fetch, Mode A completeChat, and
 * Mode B (via orchestrator -> completeChat) all share modelCallTimeoutMs.
 * The task deadline stays separate and longer. All values are recorded in
 * experiment metadata; retry/breaker/identity/checkpoint rules unchanged.
 * Invalid configuration (non-numeric timeouts, or an explicit task deadline
 * below 3x the per-call budget) throws instead of silently falling back, and
 * the harness refuses a gate whose recorded budget is more lenient than the
 * run's per-call budget. */
export const BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS = 60_000;
export const BENCH_DEFAULT_TASK_DEADLINE_MS = 300_000;

/** Bounds for the single benchmark-only per-model-request budget (ms). */
export const BENCH_MODEL_TIMEOUT_MIN_MS = 15_000;
export const BENCH_MODEL_TIMEOUT_MAX_MS = 120_000;
/** Bounds for the separate full-task deadline (ms). */
export const BENCH_TASK_DEADLINE_MIN_MS = 120_000;
export const BENCH_TASK_DEADLINE_MAX_MS = 600_000;
/** The task deadline must cover at least this many sequential model calls. */
export const BENCH_TASK_DEADLINE_MULTIPLE = 3;

export interface BenchTimeoutPolicy {
  modelCallTimeoutMs: number;
  taskDeadlineMs: number;
}

/** Parse an explicitly configured timeout var. Unset/blank -> null (default
 *  applies). Explicitly set but non-numeric or non-positive -> throw: invalid
 *  benchmark configuration must fail fast, never silently fall back. */
function parseBenchTimeoutVar(
  raw: string | undefined,
  name: string,
): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid ${name}=${JSON.stringify(raw)}: must be a positive number of milliseconds. ` +
        `Unset it to use the default.`,
    );
  }
  return Math.floor(n);
}

export function getBenchTimeoutPolicy(
  env: Record<string, string | undefined> = process.env,
): BenchTimeoutPolicy {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const modelRaw = parseBenchTimeoutVar(env.BENCH_MODEL_TIMEOUT_MS, "BENCH_MODEL_TIMEOUT_MS");
  const modelCallTimeoutMs = clamp(
    modelRaw ?? BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS,
    BENCH_MODEL_TIMEOUT_MIN_MS,
    BENCH_MODEL_TIMEOUT_MAX_MS,
  );
  const deadlineRaw = parseBenchTimeoutVar(env.BENCH_TASK_DEADLINE_MS, "BENCH_TASK_DEADLINE_MS");
  let taskDeadlineMs = clamp(
    deadlineRaw ?? BENCH_DEFAULT_TASK_DEADLINE_MS,
    BENCH_TASK_DEADLINE_MIN_MS,
    BENCH_TASK_DEADLINE_MAX_MS,
  );
  const floor = BENCH_TASK_DEADLINE_MULTIPLE * modelCallTimeoutMs;
  if (taskDeadlineMs < floor) {
    if (deadlineRaw !== null) {
      throw new Error(
        `Contradictory benchmark timeouts: BENCH_TASK_DEADLINE_MS=${deadlineRaw}ms is below ` +
          `${BENCH_TASK_DEADLINE_MULTIPLE}x the per-model-call budget ` +
          `(${modelCallTimeoutMs}ms -> floor ${floor}ms). ` +
          `Raise the deadline or lower BENCH_MODEL_TIMEOUT_MS.`,
      );
    }
    taskDeadlineMs = floor;
  }
  return { modelCallTimeoutMs, taskDeadlineMs };
}

/** Gate/harness timeout compatibility (pure). A gate pass only authorizes a
 *  benchmark run when the gate probed with a budget at least as strict as the
 *  run's per-model-call budget: a lenient gate (larger timeoutMs) cannot prove
 *  the service answers within a tighter benchmark budget, and a gate without
 *  a recorded timeoutMs predates the aligned policy entirely. */
export function isGateTimeoutCompatible(
  gateTimeoutMs: unknown,
  modelCallTimeoutMs: number,
): { compatible: boolean; reason: string } {
  if (typeof gateTimeoutMs !== "number" || !Number.isFinite(gateTimeoutMs) || gateTimeoutMs <= 0) {
    return {
      compatible: false,
      reason:
        "gate record has no timeoutMs (predates the aligned timeout policy); " +
        "re-run the stability gate so its budget is recorded",
    };
  }
  if (gateTimeoutMs > modelCallTimeoutMs) {
    return {
      compatible: false,
      reason:
        `gate budget ${gateTimeoutMs}ms is more lenient than the benchmark per-model-call budget ` +
          `${modelCallTimeoutMs}ms; a gate pass does not prove the service answers within the ` +
          `benchmark budget, so re-run the gate with --timeout-ms=${modelCallTimeoutMs}`,
    };
  }
  return {
    compatible: true,
    reason:
      `gate budget ${gateTimeoutMs}ms is at least as strict as the benchmark per-model-call ` +
      `budget ${modelCallTimeoutMs}ms`,
  };
}

export interface GateCheckRecord {
  name?: string;
  ok?: boolean;
  status?: number;
  model?: string | null;
  containsLiveModel?: boolean;
  count?: number;
  error?: string;
}

export interface GateRecord {
  passed?: boolean;
  liveModel?: string;
  timeoutMs?: number;
  checks?: GateCheckRecord[];
}

/** Evaluate a gate.json payload against the intended model. Pure. */
export function evaluateStabilityGate(
  gate: GateRecord | null | undefined,
  expectedModel: string,
  minChats: number = GATE_MIN_CHATS,
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!gate || typeof gate !== "object") return { passed: false, reasons: ["gate record missing or unreadable"] };
  if (gate.liveModel !== expectedModel) {
    reasons.push(`gate liveModel ${JSON.stringify(gate.liveModel)} does not match expected ${expectedModel}`);
  }
  const checks = Array.isArray(gate.checks) ? gate.checks : [];
  const models = checks.find((c) => c.name === "models");
  if (!models || models.ok !== true) {
    reasons.push(`model listing check failed${models?.status ? ` (HTTP ${models.status})` : ""}${models?.error ? `: ${models.error}` : ""}`);
  } else if (models.containsLiveModel !== true) {
    reasons.push("model listing does not contain the intended model (empty or mismatched listing)");
  }
  const chatOks = checks.filter(
    (c) => typeof c.name === "string" && c.name.startsWith("chat") && c.ok === true && c.model === expectedModel,
  );
  if (chatOks.length < minChats) {
    reasons.push(`only ${chatOks.length} successful identity-matched inference probe(s), need ${minChats} consecutive`);
  }
  const mismatch = checks.find(
    (c) => typeof c.name === "string" && c.name.startsWith("chat") && c.ok === true && c.model != null && c.model !== expectedModel,
  );
  if (mismatch) {
    reasons.push(`provider returned model ${JSON.stringify(mismatch.model)} instead of ${expectedModel}`);
  }
  if (gate.passed !== true) reasons.push("gate file itself reports passed=false");
  return { passed: reasons.length === 0, reasons };
}

/** A gate authorizes only runs recorded after it passed. Pure mtime compare. */
export function isGateFresh(
  gateMtimeMs: number,
  newestProtectedMtimeMs: number | null,
): boolean {
  if (!Number.isFinite(gateMtimeMs)) return false;
  if (newestProtectedMtimeMs == null) return true;
  return gateMtimeMs > newestProtectedMtimeMs;
}

/* ---- Readiness-gate cadence amendment (pure policy, no scoring changes) ----
 * Full 3-probe gates stay mandatory at tier transitions, after any
 * prior-batch infrastructure failure, under operator override
 * (BENCH_GATE_FULL=1), and on even batch indexes — roughly every two
 * batches. Other batches (odd index after a clean prior batch) need only a
 * light 1-probe gate. The cheap /models preflight still runs every batch,
 * gate freshness (mtime newer than protected runs) is unchanged, timeouts,
 * retry, breaker, grading, case order and run identity are untouched, and
 * the gate file always records the depth that actually ran (minChats). */

/** Consecutive probes required by a full vs a light readiness gate. */
export const GATE_FULL_CHATS = 3;
export const GATE_LIGHT_CHATS = 1;

export interface GateScheduleInput {
  batchIndex: number;
  /** True when this OUTDIR holds no completed prior batch (fresh tier dir). */
  freshTier: boolean;
  /** True when the previous batch shows any infrastructure-failure marker. */
  priorInfraFailure: boolean;
  /** Operator escape hatch (BENCH_GATE_FULL=1): force a full gate. */
  forceFull: boolean;
}

export interface GateScheduleDecision {
  chats: 3 | 1;
  reasons: string[];
}

/** Gate-cadence policy: which gate depth the harness must enforce. Pure. */
export function requiredGateChats(input: GateScheduleInput): GateScheduleDecision {
  if (input.freshTier) return { chats: 3, reasons: ["tier-transition: no prior batch in this OUTDIR"] };
  if (input.forceFull) return { chats: 3, reasons: ["operator override BENCH_GATE_FULL=1"] };
  if (input.priorInfraFailure) return { chats: 3, reasons: ["prior batch showed an infrastructure failure"] };
  if (input.batchIndex % 2 === 0) return { chats: 3, reasons: ["cadence: full gate on even batch index"] };
  return { chats: 1, reasons: ["cadence: light gate permitted after a clean prior batch"] };
}

export interface InfraScanRecord {
  caseId?: unknown;
  ok?: unknown;
  pass?: unknown;
  retried?: unknown;
  firstError?: unknown;
  error?: unknown;
}

/** True when any record for the previous batch's cases carries an
 * infrastructure marker: an unrecovered ok=false, any recorded retry (the
 * retry pass only retries cases whose first attempt failed to produce a
 * usable result), or infrastructural text on a completed record. Pure;
 * completed task failures without such markers never count. */
export function priorBatchInfraHit(records: InfraScanRecord[], prevCaseIds: string[]): boolean {
  const scope = new Set(prevCaseIds);
  return records.some((r) => {
    if (typeof r.caseId !== "string" || !scope.has(r.caseId)) return false;
    if (r.ok === false) return true;
    if (r.retried === true) return true;
    const first =
      typeof r.firstError === "string" ? r.firstError : typeof r.error === "string" ? r.error : "";
    return isInfraFailureText(first);
  });
}

const FROZEN_OUTDIR_PATTERNS = [/baseline/i, /storm/i, /interim/i, /holdout/i];

/** Refuse to write confirmatory results into frozen snapshot dirs. Pure. */
export function assertBenchOutdir(outdir: string): void {
  const base = outdir.replace(/\/+$/, "").split("/").pop() ?? outdir;
  if (FROZEN_OUTDIR_PATTERNS.some((re) => re.test(base)) && process.env.BENCH_ALLOW_FROZEN_OUTDIR !== "1") {
    throw new Error(
      `Refusing OUTDIR ${outdir}: it looks like a frozen snapshot (baseline/storm/interim/holdout). ` +
        `Write confirmatory results to a fresh post-fix directory instead.`,
    );
  }
}

export interface StoredRunShape {
  runId?: unknown;
  caseId?: unknown;
  mode?: unknown;
  ok?: unknown;
  [key: string]: unknown;
}

/** Structural validation of one saved run record before reuse. Pure. */
export function validateRunRecord(
  rec: StoredRunShape | null | undefined,
  mode: string,
  validIds: Set<string>,
): { valid: boolean; reason: string } {
  if (!rec || typeof rec !== "object") return { valid: false, reason: "not an object" };
  if (typeof rec.caseId !== "string" || !validIds.has(rec.caseId)) {
    return { valid: false, reason: `unknown caseId ${JSON.stringify(rec.caseId)}` };
  }
  if (rec.mode !== mode) return { valid: false, reason: `mode ${JSON.stringify(rec.mode)} !== ${mode}` };
  if (typeof rec.runId !== "string" || rec.runId.length === 0) return { valid: false, reason: "missing runId" };
  if (typeof rec.ok !== "boolean") return { valid: false, reason: "missing ok flag" };
  return { valid: true, reason: "ok" };
}

/** Merge saved records for resume: first valid record per target case wins;
 *  invalid, foreign, duplicate, or off-mode records are quarantined, never reused. Pure. */
export function mergeSavedRuns<T extends StoredRunShape>(
  saved: T[],
  targets: Array<{ id: string }>,
  mode: string,
  validIds: Set<string>,
): { kept: T[]; quarantined: Array<{ caseId: unknown; reason: string }> } {
  const targetIds = new Set(targets.map((t) => t.id));
  const kept: T[] = [];
  const seen = new Set<string>();
  const quarantined: Array<{ caseId: unknown; reason: string }> = [];
  for (const rec of saved) {
    const v = validateRunRecord(rec, mode, validIds);
    if (!v.valid) {
      quarantined.push({ caseId: (rec as StoredRunShape)?.caseId ?? null, reason: v.reason });
      continue;
    }
    const id = rec.caseId as string;
    if (!targetIds.has(id)) {
      quarantined.push({ caseId: id, reason: "not in current batch targets" });
      continue;
    }
    if (seen.has(id)) {
      quarantined.push({ caseId: id, reason: "duplicate record for caseId" });
      continue;
    }
    seen.add(id);
    kept.push(rec);
  }
  return { kept, quarantined };
}

/** Matched A/B pairing by stable test ID. Pure; scoring untouched. */
export function pairResults(
  runsA: Array<{ caseId: string; pass: boolean }>,
  runsB: Array<{ caseId: string; pass: boolean }>,
): { matched: string[]; bWins: number; aWins: number; ties: number } {
  const mapA = new Map(runsA.map((r) => [r.caseId, r.pass]));
  const mapB = new Map(runsB.map((r) => [r.caseId, r.pass]));
  const matched = [...mapA.keys()].filter((id) => mapB.has(id)).sort();
  let bWins = 0;
  let aWins = 0;
  let ties = 0;
  for (const id of matched) {
    const pa = mapA.get(id) ?? false;
    const pb = mapB.get(id) ?? false;
    if (pb && !pa) bWins += 1;
    else if (pa && !pb) aWins += 1;
    else ties += 1;
  }
  return { matched, bWins, aWins, ties };
}

/* ---- Provenance-aware metrics (measurement only, no scoring changes) ----
 * Headline per-case pass/fail is unchanged. These helpers add SEPARATE
 * metrics that distinguish genuine task success, proven provider-backed
 * success, fallback/unproven execution, and refusal passes, with explicit
 * denominators. A heuristic-demo result can never count as model-backed. */

export type ProvenanceTier =
  | "model-backed"
  | "deterministic-tool"
  | "tool-grounded"
  | "fallback-unproven"
  | "refusal"
  | "not-executed"
  | "failed";

export interface ProvenanceInput {
  pass: boolean;
  ok?: unknown;
  plannerPath?: unknown;
  model?: unknown;
  expectedModel?: string;
  /** True when the case's grade is a refusal/safety test (expectNoComplete). */
  refusalCase?: boolean;
}

const MODEL_BACKED_PATHS = new Set(["provider-analysis", "mixed"]);

/** Classify one run into a provenance tier from RECORDED fields only.
 *  Fail-closed: a pass with heuristic, missing, malformed, or unknown
 *  provenance is "fallback-unproven", never "model-backed". Refusal passes
 *  are "refusal" so they cannot inflate task-completion metrics. Pure. */
export function classifyProvenanceTier(input: ProvenanceInput): ProvenanceTier {
  if (input.refusalCase === true) return input.pass ? "refusal" : "failed";
  const path = typeof input.plannerPath === "string" ? input.plannerPath : "";
  if (path === "" || path === "not-invoked") {
    // A pass with no recorded path still executed, so it is unproven rather
    // than not-executed; fail closed instead of rewarding missing provenance.
    return input.pass ? "fallback-unproven" : "not-executed";
  }
  if (!input.pass) return "failed";
  if (MODEL_BACKED_PATHS.has(path)) {
    const model = typeof input.model === "string" ? input.model : "";
    if (model === "" || model === "heuristic-demo") return "fallback-unproven";
    if (
      typeof input.expectedModel === "string" &&
      input.expectedModel !== "" &&
      model !== input.expectedModel
    ) {
      return "fallback-unproven";
    }
    return "model-backed";
  }
  if (path === "deterministic-tool") return "deterministic-tool";
  if (path === "tool-grounded") return "tool-grounded";
  return "fallback-unproven";
}

export interface ProvenanceMetrics {
  attempted: number;
  /** Runs where a provenance determination was possible (executed runs). */
  eligible: number;
  coveragePct: number;
  /** Non-refusal passes with proven task evidence (model-backed or real tools). */
  taskPass: number;
  taskPassRatePct: number;
  modelBackedPass: number;
  /** Proven model-backed passes over ALL attempted cases. */
  modelBackedRatePct: number;
  /** Proven model-backed passes over eligible cases only; always read with coveragePct. */
  modelBackedEligibleRatePct: number | null;
  deterministicToolPass: number;
  toolGroundedPass: number;
  fallbackUnprovenPass: number;
  refusalPass: number;
  refusalFail: number;
  notExecuted: number;
  failed: number;
}

function ratePct(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 1000) / 10;
}

/** Aggregate provenance tiers with explicit denominators. Pure. */
export function provenanceMetrics(
  runs: ProvenanceInput[],
  opts: { expectedModel?: string } = {},
): ProvenanceMetrics {
  const tiers = runs.map((r) =>
    classifyProvenanceTier({ ...r, expectedModel: r.expectedModel ?? opts.expectedModel }),
  );
  const count = (t: ProvenanceTier) => tiers.filter((x) => x === t).length;
  const attempted = runs.length;
  const notExecuted = count("not-executed");
  const eligible = attempted - notExecuted;
  const modelBackedPass = count("model-backed");
  const taskPass = modelBackedPass + count("deterministic-tool") + count("tool-grounded");
  return {
    attempted,
    eligible,
    coveragePct: ratePct(eligible, attempted),
    taskPass,
    taskPassRatePct: ratePct(taskPass, attempted),
    modelBackedPass,
    modelBackedRatePct: ratePct(modelBackedPass, attempted),
    modelBackedEligibleRatePct: eligible === 0 ? null : ratePct(modelBackedPass, eligible),
    deterministicToolPass: count("deterministic-tool"),
    toolGroundedPass: count("tool-grounded"),
    fallbackUnprovenPass: count("fallback-unproven"),
    refusalPass: count("refusal"),
    refusalFail: tiers.filter((x, i) => runs[i].refusalCase === true && x === "failed").length,
    notExecuted,
    failed: count("failed"),
  };
}

/* ---- Benchmark output isolation (fail before overwriting) ---- */

export const RUN_ARTIFACT_FILES = [
  "runs_A.json",
  "runs_B.json",
  "aggregate.json",
  "results.csv",
] as const;

export type OutdirStatus = "fresh" | "compatible-resume" | "manifest-mismatch" | "ambiguous-prior";

export interface OutdirCompatibility {
  status: OutdirStatus;
  priorManifestVersion: string | null;
  artifactFiles: string[];
  priorRunId: string | null;
}

interface FsDeps {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, enc: "utf8") => string;
}

/** Inspect an output directory WITHOUT writing. Read-only; pure given fsDeps.
 *  - fresh: no run artifacts present, safe to start a new run.
 *  - compatible-resume: artifacts present AND recorded manifest matches the
 *    current one, so a resume retains its original run identity.
 *  - manifest-mismatch: artifacts belong to a different manifest version;
 *    callers must fail and use a fresh directory (fail before overwrite).
 *  - ambiguous-prior: artifacts present but prior manifest unreadable;
 *    fail closed, do not mix. */
export function checkOutdirCompatibility(
  outdir: string,
  currentManifestVersion: string,
  fs: FsDeps,
): OutdirCompatibility {
  const join = (f: string) => `${outdir.replace(/\/+$/, "")}/${f}`;
  const artifactFiles = RUN_ARTIFACT_FILES.filter((f) => {
    try {
      return fs.existsSync(join(f));
    } catch {
      return false;
    }
  });
  let priorRunId: string | null = null;
  try {
    if (fs.existsSync(join("run.json"))) {
      const run = JSON.parse(fs.readFileSync(join("run.json"), "utf8")) as {
        runId?: unknown;
      };
      if (typeof run.runId === "string" && run.runId !== "") priorRunId = run.runId;
    }
  } catch {
    priorRunId = null;
  }
  if (artifactFiles.length === 0) {
    return { status: "fresh", priorManifestVersion: null, artifactFiles, priorRunId };
  }
  let priorManifestVersion: string | null = null;
  try {
    const agg = JSON.parse(fs.readFileSync(join("aggregate.json"), "utf8")) as {
      manifestVersion?: unknown;
      version?: unknown;
    };
    const v = agg.manifestVersion ?? agg.version;
    if (typeof v === "string" && v !== "") priorManifestVersion = v;
  } catch {
    priorManifestVersion = null;
  }
  if (priorManifestVersion == null) {
    return { status: "ambiguous-prior", priorManifestVersion, artifactFiles, priorRunId };
  }
  if (priorManifestVersion !== currentManifestVersion) {
    return { status: "manifest-mismatch", priorManifestVersion, artifactFiles, priorRunId };
  }
  return { status: "compatible-resume", priorManifestVersion, artifactFiles, priorRunId };
}

export interface RunIdentity {
  runId: string;
  manifestVersion: string;
  batches: Array<{ batchIndex: number; batchSize: number; at: string }>;
  createdAt: string;
}

/** Stamp (or extend) the run identity for an output directory.
 *  Throws on manifest mismatch so a new run can never silently join or
 *  overwrite an unrelated run's artifacts. The first writer's runId is kept,
 *  so a staged resume retains its original run identity. */
export function stampRunIdentity(
  outdir: string,
  args: { manifestVersion: string; batchIndex: number; batchSize: number; runId: string },
  fs: {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: "utf8") => string;
    writeFileSync: (p: string, data: string) => void;
    mkdirSync: (p: string, opts: { recursive: boolean }) => unknown;
  },
): RunIdentity {
  const dir = outdir.replace(/\/+$/, "");
  const path = `${dir}/run.json`;
  let prior: RunIdentity | null = null;
  try {
    if (fs.existsSync(path)) {
      prior = JSON.parse(fs.readFileSync(path, "utf8")) as RunIdentity;
    }
  } catch {
    prior = null;
  }
  // Defense in depth: even without a run.json, never join artifacts whose
  // recorded manifest differs. The caller checks compatibility first; the
  // stamp refuses independently so a direct call cannot mix runs either.
  try {
    if (fs.existsSync(`${dir}/aggregate.json`)) {
      const agg = JSON.parse(fs.readFileSync(`${dir}/aggregate.json`, "utf8")) as {
        manifestVersion?: unknown;
      };
      if (typeof agg.manifestVersion === "string" && agg.manifestVersion !== args.manifestVersion) {
        throw new Error(
          `Refusing to stamp run identity in ${outdir}: existing aggregate.json belongs to manifest ` +
            `${agg.manifestVersion}, current manifest is ${args.manifestVersion}. ` +
            `Use a fresh output directory for the new manifest.`,
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Refusing to stamp")) throw e;
  }
  if (prior && typeof prior.manifestVersion === "string" && prior.manifestVersion !== args.manifestVersion) {
    throw new Error(
      `Refusing to stamp run identity in ${outdir}: existing run belongs to manifest ` +
        `${prior.manifestVersion}, current manifest is ${args.manifestVersion}. ` +
        `Use a fresh output directory for the new manifest.`,
    );
  }
  const at = new Date().toISOString();
  const batches = [...((prior && Array.isArray(prior.batches) ? prior.batches : []))];
  if (!batches.some((b) => b.batchIndex === args.batchIndex && b.batchSize === args.batchSize)) {
    batches.push({ batchIndex: args.batchIndex, batchSize: args.batchSize, at });
  }
  const identity: RunIdentity = {
    runId: prior && typeof prior.runId === "string" && prior.runId !== "" ? prior.runId : args.runId,
    manifestVersion: args.manifestVersion,
    batches,
    createdAt: prior && typeof prior.createdAt === "string" ? prior.createdAt : at,
  };
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path, JSON.stringify(identity, null, 1));
  return identity;
}

/* ---- Opt-in explicit case selection (pure, no scoring changes) ----
 * BENCH_CASES is an opt-in, comma-separated allowlist for controlled
 * evaluations (e.g. a 10-case expanded pilot). Semantics:
 * - undefined/empty/whitespace-only => null (no override, default behavior).
 * - Otherwise split on commas, trim, reject empty tokens, reject duplicates,
 *   and reject unknown IDs against the manifest's valid set.
 * - Callers filter the manifest in manifest order so matched A/B pairing
 *   stays deterministic. SMOKE=1 and BENCH_CASES are mutually exclusive;
 *   that interlock lives in the harness (fail-closed on ambiguous config). */
export function parseBenchCaseIds(
  raw: string | undefined,
  validIds: Set<string>,
): string[] | null {
  if (raw == null) return null;
  if (raw.trim() === "") return null;
  const parts = raw.split(",").map((s) => s.trim());
  for (const part of parts) {
    if (part === "") {
      throw new Error(
        `Invalid BENCH_CASES ${JSON.stringify(raw)}: empty case ID (check for leading/trailing commas or double commas).`,
      );
    }
  }
  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part)) {
      throw new Error(`Invalid BENCH_CASES ${JSON.stringify(raw)}: duplicate case ID ${JSON.stringify(part)}.`);
    }
    seen.add(part);
  }
  for (const part of parts) {
    if (!validIds.has(part)) {
      throw new Error(`Invalid BENCH_CASES ${JSON.stringify(raw)}: unknown case ID ${JSON.stringify(part)}.`);
    }
  }
  return parts;
}

/** Filter cases to an explicit ID set, preserving manifest order.
 *  Pure; grading and scoring untouched. */
export function filterCasesByIds<T extends { id: string }>(cases: T[], ids: string[]): T[] {
  const wanted = new Set(ids);
  return cases.filter((c) => wanted.has(c.id));
}

/** Difficulty-tier selection for tiered benchmark manifests (difficulty-v2).
 *  Pure; grading and scoring untouched. BENCH_TIER selects one tier slice of
 *  the manifest and is mutually exclusive with SMOKE=1 and BENCH_CASES (the
 *  runner enforces that). Staged batching (BENCH_BATCH_SIZE/INDEX) still
 *  applies on top of the selected slice. */
export const BENCH_TIERS = ["easy", "easy-medium", "medium", "intermediate-hard", "hardest"] as const;

/** Validate a raw BENCH_TIER value against the tiers present in the manifest.
 *  Returns null when unset. Throws on unknown tiers, including any value when
 *  the manifest carries no tiered cases (backward compatibility with v1). */
export function parseBenchTier(
  raw: string | undefined,
  available: Set<string>,
): string | null {
  if (raw == null || raw.trim() === "") return null;
  const t = raw.trim();
  if (!available.has(t)) {
    throw new Error(
      `Invalid BENCH_TIER ${JSON.stringify(raw)}: manifest tiers are [${[...available].sort().join(", ")}].`,
    );
  }
  return t;
}

/** Filter cases to one difficulty tier, preserving manifest order.
 *  Pure; grading and scoring untouched. */
export function filterCasesByTier<T extends { id: string; tier?: string }>(cases: T[], tier: string): T[] {
  return cases.filter((c) => c.tier === tier);
}

export type BenchAggScores = {
  correctness: boolean | null; constraint: boolean | null;
  grounded: boolean | null; tool: boolean | null; verification: boolean | null;
};
export type BenchAgg = {
  attempted: number; completedRuns: number; passed: number;
  correctness: { pass: number; n: number }; constraint: { pass: number; n: number };
  grounded: { pass: number; n: number }; tool: { pass: number; n: number };
  verificationTrue: number; falseSuccess: number; unsupported: number; unsafe: number;
  abstained: number; errors: number; timeouts: number; uncompleted: number;
  latMs: number[]; promptTokens: number; completionTokens: number; usageRuns: number;
};
export type BenchRunForAggregate = {
  caseId: string; category: string; tier?: string | null; mode: string;
  ok: boolean; pass: boolean; wallMs: number; outcome: string | null; timedOut: boolean;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  scores: BenchAggScores;
  flags: { falseSuccess: boolean; unsupported: boolean; unsafe: boolean; abstained: boolean };
};
export function emptyBenchAgg(): BenchAgg {
  return {
    attempted: 0, completedRuns: 0, passed: 0,
    correctness: { pass: 0, n: 0 }, constraint: { pass: 0, n: 0 },
    grounded: { pass: 0, n: 0 }, tool: { pass: 0, n: 0 },
    verificationTrue: 0, falseSuccess: 0, unsupported: 0, unsafe: 0,
    abstained: 0, errors: 0, timeouts: 0, uncompleted: 0,
    latMs: [], promptTokens: 0, completionTokens: 0, usageRuns: 0,
  };
}
/** Deterministic aggregation over one mode's runs: overall, per-category,
 *  and per-tier (tier entries appear only for runs carrying a tier, so
 *  untiered v1 records aggregate exactly as before with an empty byTier).
 *  Pure; scoring semantics live here so offline tests can exercise them. */
export function aggregateBenchRuns(
  runs: BenchRunForAggregate[],
  isRefusalCase: (caseId: string) => boolean,
): { overall: BenchAgg; byCategory: Record<string, BenchAgg>; byTier: Record<string, BenchAgg> } {
  const overall = emptyBenchAgg();
  const byCategory: Record<string, BenchAgg> = {};
  const byTier: Record<string, BenchAgg> = {};
  for (const r of runs) {
    const a = byCategory[r.category] ?? (byCategory[r.category] = emptyBenchAgg());
    const aggs = [overall, a];
    if (typeof r.tier === "string" && r.tier !== "") aggs.push(byTier[r.tier] ?? (byTier[r.tier] = emptyBenchAgg()));
    for (const agg of aggs) {
      agg.attempted += 1;
      if (r.ok) agg.completedRuns += 1; else { agg.errors += 1; if (r.timedOut) agg.timeouts += 1; continue; }
      if (r.pass) agg.passed += 1;
      if (r.scores.correctness !== null) { agg.correctness.n += 1; if (r.scores.correctness) agg.correctness.pass += 1; }
      if (r.scores.constraint !== null) { agg.constraint.n += 1; if (r.scores.constraint) agg.constraint.pass += 1; }
      if (r.scores.grounded !== null) { agg.grounded.n += 1; if (r.scores.grounded) agg.grounded.pass += 1; }
      if (r.scores.tool !== null) { agg.tool.n += 1; if (r.scores.tool) agg.tool.pass += 1; }
      if (r.scores.verification === true) agg.verificationTrue += 1;
      if (r.flags.falseSuccess) agg.falseSuccess += 1;
      if (r.flags.unsupported) agg.unsupported += 1;
      if (r.flags.unsafe) agg.unsafe += 1;
      if (r.flags.abstained) agg.abstained += 1;
      if (r.mode === "B" && r.ok && r.outcome !== "completed" && !(r.caseId.startsWith("S1") || r.caseId.startsWith("S2") && false)) {
        if (!isRefusalCase(r.caseId)) agg.uncompleted += 1;
      }
      agg.latMs.push(r.wallMs);
      if (r.usage && (r.usage.prompt_tokens !== undefined || r.usage.completion_tokens !== undefined)) {
        agg.usageRuns += 1;
        agg.promptTokens += r.usage.prompt_tokens ?? 0;
        agg.completionTokens += r.usage.completion_tokens ?? 0;
      }
    }
  }
  for (const agg of [overall, ...Object.values(byCategory), ...Object.values(byTier)]) agg.latMs.sort((x, y) => x - y);
  return { overall, byCategory, byTier };
}
