/** VOW Reality & Stress — local suite (no live services, no mocks of task results). */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIOS, MANIFEST_VERSION, type Scenario } from "./manifest.v1";
import { UNITS } from "./units";
import { runTaskScenario, checkExpectation } from "./runner";
import { FAULT_KINDS, injectProviderFault } from "./faults";
import { stageSequential, stageConcurrent, stageMemoryLoad, stageCancelStorm } from "./stress";
import { scoreSuite, type SuiteTallies } from "./scoring";
import { classifyFailure, type FailureRecord } from "./rootcause";

const OUTDIR = join(process.cwd(), "tests/evals/reports/vow-reality-v1");
const failures: FailureRecord[] = [];
const latencies: number[] = [];
const results: Array<Record<string, unknown>> = [];
let safetyFails = 0;

async function runScenario(s: Scenario): Promise<boolean> {
  if (s.route === "unit") {
    const fn = UNITS[s.id];
    expect(fn, `no unit implementation for ${s.id}`).toBeDefined();
    const t0 = Date.now();
    try {
      const detail = await fn!();
      latencies.push(Date.now() - t0);
      results.push({ id: s.id, family: s.family, route: "unit", pass: true, detail });
      return true;
    } catch (e) {
      latencies.push(Date.now() - t0);
      const observed = (e as Error).message;
      failures.push(classifyFailure({ scenarioId: s.id, expected: s.expectStatus.join("/"), observed, route: "unit", status: "error", latencyMs: Date.now() - t0 }));
      results.push({ id: s.id, family: s.family, route: "unit", pass: false, detail: observed });
      if (s.family === "adversarial" || s.family === "safety") safetyFails++;
      return false;
    }
  }
  const ev = await runTaskScenario(s);
  latencies.push(ev.ms);
  const text = `${ev.summary} ${ev.status} ${ev.inferenceMode}`;
  const problem = checkExpectation(s, text, ev.status);
  const pass = problem === null;
  results.push({ id: s.id, family: s.family, route: "task", pass, status: ev.status, ms: ev.ms, inferenceMode: ev.inferenceMode, toolCalls: ev.toolCalls, verification: ev.verification, detail: problem ?? text.slice(0, 300) });
  if (!pass) {
    failures.push(classifyFailure({ scenarioId: s.id, expected: `${s.expectStatus.join("/")} ${s.mustContain?.join("+") ?? ""}`, observed: problem ?? ev.status, route: "task", status: ev.status, latencyMs: ev.ms, inferenceMode: ev.inferenceMode, toolCalls: ev.toolCalls }));
    if (s.family === "adversarial" || s.family === "safety") safetyFails++;
  }
  return pass;
}

describe("reality-local", () => {
  it("workload scenarios (48)", { timeout: 300000 }, async () => {
    let passed = 0;
    for (const s of SCENARIOS) {
      if (await runScenario(s)) passed++;
    }
    (globalThis as { __rsPassed?: number }).__rsPassed = passed;
  });

  it("fault injection (11, all honest)", { timeout: 120000 }, async () => {
    let honest = 0;
    for (const k of FAULT_KINDS) {
      const r = await injectProviderFault(k);
      results.push({ id: `FI-${k}`, family: "fault", route: "unit", pass: r.honest, detail: r.detail });
      if (r.honest) honest++;
      else failures.push(classifyFailure({ scenarioId: `FI-${k}`, expected: "honest blocked/unverified", observed: r.detail, route: "fault", status: r.outcome, latencyMs: 0 }));
    }
    (globalThis as { __rsFaults?: number }).__rsFaults = honest;
  });

  it("stress stages (4)", { timeout: 300000 }, async () => {
    const stages = [await stageSequential(), await stageConcurrent(), await stageMemoryLoad(), await stageCancelStorm()];
    let sp = 0;
    for (const st of stages) {
      results.push({ id: `ST-${st.stage}`, family: "stress", route: "unit", pass: st.passed, detail: `ok=${st.ok}/${st.tasks} p50=${st.p50ms}ms p95=${st.p95ms}ms ${st.resourceNote}` });
      if (st.passed) sp++;
    }
    (globalThis as { __rsStress?: number }).__rsStress = sp;
  });

  it("report + score", { timeout: 60000 }, async () => {
    const g = globalThis as { __rsPassed?: number; __rsFaults?: number; __rsStress?: number };
    const adv = results.filter((r) => r.family === "adversarial" || r.family === "safety");
    const advPass = adv.filter((r) => r.pass).length;
    const sorted = [...latencies].sort((a, b) => a - b);
    const tallies: SuiteTallies = {
      scenarios: SCENARIOS.length, passed: g.__rsPassed ?? 0,
      faults: FAULT_KINDS.length, faultsHonest: g.__rsFaults ?? 0,
      adversarial: adv.length, adversarialPassed: advPass,
      safetyCriticalFails: safetyFails,
      stressStages: 4, stressPassed: g.__rsStress ?? 0,
      p50ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    };
    const score = scoreSuite(tallies);
    mkdirSync(OUTDIR, { recursive: true });
    const classCounts: Record<string, number> = {};
    for (const f of failures) classCounts[f.failureClass] = (classCounts[f.failureClass] ?? 0) + 1;
    writeFileSync(join(OUTDIR, "results.json"), JSON.stringify({ manifest: MANIFEST_VERSION, tallies, score, results, failures, classCounts }, null, 2));
    const lines = [
      "# VOW Reality & Stress — local run (reality-v1.0.0)",
      "", `Score: ${score.total}/100 (gates ${score.gatesOpen ? "OPEN" : "BLOCKED"})`,
      `Parts: ${JSON.stringify(score.parts)}`, `Tallies: ${JSON.stringify(tallies)}`,
      "", "## Root-cause ranking",
      ...Object.entries(classCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
      "", "## Failures",
      ...failures.map((f) => `- ${f.scenarioId} [${f.failureClass}] expected=${f.expected} observed=${f.observed} fix=${f.remediation}`),
    ];
    writeFileSync(join(OUTDIR, "REPORT.md"), lines.join("\n"));
    expect(score.gatesOpen).toBe(true);
    expect(tallies.passed).toBe(tallies.scenarios);
  });
});
