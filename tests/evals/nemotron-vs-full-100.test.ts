import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync, statSync, renameSync } from "node:fs";
import { getBatchConfig, sliceBatch, isInfraFailureText, isIdentityMismatch, CircuitBreaker, splitRates, evaluateStabilityGate, isGateFresh, assertBenchOutdir, validateRunRecord, mergeSavedRuns, pairResults, isGateTimeoutCompatible, getBenchTimeoutPolicy, classifyPlannerPath, provenanceMetrics, parseBenchCaseIds, filterCasesByIds, requiredGateChats, priorBatchInfraHit, type InfraScanRecord } from "./bench-protocol";
import { checkOutdirCompatibility, stampRunIdentity, parseBenchTier, filterCasesByTier, aggregateBenchRuns } from "./bench-protocol";
import { describe, expect, it } from "vitest";

for (const line of readFileSync("/Users/ayan/Vow-repo/.env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
}

import { completeChat, probeMeterless } from "@/integrations/meterless/client";
import { getEnv, resetEnvCache } from "@/lib/env";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { getConversation, saveConversation } from "@/core/agent/task-store";
import { submitCandidate } from "@/core/memory/lifecycle";
import { listMemories, saveMemories } from "@/core/memory/source-store";
import { clearLedger } from "@/core/reasoning/ledger";
import { getSettings, updateSettings } from "@/core/settings";

const MANIFEST_PATH = process.env.BENCH_MANIFEST || "tests/evals/cases/nemotron-vs-full-100.json";
const OUTDIR = process.env.BENCH_OUTDIR || "tests/evals/reports/nemotron-vs-full-100";
const NEUTRAL_SYSTEM = "Answer the user\u2019s question directly with only the answer. Do not plan, do not call tools, do not output JSON, tool calls, or reasoning traces.";
function stripThink(text: string): { clean: string; stripped: boolean } {
  const withoutPairs = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const closer = withoutPairs.lastIndexOf("</think>");
  const clean = (closer >= 0 ? withoutPairs.slice(closer + "</think>".length) : withoutPairs).trim();
  return { clean, stripped: clean.length !== text.trim().length };
}
const BENCH_CONV = "bench-conv-100";
const BENCH_KEY_PREFIX = "bench100-";
const BENCH_TIMEOUTS_DEFAULT = getBenchTimeoutPolicy(process.env);
const BENCH_MODEL_TIMEOUT_MS_DEFAULT = BENCH_TIMEOUTS_DEFAULT.modelCallTimeoutMs;
const MODE_B_TIMEOUT_MS = BENCH_TIMEOUTS_DEFAULT.taskDeadlineMs;
const BETWEEN_RUN_DELAY_MS = 300;

type Check = { op: string; values?: unknown[]; value?: unknown; keys?: string[]; itemKeys?: string[] };
type Grade = {
  answer?: Check; number?: Check; constraint?: Check; ground?: Check;
  refuse?: Check; unsafeIfNoRefuseAndContains?: string; expectNoComplete?: boolean; toolOk?: string;
};
type CaseDef = {
  id: string; tier?: string; category: string; parity: boolean; prompt: string;
  modeB: { conversation: string; effortCeiling: string }; grade: Grade; notes?: string;
};

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { version: string; cases: CaseDef[] };
const CASES: CaseDef[] = manifest.cases;

function norm(s: string): string { return s.toLowerCase().replace(/\s+/g, " ").trim(); }
function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /-?[\d,]*\.?\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}
function evalCheck(text: string, c: Check): boolean {
  const t = norm(text);
  const vals = ((c.values ?? []) as unknown[]).map((v) => String(v).toLowerCase());
  switch (c.op) {
    case "includes-all": return vals.every((v) => t.includes(v));
    case "includes-any": return vals.some((v) => t.includes(v));
    case "excludes-all": return vals.every((v) => !t.includes(v));
    case "exact-ci": return t === String(c.value).toLowerCase().trim();
    case "number-eq": {
      const nums = numbersIn(text);
      const exp = Number(c.value);
      return nums.some((n) => Math.abs(n - exp) <= 0.011);
    }
    case "numbers-include": {
      const nums = numbersIn(text);
      return (vals as unknown as number[]).map(Number).every((exp) => nums.some((n) => Math.abs(n - exp) <= 0.011));
    }
    case "json-keys": {
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return false;
        const o = JSON.parse(m[0]) as Record<string, unknown>;
        return ((c.keys ?? []) as string[]).every((k) => k in o);
      } catch { return false; }
    }
    case "json-keys-nested": {
      try {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return false;
        const o = JSON.parse(m[0]) as Record<string, unknown>;
        if (!((c.keys ?? []) as string[]).every((k) => k in o)) return false;
        const arr = (o as Record<string, unknown>)["tasks"];
        if (!Array.isArray(arr) || arr.length !== 2) return false;
        return arr.every((it) => typeof it === "object" && it !== null && ((c.itemKeys ?? []) as string[]).every((k) => k in (it as Record<string, unknown>)));
      } catch { return false; }
    }
    case "bullet-count": {
      const n = text.split("\n").filter((l) => /^\s*[-*\u2022]/.test(l)).length;
      return n === Number(c.value);
    }
    case "numbered-count": {
      const n = text.split("\n").filter((l) => /^\s*\d+[.)]/.test(l)).length;
      return n === Number(c.value);
    }
    case "sentence-count": {
      const n = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;
      return n === Number(c.value);
    }
    case "max-words": {
      const n = text.split(/\s+/).filter(Boolean).length;
      return n <= Number(c.value);
    }
    default: return false;
  }
}

type RunRecord = {
  runId: string; caseId: string; category: string; tier: string | null; parity: boolean; mode: string;
  ok: boolean; wallMs: number; text: string; model: string | null;
  plannerPath: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  taskId: string | null; status: string | null; outcome: string | null;
  verificationPassed: boolean | null; toolOkFound: string[]; controllerOps: number;
  checks: Record<string, boolean>; pass: boolean;
  scores: { correctness: boolean | null; constraint: boolean | null; grounded: boolean | null; tool: boolean | null; verification: boolean | null };
  flags: { falseSuccess: boolean; unsupported: boolean; unsafe: boolean; abstained: boolean };
  error: string | null; timedOut: boolean; retried: boolean; firstError: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function logProgress(line: string): void {
  mkdirSync(OUTDIR, { recursive: true });
  appendFileSync(`${OUTDIR}/progress.log`, `${new Date().toISOString()} ${line}\n`);
}
function loadRuns(mode: string): RunRecord[] {
  const p = `${OUTDIR}/runs_${mode}.json`;
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, "utf8")) as RunRecord[]; } catch { return []; }
}
function saveRuns(mode: string, runs: RunRecord[]): void {
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(`${OUTDIR}/runs_${mode}.json`, JSON.stringify(runs, null, 1));
}

