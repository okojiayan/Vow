/* Grading ops frozen from the v1.0 baseline harness snapshot (baseline-v1.0/harness.test.ts.snapshot). Do not tune. */
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

for (const line of readFileSync("/Users/ayan/Vow-repo/.env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
}

import { completeChat, probeMeterless } from "@/integrations/meterless/client";
import { getEnv } from "@/lib/env";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { getConversation, saveConversation } from "@/core/agent/task-store";
import { remember, } from "@/core/memory/consolidator";
import { listMemories, saveMemories } from "@/core/memory/source-store";
import { clearLedger } from "@/core/reasoning/ledger";
import { getSettings, updateSettings } from "@/core/settings";

const MANIFEST_PATH = "tests/evals/cases/holdout-20.json";
const OUTDIR = process.env.BENCH_OUTDIR || "tests/evals/reports/holdout-20";
const NEUTRAL_SYSTEM = "Answer the user\u2019s question directly with only the answer. Do not plan, do not call tools, do not output JSON, tool calls, or reasoning traces.";
function stripThink(text: string): { clean: string; stripped: boolean } {
  const withoutPairs = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const closer = withoutPairs.lastIndexOf("</think>");
  const clean = (closer >= 0 ? withoutPairs.slice(closer + "</think>".length) : withoutPairs).trim();
  return { clean, stripped: clean.length !== text.trim().length };
}
const BENCH_CONV = "bench-conv-hold20";
const BENCH_KEY_PREFIX = "hold20-";
const MODE_B_TIMEOUT_MS = 300000;
const BETWEEN_RUN_DELAY_MS = 300;

type Check = { op: string; values?: unknown[]; value?: unknown; keys?: string[]; itemKeys?: string[] };
type Grade = {
  answer?: Check; number?: Check; constraint?: Check; ground?: Check;
  refuse?: Check; unsafeIfNoRefuseAndContains?: string; expectNoComplete?: boolean; toolOk?: string;
};
type CaseDef = {
  id: string; category: string; parity: boolean; prompt: string;
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
  runId: string; caseId: string; category: string; parity: boolean; mode: string;
  ok: boolean; wallMs: number; text: string; model: string | null;
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
    runId: `A-${c.id}`, caseId: c.id, category: c.category, parity: c.parity, mode: "A",
    ok: false, wallMs: 0, text: "", model: null, usage: null, taskId: null, status: null,
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
    const stripped = stripThink(r.text);
    base.text = stripped.clean;
    (base as unknown as { rawText: string }).rawText = r.text.slice(0, 4000);
    (base as unknown as { thinkStripped: boolean }).thinkStripped = stripped.stripped;
    (base as unknown as { residueSuspect: boolean }).residueSuspect = /prior vetted|hold20-seed|user-explicit/i.test(r.text);
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
    runId: `B-${c.id}`, caseId: c.id, category: c.category, parity: c.parity, mode: "B",
    ok: false, wallMs: 0, text: "", model: null, usage: null, taskId: null, status: null,
    outcome: null, verificationPassed: null, toolOkFound: [], controllerOps: 0,
    checks: {}, pass: false,
    scores: { correctness: null, constraint: null, grounded: null, tool: null, verification: null },
    flags: { falseSuccess: false, unsupported: false, unsafe: false, abstained: false },
    error: null, timedOut: false, retried: false, firstError: null,
  };
  try {
    const convId = c.modeB.conversation === "bench-conv-hold20" ? BENCH_CONV : undefined;
    const raced = await Promise.race([
      startAndRun(c.prompt, convId, { effortCeiling: "Medium" }),
      sleep(MODE_B_TIMEOUT_MS).then(() => { throw new Error(`modeB-timeout-${MODE_B_TIMEOUT_MS}ms`); }),
    ]) as Awaited<ReturnType<typeof startAndRun>>;
    base.wallMs = Date.now() - t0;
    const task = raced.task;
    base.ok = true; base.taskId = task.id; base.status = task.status;
    const oc = task.outcome as { outcome?: string; verificationPassed?: boolean } | null;
    base.outcome = typeof oc?.outcome === "string" ? oc.outcome : null;
    base.verificationPassed = typeof oc?.verificationPassed === "boolean" ? oc.verificationPassed : null;
    base.text = (task.resultSummary ?? task.error ?? "").slice(0, 4000);
    let hay = base.text;
    try {
      const trace = await getTrace(task.id);
      for (const e of trace.events) {
        if (/^Tool ok: /.test(e.title)) base.toolOkFound.push(e.title.replace(/^Tool ok: /, ""));
        if (/^Controller \u2192/.test(e.title)) base.controllerOps += 1;
        const mr = e.data as { provenance?: string } | undefined;
        if (e.kind === "model_response" && typeof mr?.provenance === "string" && !base.model) base.model = mr.provenance;
      }
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
  await saveConversation({ id: BENCH_CONV, title: "holdout20 isolated memory namespace", messages: [], createdAt: now, updatedAt: now });
}

async function seedBenchMemory(cases: CaseDef[]): Promise<{ seeded: number }> {
  await ensureBenchConversation();
  let seeded = 0;
  for (const c of cases) {
    const seed = (c.notes ?? "").startsWith("seed:") ? (c.notes ?? "").slice(5) : null;
    if (!seed) continue;
    await remember({
      content: seed,
      kind: "semantic",
      entities: ["Hold-20"],
      keywords: ["hold-20", "hold20", c.id.toLowerCase()],
      conversationId: BENCH_CONV,
      source: { type: "user", ref: "hold20-seed" },
      provenance: "user-explicit:hold20-seed",
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

type Agg = {
  attempted: number; completedRuns: number; passed: number;
  correctness: { pass: number; n: number }; constraint: { pass: number; n: number };
  grounded: { pass: number; n: number }; tool: { pass: number; n: number };
  verificationTrue: number; falseSuccess: number; unsupported: number; unsafe: number;
  abstained: number; errors: number; timeouts: number; uncompleted: number;
  latMs: number[]; promptTokens: number; completionTokens: number; usageRuns: number;
};

function emptyAgg(): Agg {
  return {
    attempted: 0, completedRuns: 0, passed: 0,
    correctness: { pass: 0, n: 0 }, constraint: { pass: 0, n: 0 },
    grounded: { pass: 0, n: 0 }, tool: { pass: 0, n: 0 },
    verificationTrue: 0, falseSuccess: 0, unsupported: 0, unsafe: 0,
    abstained: 0, errors: 0, timeouts: 0, uncompleted: 0,
    latMs: [], promptTokens: 0, completionTokens: 0, usageRuns: 0,
  };
}
function pct(n: number, d: number): number { return d === 0 ? 0 : Math.round((n / d) * 1000) / 10; }
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

function aggregate(runs: RunRecord[]): { overall: Agg; byCategory: Record<string, Agg> } {
  const overall = emptyAgg();
  const byCategory: Record<string, Agg> = {};
  for (const r of runs) {
    const a = byCategory[r.category] ?? (byCategory[r.category] = emptyAgg());
    for (const agg of [overall, a]) {
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
        const g = CASES.find((c) => c.id === r.caseId)?.grade;
        if (!g?.expectNoComplete) agg.uncompleted += 1;
      }
      agg.latMs.push(r.wallMs);
      if (r.usage && (r.usage.prompt_tokens !== undefined || r.usage.completion_tokens !== undefined)) {
        agg.usageRuns += 1;
        agg.promptTokens += r.usage.prompt_tokens ?? 0;
        agg.completionTokens += r.usage.completion_tokens ?? 0;
      }
    }
  }
  for (const agg of [overall, ...Object.values(byCategory)]) agg.latMs.sort((x, y) => x - y);
  return { overall, byCategory };
}

function toCsv(runs: RunRecord[]): string {
  const head = "runId,caseId,category,parity,mode,ok,pass,wallMs,model,status,outcome,verificationPassed,tools,error";
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [head, ...runs.map((r) => [
    r.runId, r.caseId, r.category, r.parity, r.mode, r.ok, r.pass, r.wallMs,
    r.model ?? "", r.status ?? "", r.outcome ?? "", r.verificationPassed ?? "",
    r.toolOkFound.join("|"), (r.error ?? "").slice(0, 120),
  ].map(esc).join(","))].join("\n");
}

describe("nemotron vs full-system benchmark (100 matched cases)", () => {
  it("runs matched benchmark, scores deterministically, writes artifacts", async () => {
    const smokeOnly = process.env.SMOKE === "1";
    const t0All = Date.now();
    mkdirSync(OUTDIR, { recursive: true });

    const probe = await probeMeterless();
    const env = getEnv();
    const modelIds = await (async (): Promise<string[]> => {
      try {
        const res = await fetch(`${env.METERLESS_BASE_URL.replace(/\/$/, "")}/models`, {
          headers: { Authorization: `Bearer ${env.METERLESS_API_KEY}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const j = (await res.json()) as { data?: { id?: string }[] };
        return (j.data ?? []).map((d) => d.id ?? "").filter(Boolean);
      } catch { return []; }
    })();
    const liveModel = env.METERLESS_MODEL;
    logProgress(`probe reachable=${probe.reachable} detail=${probe.detail} model=${liveModel} models=${modelIds.length}`);
    expect(probe.reachable).toBe(true);
    expect(modelIds).toContain(liveModel);

    const prevSettings = await getSettings();
    await updateSettings({ mode: "autonomous" });
    const memBefore = new Set((await listMemories()).map((m) => m.id));
    const seeded = await seedBenchMemory(CASES);
    logProgress(`seeded ${seeded.seeded} memory records; memBefore=${memBefore.size}`);

    let targets = CASES;
    if (smokeOnly) {
      const ids = new Set(["H01", "H13", "H19", "H05"]);
      targets = CASES.filter((c) => ids.has(c.id));
    }
    expect(new Set(targets.map((c) => c.id)).size).toBe(targets.length);

    // ---- Mode A ----
    const runsA = loadRuns("A").filter((r) => targets.some((c) => c.id === r.caseId));
    for (const c of targets) {
      if (runsA.some((r) => r.caseId === c.id)) continue;
      const r = gradeRun(await runModeA(c), c);
      runsA.push(r); saveRuns("A", runsA);
      logProgress(`A ${c.id} ok=${r.ok} pass=${r.pass} wallMs=${r.wallMs} model=${r.model} err=${r.error ?? ""}`);
      await sleep(BETWEEN_RUN_DELAY_MS);
    }

    // ---- Mode B ----
    const runsB = loadRuns("B").filter((r) => targets.some((c) => c.id === r.caseId));
    for (const c of targets) {
      if (runsB.some((r) => r.caseId === c.id)) continue;
      const r = gradeRun(await runModeB(c), c);
      runsB.push(r); saveRuns("B", runsB);
      if (r.taskId) clearLedger(r.taskId);
      logProgress(`B ${c.id} ok=${r.ok} pass=${r.pass} wallMs=${r.wallMs} status=${r.status} outcome=${r.outcome} tools=${r.toolOkFound.join("|")} err=${r.error ?? ""}`);
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
        runs[i] = r2; saveRuns(mode, runs);
        retryCount += 1;
        logProgress(`${mode} RETRY ${c.id} ok=${r2.ok} pass=${r2.pass} firstErr=${(firstError ?? "").slice(0, 80)}`);
        await sleep(BETWEEN_RUN_DELAY_MS);
      }
    }
    logProgress(`retry pass done count=${retryCount}`);
    const clean = await cleanupBenchMemory(memBefore);
    await updateSettings({ mode: prevSettings.mode });
    logProgress(`cleanup removed=${clean.removed} settings-restored=${prevSettings.mode}`);

    const aggA = aggregate(runsA);
    const aggB = aggregate(runsB);
    // paired comparison on matched ids
    const idsA = new Set(runsA.map((r) => r.caseId));
    const idsB = new Set(runsB.map((r) => r.caseId));
    const matched = [...idsA].filter((id) => idsB.has(id)).sort();
    let bWin = 0, aWin = 0, tie = 0;
    for (const id of matched) {
      const pa = runsA.find((r) => r.caseId === id)?.pass ?? false;
      const pb = runsB.find((r) => r.caseId === id)?.pass ?? false;
      if (pa && !pb) aWin += 1; else if (pb && !pa) bWin += 1; else tie += 1;
    }
    const n = matched.length;
    const diffPp = n === 0 ? 0 : Math.round(((bWin - aWin) / n) * 1000) / 10;
    const discord = aWin + bWin;
    const se = n === 0 ? 0 : Math.sqrt(discord) / n;
    const ci = { lo: Math.round((diffPp - 1.96 * se * 100) * 10) / 10, hi: Math.round((diffPp + 1.96 * se * 100) * 10) / 10, method: "paired Wald on discordant pairs" };

    const summary = {
      manifestVersion: manifest.version,
      measuredAt: new Date().toISOString(),
      wallTotalMs: Date.now() - t0All,
      liveModel, neutralSystemPrompt: NEUTRAL_SYSTEM,
      decoding: { temperature: 0.2, max_tokens: 1200, timeoutMs: env.METERLESS_TIMEOUT_MS },
      settingsMode: "autonomous",
      effortCeiling: "Medium",
      counts: { uniqueCases: new Set(CASES.map((c) => c.id)).size, modeA: runsA.length, modeB: runsB.length, matched: n },
      modeA: { passRate: pct(aggA.overall.passed, aggA.overall.attempted), ...aggA.overall, latMs: undefined,
        medianMs: quantile(aggA.overall.latMs, 0.5), p95Ms: quantile(aggA.overall.latMs, 0.95) },
      modeB: { passRate: pct(aggB.overall.passed, aggB.overall.attempted), ...aggB.overall, latMs: undefined,
        medianMs: quantile(aggB.overall.latMs, 0.5), p95Ms: quantile(aggB.overall.latMs, 0.95) },
      byCategory: { modeA: aggA.byCategory, modeB: aggB.byCategory },
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
    md.push(`# Holdout-20 (frozen v1.0 grading ops) (matched, n=${n})`);
    md.push(``);
    md.push(`- Live model: \`${liveModel}\` (verified via /v1/models and per-run provider field). Decoding: temperature 0.2, max_tokens 1200, timeout ${env.METERLESS_TIMEOUT_MS}ms.`);
    md.push(`- Mode A pass rate: ${summary.modeA.passRate}% (${aggA.overall.passed}/${aggA.overall.attempted}). Mode B pass rate: ${summary.modeB.passRate}% (${aggB.overall.passed}/${aggB.overall.attempted}).`);
    md.push(`- Paired: B wins ${bWin}, A wins ${aWin}, ties ${tie}; difference ${diffPp}pp, 95% CI [${ci.lo}, ${ci.hi}] (${ci.method}).`);
    md.push(`- Latency median/p95: A ${summary.modeA.medianMs}/${summary.modeA.p95Ms}ms; B ${summary.modeB.medianMs}/${summary.modeB.p95Ms}ms.`);
    md.push(`- Errors/timeouts: A ${aggA.overall.errors}/${aggA.overall.timeouts}; B ${aggB.overall.errors}/${aggB.overall.timeouts}.`);
    md.push(`- False success (B completed but wrong): ${aggB.overall.falseSuccess}. Unsupported claims: A ${aggA.overall.unsupported}, B ${aggB.overall.unsupported}. Unsafe actions: A ${aggA.overall.unsafe}, B ${aggB.overall.unsafe}.`);
    md.push(`## Per-category pass rates`);
    for (const cat of Object.keys(aggA.byCategory).sort()) {
      const a = aggA.byCategory[cat]; const b = aggB.byCategory[cat];
      md.push(`- ${cat}: A ${pct(a.passed, a.attempted)}% (${a.passed}/${a.attempted}) | B ${pct(b.passed, b.attempted)}% (${b.passed}/${b.attempted})`);
    }
    writeFileSync(`${OUTDIR}/REPORT.md`, md.join("\n") + "\n");

    console.log(`BENCH matched=${n} A=${summary.modeA.passRate}% B=${summary.modeB.passRate}% diffPp=${diffPp} Bwin=${bWin} Awin=${aWin} tie=${tie}`);
    console.log(`BENCH lat A median/p95=${summary.modeA.medianMs}/${summary.modeA.p95Ms} B=${summary.modeB.medianMs}/${summary.modeB.p95Ms}`);
    console.log(`BENCH errors A=${aggA.overall.errors} B=${aggB.overall.errors} timeouts B=${aggB.overall.timeouts} falseSuccessB=${aggB.overall.falseSuccess}`);
    const resA = runsA.filter((r) => (r as unknown as { residueSuspect?: boolean }).residueSuspect).length;
    const resB = runsB.filter((r) => (r as unknown as { residueSuspect?: boolean }).residueSuspect).length;
    console.log(`BENCH residueSuspect A=${resA} B=${resB}`);
    writeFileSync(`${OUTDIR}/aggregate.json`, JSON.stringify({ ...JSON.parse(readFileSync(`${OUTDIR}/aggregate.json`, "utf8")), residueSuspect: { modeA: resA, modeB: resB } }, null, 1));

    if (!smokeOnly) {
      expect(new Set(CASES.map((c) => c.id)).size).toBe(20);
      expect(runsA.length).toBe(20);
      expect(runsB.length).toBe(20);
      expect(matched.length).toBe(20);
    }
  }, 7200000);
});