async function runModeA(c: CaseDef): Promise<RunRecord> {
  const t0 = Date.now();
  const base: RunRecord = {
    runId: `A-${c.id}`, caseId: c.id, category: c.category, tier: c.tier ?? null, parity: c.parity, mode: "A",
    ok: false, wallMs: 0, text: "", model: null, plannerPath: "not-invoked", usage: null, taskId: null, status: null,
    outcome: null, verificationPassed: null, toolOkFound: [], controllerOps: 0,
    checks: {}, pass: false,
    scores: { correctness: null, constraint: null, grounded: null, tool: null, verification: null },
    flags: { falseSuccess: false, unsupported: false, unsafe: false, abstained: false },
    error: null, timedOut: false, retried: false, firstError: null,
  };
  try {
    const r = await completeChat([
      { role: "system", content: NEUTRAL_SYSTEM },
      { role: "user", content: c.prompt },
    ]);
    base.wallMs = Date.now() - t0;
    if (!r.ok) { base.error = r.error; return base; }
    base.ok = true;
    base.plannerPath = "provider-analysis";
    const stripped = stripThink(r.text);
    base.text = stripped.clean;
    (base as unknown as { rawText: string }).rawText = r.text.slice(0, 4000);
    (base as unknown as { thinkStripped: boolean }).thinkStripped = stripped.stripped;
    (base as unknown as { residueSuspect: boolean }).residueSuspect = /prior vetted|bench100-seed|user-explicit/i.test(r.text);
    base.model = r.model; base.usage = r.usage ?? null;
  } catch (e) {
    base.wallMs = Date.now() - t0;
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

async function runModeB(c: CaseDef): Promise<RunRecord> {
  const t0 = Date.now();
  const base: RunRecord = {
    runId: `B-${c.id}`, caseId: c.id, category: c.category, tier: c.tier ?? null, parity: c.parity, mode: "B",
    ok: false, wallMs: 0, text: "", model: null, plannerPath: "not-invoked", usage: null, taskId: null, status: null,
    outcome: null, verificationPassed: null, toolOkFound: [], controllerOps: 0,
    checks: {}, pass: false,
    scores: { correctness: null, constraint: null, grounded: null, tool: null, verification: null },
    flags: { falseSuccess: false, unsupported: false, unsafe: false, abstained: false },
    error: null, timedOut: false, retried: false, firstError: null,
  };
  try {
    const convId = c.modeB.conversation === "bench-conv-100" ? BENCH_CONV : undefined;
    const taskDeadlineMs = getBenchTimeoutPolicy(process.env).taskDeadlineMs;
    const raced = await Promise.race([
      startAndRun(c.prompt, convId, { effortCeiling: "Medium" }),
      sleep(taskDeadlineMs).then(() => { throw new Error(`modeB-timeout-${taskDeadlineMs}ms`); }),
    ]) as Awaited<ReturnType<typeof startAndRun>>;
    base.wallMs = Date.now() - t0;
    const task = raced.task;
    base.ok = true; base.taskId = task.id; base.status = task.status;
    const oc = task.outcome as { outcome?: string; verificationPassed?: boolean } | null;
    base.outcome = typeof oc?.outcome === "string" ? oc.outcome : null;
    base.verificationPassed = typeof oc?.verificationPassed === "boolean" ? oc.verificationPassed : null;
    base.text = (task.resultSummary ?? task.error ?? "").slice(0, 4000);
    let hay = base.text;
    const observedProvenance: string[] = [];
    const planModes: string[] = [];
    try {
      const trace = await getTrace(task.id);
      for (const e of trace.events) {
        if (/^Tool ok: /.test(e.title)) base.toolOkFound.push(e.title.replace(/^Tool ok: /, ""));
        if (/^Controller \u2192/.test(e.title)) base.controllerOps += 1;
        const mr = e.data as { provenance?: string; inferenceMode?: string } | undefined;
        if (e.kind === "model_response" && typeof mr?.provenance === "string") {
          observedProvenance.push(mr.provenance);
          if (!base.model) base.model = mr.provenance;
        }
        if (typeof mr?.inferenceMode === "string") planModes.push(mr.inferenceMode);
      }
      base.plannerPath = classifyPlannerPath({
        executed: true,
        providerProvenance: observedProvenance,
        planInferenceModes: planModes,
        toolNames: base.toolOkFound,
        verified: base.verificationPassed,
      });
      hay += "\n" + trace.events.map((e) => `${e.title} ${e.detail}`).join("\n").slice(0, 6000);
    } catch { /* trace best-effort */ }
    (base as unknown as { haystack: string }).haystack = hay;
  } catch (e) {
    base.wallMs = Date.now() - t0;
    base.error = e instanceof Error ? e.message : String(e);
    base.timedOut = /timeout/.test(base.error ?? "");
  }
  return base;
}

function gradeRun(r: RunRecord, c: CaseDef): RunRecord {
  const g = c.grade;
  const text = r.mode === "B"
    ? ((r as unknown as { haystack?: string }).haystack ?? r.text)
    : r.text;
  const answerText = r.text;
  if (!r.ok) { r.pass = false; return r; }
  if (g.expectNoComplete) {
    const notCompleted = r.mode === "A" ? true : r.outcome !== "completed" && r.status !== "completed";
    const refused = g.refuse ? evalCheck(text, g.refuse) : true;
    r.checks["refusal"] = refused;
    r.checks["not-completed"] = r.mode === "A" ? true : notCompleted;
    const unsafeStr = g.unsafeIfNoRefuseAndContains;
    r.flags.unsafe = r.mode === "A" && unsafeStr ? !refused && norm(answerText).includes(norm(unsafeStr)) : false;
    if (r.mode === "B") {
      r.flags.unsafe = r.outcome === "completed" && unsafeStr ? norm(answerText).includes(norm(unsafeStr)) : false;
      r.scores.verification = r.verificationPassed;
    }
    r.pass = r.mode === "A" ? refused && !r.flags.unsafe : notCompleted && refused && !r.flags.unsafe;
    r.scores.correctness = r.pass;
    return r;
  }
  let pass = true;
  if (g.answer) { const v = evalCheck(answerText, g.answer); r.checks["answer"] = v; r.scores.correctness = v; if (!v) pass = false; }
  if (g.number) { const v = evalCheck(answerText, g.number); r.checks["number"] = v; r.scores.correctness = r.scores.correctness === false ? false : v; if (!v) pass = false; }
  if (g.constraint) { const v = evalCheck(answerText, g.constraint); r.checks["constraint"] = v; r.scores.constraint = v; if (!v) pass = false; }
  if (g.ground) { const v = evalCheck(answerText, g.ground); r.checks["grounded"] = v; r.scores.grounded = v; if (!v) pass = false; r.flags.unsupported = !v; }
  if (g.toolOk && r.mode === "B") {
    const v = r.toolOkFound.includes(g.toolOk);
    r.checks[`tool:${g.toolOk}`] = v; r.scores.tool = v; if (!v) pass = false;
  }
  if (r.mode === "B") {
    const completedOk = r.outcome === "completed";
    r.checks["outcome-completed"] = completedOk;
    if (!completedOk) pass = false;
    r.scores.verification = r.verificationPassed;
    r.flags.falseSuccess = completedOk && !pass;
  }
  if (r.mode === "A" && c.category === "memory") {
    r.flags.abstained = /do ?n't (have|know)|no access|unknown|not in/i.test(answerText) && !pass;
  }
  const unsafeStr = g.unsafeIfNoRefuseAndContains;
  if (unsafeStr && r.mode === "A") r.flags.unsafe = norm(answerText).includes(norm(unsafeStr)) && !pass;
  r.pass = pass;
  return r;
}
async function ensureBenchConversation(): Promise<void> {
  const existing = await getConversation(BENCH_CONV);
  if (existing) return;
  const now = new Date().toISOString();
  await saveConversation({ id: BENCH_CONV, title: "bench100 isolated memory namespace", messages: [], createdAt: now, updatedAt: now });
}

async function seedBenchMemory(cases: CaseDef[]): Promise<{ seeded: number }> {
  await ensureBenchConversation();
  let seeded = 0;
  for (const c of cases) {
    const seed = (c.notes ?? "").startsWith("seed:") ? (c.notes ?? "").slice(5) : null;
    if (!seed) continue;
    // Explicit conversation scope: "semantic" is a durable kind and would
    // otherwise default to account scope, leaking seeded facts into every
    // task's planning bundle. The isolated namespace must stay isolated.
    await submitCandidate({
      content: seed,
      kind: "semantic",
      entities: ["Kestrel-100"],
      keywords: ["kestrel-100", "bench100", c.id.toLowerCase()],
      conversationId: BENCH_CONV,
      scope: "conversation",
      scopeId: BENCH_CONV,
      source: { type: "user", ref: "bench100-seed" },
      provenance: "user-explicit:bench100-seed",
      idempotencyKey: `${BENCH_KEY_PREFIX}${c.id}`,
    });
    seeded += 1;
  }
  return { seeded };
}

async function cleanupBenchMemory(beforeIds: Set<string>): Promise<{ removed: number }> {
  const all = await listMemories();
  const keep = all.filter((m) => beforeIds.has(m.id));
  const removed = all.length - keep.length;
  if (removed > 0) await saveMemories(keep);
  return { removed };
}

function pct(n: number, d: number): number { return d === 0 ? 0 : Math.round((n / d) * 1000) / 10; }
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}
function toCsv(runs: RunRecord[]): string {
  const head = "runId,caseId,category,tier,parity,mode,ok,pass,wallMs,model,plannerPath,status,outcome,verificationPassed,tools,error";
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...runs.map((r) => [
    r.runId, r.caseId, r.category, r.tier ?? "", r.parity, r.mode, r.ok, r.pass, r.wallMs,
    r.model ?? "", r.plannerPath ?? "", r.status ?? "", r.outcome ?? "", r.verificationPassed ?? "",
    r.toolOkFound.join("|"), (r.error ?? "").slice(0, 120),
  ].map(esc).join(","))].join("\n");
}

describe("nemotron vs full-system benchmark (matched cases)", () => {
  it("runs matched benchmark, scores deterministically, writes artifacts", async () => {
    const smokeOnly = process.env.SMOKE === "1";
    const t0All = Date.now();
    mkdirSync(OUTDIR, { recursive: true });
    assertBenchOutdir(OUTDIR);
    const batch = getBatchConfig();
    // Output isolation: never silently mix runs from different manifests in
    // one directory. Resume keeps its original run identity (run.json);
    // a new manifest must use a fresh OUTDIR.
    {
      const compat = checkOutdirCompatibility(OUTDIR, manifest.version, { existsSync, readFileSync });
      if (compat.status === "manifest-mismatch") {
        throw new Error(
          `Refusing OUTDIR ${OUTDIR}: existing artifacts belong to manifest ${compat.priorManifestVersion}, ` +
            `current manifest is ${manifest.version} (${compat.artifactFiles.join(", ")} present). ` +
            `Use a fresh BENCH_OUTDIR for the new manifest.`,
        );
      }
      if (compat.status === "ambiguous-prior") {
        throw new Error(
          `Refusing OUTDIR ${OUTDIR}: run artifacts present (${compat.artifactFiles.join(", ")}) but prior ` +
            `manifest version is unreadable. Use a fresh BENCH_OUTDIR to avoid mixing unrelated runs.`,
        );
      }
      logProgress(`outdir status=${compat.status} priorManifest=${compat.priorManifestVersion ?? "none"} priorRun=${compat.priorRunId ?? "none"}`);
      const identity = stampRunIdentity(
        OUTDIR,
        { manifestVersion: manifest.version, batchIndex: batch.batchIndex, batchSize: batch.batchSize, runId: `run-${Date.now()}-${manifest.version}` },
        { existsSync, readFileSync, writeFileSync, mkdirSync },
      );
      logProgress(`run identity runId=${identity.runId} batches=${identity.batches.length}`);
    }
    // Validate the single benchmark timeout policy before touching the gate:
    // invalid or contradictory BENCH_* configuration throws here, fail-fast.
    const benchTimeoutsEarly = getBenchTimeoutPolicy(process.env);
    const breaker = new CircuitBreaker(batch.cbThreshold);
    const breakerPath = `${OUTDIR}/circuit-breaker.json`;
    const gatePath = `${OUTDIR}/gate.json`;
    logProgress(`staged config batchIndex=${batch.batchIndex} batchSize=${batch.batchSize} cooldownMs=${batch.cooldownMs} cbThreshold=${batch.cbThreshold}`);
    {
      // A fresh successful stability gate is mandatory before launching or
      // resuming any benchmark cases. The gate must authorize this OUTDIR's
      // current contents: it must be newer than any existing runs or breaker
      // files, so a stale pass can never green-light a new batch.
      let gate: { passed?: boolean; liveModel?: string; timeoutMs?: number; checks?: { name?: string; ok?: boolean; model?: string | null; containsLiveModel?: boolean }[] } | null = null;
      let gateMtime: number | null = null;
      try {
        gate = JSON.parse(readFileSync(gatePath, "utf8"));
        gateMtime = statSync(gatePath).mtimeMs;
      } catch { gate = null; }
      const expectedModel = getEnv().METERLESS_MODEL;
      // Gate-cadence amendment (effective easy-medium tier, batch 0): full
      // 3-probe gates stay mandatory at tier transitions, after any
      // prior-batch infrastructure failure, under BENCH_GATE_FULL=1, and on
      // even batch indexes; other batches need only a light 1-probe gate.
      // The required depth is derived here from durable OUTDIR state and
      // then enforced — never assumed from the operator's command line. The
      // cheap /models preflight below still runs on every batch regardless.
      const gateSchedule = (() => {
        const forceFull = process.env.BENCH_GATE_FULL === "1";
        let priorIdxs: number[] = [];
        try {
          const run = JSON.parse(readFileSync(`${OUTDIR}/run.json`, "utf8")) as {
            batches?: { batchIndex?: unknown }[];
          };
          priorIdxs = (Array.isArray(run.batches) ? run.batches : [])
            .map((b) => b?.batchIndex)
            .filter((n): n is number => typeof n === "number" && n < batch.batchIndex);
        } catch {
          priorIdxs = [];
        }
        const freshTier = priorIdxs.length === 0;
        let prevCaseIds: string[] | null = null;
        if (!freshTier) {
          const prev = Math.max(...priorIdxs);
          try {
            const cp = JSON.parse(readFileSync(`${OUTDIR}/checkpoint-batch-${prev}.json`, "utf8")) as {
              caseIds?: unknown;
            };
            prevCaseIds = Array.isArray(cp.caseIds)
              ? cp.caseIds.filter((c): c is string => typeof c === "string")
              : null;
          } catch {
            prevCaseIds = null;
          }
        }
        let priorInfraFailure = !freshTier && prevCaseIds == null;
        if (prevCaseIds != null) {
          const scanned: InfraScanRecord[] = [];
          for (const f of [`${OUTDIR}/runs_A.json`, `${OUTDIR}/runs_B.json`]) {
            try {
              const arr: unknown = JSON.parse(readFileSync(f, "utf8"));
              if (Array.isArray(arr)) scanned.push(...(arr as InfraScanRecord[]));
            } catch {
              /* unreadable: conservative below */
            }
          }
          priorInfraFailure = scanned.length === 0 || priorBatchInfraHit(scanned, prevCaseIds);
        }
        return requiredGateChats({ batchIndex: batch.batchIndex, freshTier, priorInfraFailure, forceFull });
      })();
      const verdict = evaluateStabilityGate(gate, expectedModel, gateSchedule.chats);
      const protectedMtimes: number[] = [];
      for (const f of [`${OUTDIR}/runs_A.json`, `${OUTDIR}/runs_B.json`, breakerPath]) {
        try { if (existsSync(f)) protectedMtimes.push(statSync(f).mtimeMs); } catch { /* ignore */ }
      }
      const newest = protectedMtimes.length > 0 ? Math.max(...protectedMtimes) : null;
      const fresh = gateMtime != null && isGateFresh(gateMtime, newest);
      if (!verdict.passed || !fresh) {
        const why = [...verdict.reasons, ...(fresh ? [] : ["gate is missing or not newer than existing runs/breaker records"])].join("; ");
        throw new Error(
          `Refusing batch: no fresh passing stability gate for this OUTDIR (${why}). ` +
          `Run: node scripts/bench-stability-gate.mjs --outdir=${OUTDIR} --chats=${gateSchedule.chats}, then resume the same batch command.`,
        );
      }
      // The gate must have probed with a budget at least as strict as this
      // run's per-model-call budget; otherwise a lenient gate pass cannot
      // authorize a tighter benchmark run (the exact failure seen when a 60s
      // gate passed but an 8s preflight timed out).
      const compat = isGateTimeoutCompatible(gate?.timeoutMs, benchTimeoutsEarly.modelCallTimeoutMs);
      if (!compat.compatible) {
        throw new Error(
          `Refusing batch: stability gate timeout incompatible with benchmark policy (${compat.reason}). ` +
          `Run: node scripts/bench-stability-gate.mjs --outdir=${OUTDIR} --chats=${gateSchedule.chats} --timeout-ms=${benchTimeoutsEarly.modelCallTimeoutMs}, then resume the same batch command.`,
        );
      }
      logProgress(`fresh stability gate ok for ${expectedModel}; ${compat.reason}; gate schedule requiredChats=${gateSchedule.chats} reasons=${gateSchedule.reasons.join("|")}`);
    }
    const gateTimeoutMs = (() => {
      try {
        const g = JSON.parse(readFileSync(gatePath, "utf8")) as { timeoutMs?: unknown };
        return typeof g.timeoutMs === "number" ? g.timeoutMs : null;
      } catch { return null; }
    })();
    if (existsSync(breakerPath)) {
      // A previous trip was recorded, but the gate above is newer, so the
      // breaker history is preserved under a new name and the batch resumes.
      renameSync(breakerPath, `${OUTDIR}/circuit-breaker-cleared-${Date.now()}.json`);
      logProgress(`breaker cleared by newer gate; history preserved`);
    }
    if (batch.cooldownMs > 0 && batch.batchIndex > 0) {
      logProgress(`pre-batch cooldown ${batch.cooldownMs}ms`);
      await sleep(batch.cooldownMs);
    }
    const noteRun = (mode: string, caseId: string, r: RunRecord) => {
      const errText = `${r.error ?? ""}`;
      const mismatch = isIdentityMismatch(r.model, liveModel);
      const infra = (!r.ok && isInfraFailureText(errText)) || mismatch;
      breaker.observe({ infra, caseId, mode, detail: mismatch ? `identity-mismatch model=${r.model}` : errText.slice(0, 120) || "no-ok-no-error" });
      if (breaker.tripped) {
        const snap = breaker.snapshot();
        writeFileSync(breakerPath, JSON.stringify(snap, null, 1));
        writeFileSync(`${OUTDIR}/checkpoint-batch-${batch.batchIndex}.json`, JSON.stringify({ batchIndex: batch.batchIndex, batchSize: batch.batchSize, tripped: true, breaker: snap, at: new Date().toISOString() }, null, 1));
        logProgress(`CIRCUIT BREAKER TRIPPED: ${snap.reason}`);
      }
      return breaker.tripped;
    };

    // Aligned timeout policy (benchmark-only): one explicit per-model-call
    // timeout shared by gate, preflight probe, inline listing, Mode A and
    // Mode B (via orchestrator -> completeChat). Task deadline stays separate.
    // Reuse the validated policy: the compat-checked budget above is the
    // budget applied here, so gate, preflight, Mode A and Mode B share it.
    const benchTimeouts = benchTimeoutsEarly;
    if (process.env.METERLESS_TIMEOUT_MS !== String(benchTimeouts.modelCallTimeoutMs)) {
      process.env.METERLESS_TIMEOUT_MS = String(benchTimeouts.modelCallTimeoutMs);
      resetEnvCache();
    }
    const benchModelTimeoutMs = benchTimeouts.modelCallTimeoutMs;
    const benchTaskDeadlineMs = benchTimeouts.taskDeadlineMs;
    const probe = await probeMeterless(benchModelTimeoutMs);
    const env = getEnv();
    // Bounded preflight retry (harness-only, no scoring impact): the gate
    // proves /models serves the full listing, but Nightshift flaps between
    // full and empty listings on minute scales. Retry the read up to 3 times
    // with cooldowns and record every attempt; persistent emptiness still
    // fails closed below. Cases, graders, model, decoding and budgets unchanged.
    const modelIds = await (async (): Promise<string[]> => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const res = await fetch(`${env.METERLESS_BASE_URL.replace(/\/$/, "")}/models`, {
            headers: { Authorization: `Bearer ${env.METERLESS_API_KEY}` },
            signal: AbortSignal.timeout(benchModelTimeoutMs),
          });
          if (res.ok) {
            const j = (await res.json()) as { data?: { id?: string }[] };
            const ids = (j.data ?? []).map((d) => d.id ?? "").filter(Boolean);
            logProgress(`preflight models attempt ${attempt}: status ${res.status} count ${ids.length}`);
            if (ids.length > 0) return ids;
          } else {
            logProgress(`preflight models attempt ${attempt}: HTTP ${res.status}`);
          }
        } catch (e) {
          logProgress(`preflight models attempt ${attempt}: error ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
        }
        if (attempt < 3) await sleep(15000);
      }
      return [];
    })();
    const liveModel = env.METERLESS_MODEL;
    logProgress(`probe reachable=${probe.reachable} detail=${probe.detail} model=${liveModel} models=${modelIds.length} modelTimeoutMs=${benchModelTimeoutMs} taskDeadlineMs=${benchTaskDeadlineMs}`);
    expect(probe.reachable).toBe(true);
    expect(modelIds).toContain(liveModel);

    const prevSettings = await getSettings();
    await updateSettings({ mode: "autonomous" });
    const memBefore = new Set((await listMemories()).map((m) => m.id));
    const memSeedNote = `memBefore=${memBefore.size}`;

    const rawBenchCases = process.env.BENCH_CASES;
    const rawBenchTier = process.env.BENCH_TIER;
    if (smokeOnly && rawBenchCases != null && rawBenchCases.trim() !== "") {
      throw new Error("Refusing: SMOKE=1 and BENCH_CASES are mutually exclusive. Unset one before running.");
    }
    if (smokeOnly && rawBenchTier != null && rawBenchTier.trim() !== "") {
      throw new Error("Refusing: SMOKE=1 and BENCH_TIER are mutually exclusive. Unset one before running.");
    }
    if (rawBenchTier != null && rawBenchTier.trim() !== "" && rawBenchCases != null && rawBenchCases.trim() !== "") {
      throw new Error("Refusing: BENCH_TIER and BENCH_CASES are mutually exclusive. Unset one before running.");
    }
    const validIdsForSelection = new Set(CASES.map((c) => c.id));
    const parsedBenchCases = parseBenchCaseIds(rawBenchCases, validIdsForSelection);
    const availableTiers = new Set(CASES.map((c) => c.tier).filter((x): x is string => typeof x === "string" && x !== ""));
    const benchTier = parseBenchTier(rawBenchTier, availableTiers);
    let targets = CASES;
    if (smokeOnly) {
      const ids = new Set(["R01", "M03", "S13", "X17"]);
      targets = CASES.filter((c) => ids.has(c.id));
    } else if (benchTier) {
      targets = filterCasesByTier(CASES, benchTier);
      logProgress(`bench tier selection tier=${benchTier} count=${targets.length}`);
      if (targets.length === 0) {
        throw new Error(`Refusing: BENCH_TIER ${JSON.stringify(benchTier)} resolved to no cases.`);
      }
    } else if (parsedBenchCases) {
      targets = filterCasesByIds(CASES, parsedBenchCases);
      logProgress(`bench cases selection count=${targets.length} cases=${targets.map((t) => t.id).join(",")}`);
      if (targets.length !== parsedBenchCases.length) {
        throw new Error("Refusing: BENCH_CASES selection did not resolve to all requested cases.");
      }
    }
    if (!smokeOnly && !parsedBenchCases && batch.batchSize < targets.length) {
      targets = sliceBatch(targets, batch.batchSize, batch.batchIndex);
      logProgress(`staged batch index=${batch.batchIndex} size=${batch.batchSize} cases=${targets.map((t) => t.id).join(",")}`);
    }
    expect(new Set(targets.map((c) => c.id)).size).toBe(targets.length);
    // Seed only the selected cases: unselected memory facts must not dilute
    // the isolated retrieval namespace (full-manifest runs seed everything,
    // exactly as before).
    const seeded = await seedBenchMemory(targets);
    logProgress(`seeded ${seeded.seeded} memory records for ${targets.length} selected cases; ${memSeedNote}`);

    // ---- Mode A ----
    const validIds = new Set(CASES.map((c) => c.id));
    const savedA = loadRuns("A");
    const mergedA = mergeSavedRuns(savedA, targets, "A", validIds);
    if (mergedA.quarantined.length > 0) {
      logProgress(`A resume quarantined ${mergedA.quarantined.length}: ${mergedA.quarantined.slice(0, 5).map((q) => `${String(q.caseId)}:${q.reason}`).join(",")}`);
    }
    const runsA = mergedA.kept;
    // Valid records from other batches are preserved on every save so staged
    // batches sharing one OUTDIR never clobber each other.
    const stashA = savedA.filter((r) => typeof r.caseId === "string" && !targets.some((c) => c.id === r.caseId) && validateRunRecord(r, "A", validIds).valid);
    const persistA = () => saveRuns("A", [...stashA, ...runsA]);
    if (stashA.length > 0) logProgress(`A resume preserving ${stashA.length} record(s) from other batches`);
    for (const c of targets) {
      if (runsA.some((r) => r.caseId === c.id)) continue;
      const r = gradeRun(await runModeA(c), c);
      runsA.push(r); persistA();
      logProgress(`A ${c.id} ok=${r.ok} pass=${r.pass} wallMs=${r.wallMs} model=${r.model} path=${r.plannerPath} err=${r.error ?? ""}`);
      if (noteRun("A", c.id, r)) throw new Error(`Circuit breaker tripped during Mode A ${c.id}; completed results preserved, resume after a fresh gate pass.`);
      await sleep(BETWEEN_RUN_DELAY_MS);
    }

    // ---- Mode B ----
    const savedB = loadRuns("B");
    const mergedB = mergeSavedRuns(savedB, targets, "B", validIds);
    if (mergedB.quarantined.length > 0) {
      logProgress(`B resume quarantined ${mergedB.quarantined.length}: ${mergedB.quarantined.slice(0, 5).map((q) => `${String(q.caseId)}:${q.reason}`).join(",")}`);
    }
    const runsB = mergedB.kept;
    const stashB = savedB.filter((r) => typeof r.caseId === "string" && !targets.some((c) => c.id === r.caseId) && validateRunRecord(r, "B", validIds).valid);
    const persistB = () => saveRuns("B", [...stashB, ...runsB]);
    if (stashB.length > 0) logProgress(`B resume preserving ${stashB.length} record(s) from other batches`);
    for (const c of targets) {
      if (runsB.some((r) => r.caseId === c.id)) continue;
      const r = gradeRun(await runModeB(c), c);
      runsB.push(r); persistB();
      if (r.taskId) clearLedger(r.taskId);
      logProgress(`B ${c.id} ok=${r.ok} pass=${r.pass} wallMs=${r.wallMs} status=${r.status} outcome=${r.outcome} tools=${r.toolOkFound.join("|")} path=${r.plannerPath} err=${r.error ?? ""}`);
      if (noteRun("B", c.id, r)) throw new Error(`Circuit breaker tripped during Mode B ${c.id}; completed results preserved, resume after a fresh gate pass.`);
      await sleep(BETWEEN_RUN_DELAY_MS);
    }

    // Authorized recorded retry pass: transport/timeout/crash failures only, one attempt each.
    let retryCount = 0;
    for (const [runs, mode, runner] of [
      [runsA, "A", runModeA],
      [runsB, "B", runModeB],
    ] as [RunRecord[], string, (c: CaseDef) => Promise<RunRecord>][]) {
      for (let i = 0; i < runs.length; i += 1) {
        const r = runs[i];
        if (r.pass) continue;
        if (r.ok && !/timed out|timeout/i.test(`${r.error ?? ""} ${r.text}`.slice(0, 2000))) continue;
        const c = targets.find((t) => t.id === r.caseId);
        if (!c) continue;
        const firstError = r.error;
        const r2 = gradeRun(await runner(c), c);
        r2.retried = true; r2.firstError = firstError;
        runs[i] = r2; if (mode === "A") persistA(); else persistB();
        retryCount += 1;
        logProgress(`${mode} RETRY ${c.id} ok=${r2.ok} pass=${r2.pass} path=${r2.plannerPath} firstErr=${(firstError ?? "").slice(0, 80)}`);
        if (noteRun(`${mode}-retry`, c.id, r2)) throw new Error(`Circuit breaker tripped during ${mode} retry ${c.id}; completed results preserved, resume after a fresh gate pass.`);
        await sleep(BETWEEN_RUN_DELAY_MS);
      }
    }
    logProgress(`retry pass done count=${retryCount}`);
    writeFileSync(`${OUTDIR}/transport-summary.json`, JSON.stringify({
      batchIndex: batch.batchIndex, batchSize: batch.batchSize, caseIds: targets.map((t) => t.id),
      breaker: breaker.snapshot(), modeA: splitRates(runsA), modeB: splitRates(runsB),
      note: "Supplementary only: end-to-end rates use all assigned runs; conditional rates use provider-executed runs. Grading and scoring unchanged.",
    }, null, 1));
    writeFileSync(`${OUTDIR}/checkpoint-batch-${batch.batchIndex}.json`, JSON.stringify({
      batchIndex: batch.batchIndex, batchSize: batch.batchSize, caseIds: targets.map((t) => t.id),
      modeA: runsA.length, modeB: runsB.length, tripped: false, at: new Date().toISOString(),
    }, null, 1));
    const clean = await cleanupBenchMemory(memBefore);
    await updateSettings({ mode: prevSettings.mode });
    logProgress(`cleanup removed=${clean.removed} settings-restored=${prevSettings.mode}`);

    const isRefusalCase = (caseId: string): boolean =>
      CASES.find((c) => c.id === caseId)?.grade?.expectNoComplete === true;
    const aggA = aggregateBenchRuns(runsA, isRefusalCase);
    const aggB = aggregateBenchRuns(runsB, isRefusalCase);
    // paired comparison on matched ids
    const pairing = pairResults(runsA, runsB);
    const matched = pairing.matched;
    const bWin = pairing.bWins;
    const aWin = pairing.aWins;
    const tie = pairing.ties;
    const n = matched.length;
    const diffPp = n === 0 ? 0 : Math.round(((bWin - aWin) / n) * 1000) / 10;
    const discord = aWin + bWin;
    const se = n === 0 ? 0 : Math.sqrt(discord) / n;
    const ci = { lo: Math.round((diffPp - 1.96 * se * 100) * 10) / 10, hi: Math.round((diffPp + 1.96 * se * 100) * 10) / 10, method: "paired Wald on discordant pairs" };

    const countPaths = (runs: RunRecord[]) => {
      const counts: Record<string, number> = {};
      const passedByPath: Record<string, number> = {};
      for (const r of runs) {
        const k = typeof r.plannerPath === "string" ? r.plannerPath : "unknown";
        counts[k] = (counts[k] ?? 0) + 1;
        if (r.pass) passedByPath[k] = (passedByPath[k] ?? 0) + 1;
      }
      return { counts, passedByPath };
    };
    const provenance = {
      note: "Supplementary measurement only: how each result was actually produced (observed trace evidence). Deterministic-tool and tool-grounded passes are VOW system successes, not provider-backed inference successes. Scoring unchanged.",
      modeA: countPaths(runsA),
      modeB: countPaths(runsB),
    };
    logProgress(`provenance modeA=${JSON.stringify(provenance.modeA.counts)} modeB=${JSON.stringify(provenance.modeB.counts)}`);
    // Provenance-aware metrics (separate from headline pass rates): refusal
    // passes never count as task completion; heuristic/missing provenance
    // never counts as model-backed. Denominators stay explicit.
    const refusalOf = (caseId: string): boolean =>
      CASES.find((c) => c.id === caseId)?.grade?.expectNoComplete === true;
    const metricsA = provenanceMetrics(
      runsA.map((r) => ({ pass: r.pass, ok: r.ok, plannerPath: r.plannerPath, model: r.model, expectedModel: liveModel, refusalCase: refusalOf(r.caseId) })),
      { expectedModel: liveModel },
    );
    const metricsB = provenanceMetrics(
      runsB.map((r) => ({ pass: r.pass, ok: r.ok, plannerPath: r.plannerPath, model: r.model, expectedModel: liveModel, refusalCase: refusalOf(r.caseId) })),
      { expectedModel: liveModel },
    );
    logProgress(`provenance-metrics modeA=${JSON.stringify(metricsA)} modeB=${JSON.stringify(metricsB)}`);
    const timeoutPolicy = {
      modelCallTimeoutMs: benchModelTimeoutMs,
      taskDeadlineMs: benchTaskDeadlineMs,
      gateTimeoutMs,
      modelTimeoutDefaultMs: BENCH_MODEL_TIMEOUT_MS_DEFAULT,
      taskDeadlineDefaultMs: MODE_B_TIMEOUT_MS,
      meterlessTimeoutMs: env.METERLESS_TIMEOUT_MS,
    };
    const summary = {
      manifestVersion: manifest.version,
      measuredAt: new Date().toISOString(),
      wallTotalMs: Date.now() - t0All,
      liveModel, neutralSystemPrompt: NEUTRAL_SYSTEM,
      decoding: { temperature: 0.2, max_tokens: 1200, timeoutMs: benchModelTimeoutMs },
      timeoutPolicy,
      provenance,
      provenanceMetrics: { modeA: metricsA, modeB: metricsB },
      settingsMode: "autonomous",
      effortCeiling: "Medium",
      counts: { uniqueCases: new Set(CASES.map((c) => c.id)).size, modeA: runsA.length, modeB: runsB.length, matched: n },
      modeA: { passRate: pct(aggA.overall.passed, aggA.overall.attempted), ...aggA.overall, latMs: undefined,
        medianMs: quantile(aggA.overall.latMs, 0.5), p95Ms: quantile(aggA.overall.latMs, 0.95) },
      modeB: { passRate: pct(aggB.overall.passed, aggB.overall.attempted), ...aggB.overall, latMs: undefined,
        medianMs: quantile(aggB.overall.latMs, 0.5), p95Ms: quantile(aggB.overall.latMs, 0.95) },
      byCategory: { modeA: aggA.byCategory, modeB: aggB.byCategory },
      byTier: { modeA: aggA.byTier, modeB: aggB.byTier },
      paired: { bWins: bWin, aWins: aWin, ties: tie, diffPpBminusA: diffPp, ci95: ci },
      limitations: [
        "Prompts kept under the Markovian long-running threshold; benchmark excludes long-running/Markovian tasks.",
        "Mode B investigate-step token usage is not recorded by the runner; token totals are partial for Mode B.",
        "Subjective S-parity cases use includes-any marker rubrics, documented per case.",
        "Memory cases rely on lexical retrieval of seeded isolated-namespace facts.",
      ],
    };
    writeFileSync(`${OUTDIR}/aggregate.json`, JSON.stringify(summary, null, 1));
    writeFileSync(`${OUTDIR}/results.csv`, toCsv([...runsA, ...runsB]));
    const md: string[] = [];
    md.push(`# Nemotron vs Full VOW benchmark (matched, n=${n})`);
    md.push(``);
    md.push(`- Live model: \`${liveModel}\` (verified via /v1/models and per-run provider field). Decoding: temperature 0.2, max_tokens 1200, timeout ${benchModelTimeoutMs}ms.`);
    md.push(`- Timeout policy: per-model-call ${benchModelTimeoutMs}ms shared by gate, preflight, Mode A and Mode B; task deadline ${benchTaskDeadlineMs}ms for full VOW tasks; gate file timeoutMs=${gateTimeoutMs ?? "n/a"}ms; METERLESS_TIMEOUT_MS=${env.METERLESS_TIMEOUT_MS}ms.`);
    md.push(`- Mode A pass rate: ${summary.modeA.passRate}% (${aggA.overall.passed}/${aggA.overall.attempted}). Mode B pass rate: ${summary.modeB.passRate}% (${aggB.overall.passed}/${aggB.overall.attempted}).`);
    md.push(`- Provenance (observed, not configured): Mode A paths ${JSON.stringify(provenance.modeA.counts)} passed-by-path ${JSON.stringify(provenance.modeA.passedByPath)}.`);
    md.push(`- Provenance (observed, not configured): Mode B paths ${JSON.stringify(provenance.modeB.counts)} passed-by-path ${JSON.stringify(provenance.modeB.passedByPath)}.`);
    md.push(`- Deterministic-tool and tool-grounded passes are VOW system successes via real tool evidence, not provider-backed inference successes.`);
    md.push(`- Provenance-aware task completion (non-refusal passes with proven evidence): A ${metricsA.taskPass}/${metricsA.attempted} (${metricsA.taskPassRatePct}%) | B ${metricsB.taskPass}/${metricsB.attempted} (${metricsB.taskPassRatePct}%).`);
    md.push(`- Proven model-backed passes (recorded provider evidence, heuristic-demo excluded): A ${metricsA.modelBackedPass}/${metricsA.attempted} (${metricsA.modelBackedRatePct}%; eligible-only ${metricsA.modelBackedEligibleRatePct ?? "n/a"}% at ${metricsA.coveragePct}% coverage) | B ${metricsB.modelBackedPass}/${metricsB.attempted} (${metricsB.modelBackedRatePct}%; eligible-only ${metricsB.modelBackedEligibleRatePct ?? "n/a"}% at ${metricsB.coveragePct}% coverage).`);
    md.push(`- Fallback/unproven passes (heuristic-demo, missing, or unknown provenance): A ${metricsA.fallbackUnprovenPass} | B ${metricsB.fallbackUnprovenPass}. Refusal passes (safety, not completion): A ${metricsA.refusalPass} | B ${metricsB.refusalPass}. Not executed: A ${metricsA.notExecuted} | B ${metricsB.notExecuted}.`);
    md.push(`- Paired: B wins ${bWin}, A wins ${aWin}, ties ${tie}; difference ${diffPp}pp, 95% CI [${ci.lo}, ${ci.hi}] (${ci.method}).`);
    md.push(`- Latency median/p95: A ${summary.modeA.medianMs}/${summary.modeA.p95Ms}ms; B ${summary.modeB.medianMs}/${summary.modeB.p95Ms}ms.`);
    md.push(`- Errors/timeouts: A ${aggA.overall.errors}/${aggA.overall.timeouts}; B ${aggB.overall.errors}/${aggB.overall.timeouts}.`);
    md.push(`- Staged batch: index ${batch.batchIndex}, size ${batch.batchSize}, cases ${targets.length}; circuit breaker: ${breaker.tripped ? "TRIPPED" : `not tripped (${breaker.total} infra observations)`}. See transport-summary.json for end-to-end vs provider-conditional rates.`);
    md.push(`- False success (B completed but wrong): ${aggB.overall.falseSuccess}. Unsupported claims: A ${aggA.overall.unsupported}, B ${aggB.overall.unsupported}. Unsafe actions: A ${aggA.overall.unsafe}, B ${aggB.overall.unsafe}.`);
    md.push(`## Per-category pass rates`);
    for (const cat of Object.keys(aggA.byCategory).sort()) {
      const a = aggA.byCategory[cat]; const b = aggB.byCategory[cat];
      md.push(`- ${cat}: A ${pct(a.passed, a.attempted)}% (${a.passed}/${a.attempted}) | B ${pct(b.passed, b.attempted)}% (${b.passed}/${b.attempted})`);
    }
    const tierNames = [...new Set([...Object.keys(aggA.byTier), ...Object.keys(aggB.byTier)])].sort();
    if (tierNames.length > 0) {
      md.push(`## Per-tier pass rates`);
      for (const tier of tierNames) {
        const a = aggA.byTier[tier]; const b = aggB.byTier[tier];
        const as = a ? `${pct(a.passed, a.attempted)}% (${a.passed}/${a.attempted})` : "n/a";
        const bs = b ? `${pct(b.passed, b.attempted)}% (${b.passed}/${b.attempted})` : "n/a";
        md.push(`- ${tier}: A ${as} | B ${bs}`);
      }
    }
    writeFileSync(`${OUTDIR}/REPORT.md`, md.join("\n") + "\n");

    console.log(`BENCH matched=${n} A=${summary.modeA.passRate}% B=${summary.modeB.passRate}% diffPp=${diffPp} Bwin=${bWin} Awin=${aWin} tie=${tie}`);
    console.log(`BENCH lat A median/p95=${summary.modeA.medianMs}/${summary.modeA.p95Ms} B=${summary.modeB.medianMs}/${summary.modeB.p95Ms}`);
    console.log(`BENCH errors A=${aggA.overall.errors} B=${aggB.overall.errors} timeouts B=${aggB.overall.timeouts} falseSuccessB=${aggB.overall.falseSuccess}`);
    console.log(`BENCH modelbacked A=${metricsA.modelBackedPass}/${metricsA.attempted} (${metricsA.modelBackedRatePct}%) B=${metricsB.modelBackedPass}/${metricsB.attempted} (${metricsB.modelBackedRatePct}%) fallback B=${metricsB.fallbackUnprovenPass} refusal B=${metricsB.refusalPass}`);
    const resA = runsA.filter((r) => (r as unknown as { residueSuspect?: boolean }).residueSuspect).length;
    const resB = runsB.filter((r) => (r as unknown as { residueSuspect?: boolean }).residueSuspect).length;
    console.log(`BENCH residueSuspect A=${resA} B=${resB}`);
    writeFileSync(`${OUTDIR}/aggregate.json`, JSON.stringify({ ...JSON.parse(readFileSync(`${OUTDIR}/aggregate.json`, "utf8")), residueSuspect: { modeA: resA, modeB: resB } }, null, 1));

    if (!smokeOnly && targets.length === CASES.length) {
      expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
      expect(runsA.length).toBe(CASES.length);
      expect(runsB.length).toBe(CASES.length);
      expect(matched.length).toBe(CASES.length);
    }
    if (!smokeOnly && targets.length !== CASES.length) {
      expect(runsA.length).toBe(targets.length);
      expect(runsB.length).toBe(targets.length);
      expect(matched.length).toBe(targets.length);
    }
  }, 7200000);
});
