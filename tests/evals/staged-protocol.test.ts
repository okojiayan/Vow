/* Offline validation of the staged-execution protocol. All transport is
 * mocked or purely textual: no real inference traffic is generated here. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBatchConfig, sliceBatch, pendingIds, isInfraFailureText,
  isIdentityMismatch, CircuitBreaker, splitRates,
  getBenchTimeoutPolicy, isGateTimeoutCompatible,
  BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS, BENCH_DEFAULT_TASK_DEADLINE_MS,
  classifyPlannerPath,
} from "./bench-protocol";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `C${String(i + 1).padStart(2, "0")}` }));

describe("staged batch protocol (mocked)", () => {
  it("slices matched batches deterministically", () => {
    const all = ids(100);
    expect(sliceBatch(all, 10, 0).map((c) => c.id)).toEqual(ids(10).map((c) => c.id));
    expect(sliceBatch(all, 10, 9).map((c) => c.id)[0]).toBe("C91");
    expect(sliceBatch(all, 10, 9)).toHaveLength(10);
    expect(sliceBatch(all, 100, 0)).toHaveLength(100);
    expect(sliceBatch(all, 10, 10)).toHaveLength(0);
  });

  it("parses batch env with safe defaults", () => {
    expect(getBatchConfig({})).toEqual({ batchSize: 100, batchIndex: 0, cooldownMs: 0, cbThreshold: 6 });
    expect(getBatchConfig({ BENCH_BATCH_SIZE: "10", BENCH_BATCH_INDEX: "3", BENCH_COOLDOWN_MS: "5000", BENCH_CB_THRESHOLD: "4" }))
      .toEqual({ batchSize: 10, batchIndex: 3, cooldownMs: 5000, cbThreshold: 4 });
    expect(getBatchConfig({ BENCH_BATCH_SIZE: "junk" }).batchSize).toBe(100);
  });

  it("computes resume pending IDs", () => {
    expect(pendingIds(ids(5), new Set(["C01", "C03"]))).toEqual(["C02", "C04", "C05"]);
    expect(pendingIds(ids(3), new Set(["C01", "C02", "C03"]))).toEqual([]);
  });

  it("classifies infrastructure failures, not task outcomes", () => {
    for (const e of [
      "Meterless returned HTTP 502.", "Meterless returned HTTP 503.",
      "modeB-timeout-300000ms", "Meterless timed out after 30000ms.",
      "The operation was aborted due to timeout", "fetch failed",
      "socket hang up", "empty model listing", "Service Unavailable",
    ]) expect(isInfraFailureText(e)).toBe(true);
    for (const e of [
      "", null, undefined, "Verification failed: analysis references no row values.",
      "Blocked by Warden.", "AssertionError: expected 100",
    ]) expect(isInfraFailureText(e as unknown as string)).toBe(false);
  });

  it("detects only positive model-identity mismatch", () => {
    expect(isIdentityMismatch("other/model", "nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
    expect(isIdentityMismatch("nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
    expect(isIdentityMismatch(null, "nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
  });

  it("breaker trips on consecutive infra, resets on success", () => {
    const b = new CircuitBreaker(3);
    expect(b.observe({ infra: true, caseId: "C01", mode: "A", detail: "502" })).toBe(false);
    expect(b.observe({ infra: false, caseId: "C02", mode: "A", detail: "" })).toBe(false);
    expect(b.consecutive).toBe(0);
    b.observe({ infra: true, caseId: "C03", mode: "B", detail: "timeout" });
    b.observe({ infra: true, caseId: "C04", mode: "B", detail: "503" });
    expect(b.observe({ infra: true, caseId: "C05", mode: "B", detail: "502" })).toBe(true);
    const snap = b.snapshot();
    expect(snap.tripped).toBe(true);
    expect(snap.atCaseId).toBe("C05");
    expect(snap.reason).toMatch(/consecutive infrastructure failures/);
    expect(b.observe({ infra: false, caseId: "C06", mode: "B", detail: "" })).toBe(true);
  });

  it("breaker interlock honors a newer passing gate (file mtimes)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-gate-"));
    writeFileSync(join(dir, "circuit-breaker.json"), JSON.stringify({ tripped: true }));
    const breakerMs = statSync(join(dir, "circuit-breaker.json")).mtimeMs;
    const gateOlder = breakerMs - 1000;
    writeFileSync(join(dir, "gate.json"), JSON.stringify({ passed: true }));
    const now = new Date();
    utimesSync(join(dir, "gate.json"), new Date(gateOlder), new Date(gateOlder));
    const bStat = statSync(join(dir, "circuit-breaker.json"));
    const gStat = statSync(join(dir, "gate.json"));
    const g = JSON.parse(readFileSync(join(dir, "gate.json"), "utf8")) as { passed?: boolean };
    expect(g.passed === true && gStat.mtimeMs > bStat.mtimeMs).toBe(false);
    const future = new Date(now.getTime() + 5000);
    utimesSync(join(dir, "gate.json"), future, future);
    const g2 = statSync(join(dir, "gate.json"));
    expect(g.passed === true && g2.mtimeMs > bStat.mtimeMs).toBe(true);
  });

  it("shares one explicit per-model-call budget with a separate task deadline", () => {
    const dflt = getBenchTimeoutPolicy({});
    expect(dflt).toEqual({
      modelCallTimeoutMs: BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS,
      taskDeadlineMs: BENCH_DEFAULT_TASK_DEADLINE_MS,
    });
    expect(BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS).toBe(60_000);
    expect(BENCH_DEFAULT_TASK_DEADLINE_MS).toBe(300_000);
    // Task deadline is a separate, longer control: at least 3x one call.
    expect(dflt.taskDeadlineMs).toBeGreaterThanOrEqual(3 * dflt.modelCallTimeoutMs);
    const custom = getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "30000" });
    expect(custom.modelCallTimeoutMs).toBe(30_000);
    expect(custom.taskDeadlineMs).toBe(300_000);
    // An unset deadline floors to 3x the per-call budget instead of
    // contradicting it.
    const floored = getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "120000" });
    expect(floored).toEqual({ modelCallTimeoutMs: 120_000, taskDeadlineMs: 360_000 });
  });

  it("rejects invalid or contradictory timeout configuration", () => {
    for (const bad of ["junk", "0", "-5", "NaN", "Infinity"]) {
      expect(() => getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: bad })).toThrow(/Invalid BENCH_MODEL_TIMEOUT_MS/);
      expect(() => getBenchTimeoutPolicy({ BENCH_TASK_DEADLINE_MS: bad })).toThrow(/Invalid BENCH_TASK_DEADLINE_MS/);
    }
    // Explicit deadline below 3x the per-call budget can never cover a task.
    expect(() => getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "60000", BENCH_TASK_DEADLINE_MS: "120000" }))
      .toThrow(/Contradictory benchmark timeouts/);
    // Bounds clamp without throwing.
    expect(getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "5000" }).modelCallTimeoutMs).toBe(15_000);
    expect(getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "999999" }).modelCallTimeoutMs).toBe(120_000);
  });

  it("classifies result provenance from observed evidence only", () => {
    const base = { executed: true, providerProvenance: [] as string[], planInferenceModes: [] as string[], toolNames: [] as string[], verified: null as boolean | null };
    // Pilot R01-R05 pattern: planner timed out (no provider response), real
    // deterministic tool evidence, verification passed.
    expect(classifyPlannerPath({ ...base, toolNames: ["calc.evaluate"], verified: true })).toBe("deterministic-tool");
    // Pilot R06-R10 pattern: heuristic fallback text, no grounding tools.
    expect(classifyPlannerPath({ ...base, providerProvenance: ["heuristic-demo"], verified: false })).toBe("heuristic-fallback");
    // Real provider identity observed with tool grounding.
    expect(classifyPlannerPath({ ...base, providerProvenance: ["nvidia/nemotron-3-ultra-550b-a55b"], toolNames: ["memory.search"], verified: true })).toBe("mixed");
    expect(classifyPlannerPath({ ...base, providerProvenance: ["nvidia/nemotron-3-ultra-550b-a55b"], verified: true })).toBe("provider-analysis");
    // Live-model plan without an investigate response still counts as provider.
    expect(classifyPlannerPath({ ...base, planInferenceModes: ["live-model"], verified: false })).toBe("provider-analysis");
    // External (non-deterministic) tools without a provider response.
    expect(classifyPlannerPath({ ...base, toolNames: ["run_sql"], verified: true })).toBe("tool-grounded");
    // Never-executed runs (timeouts before any step) are explicit, never provider.
    expect(classifyPlannerPath({ ...base, executed: false })).toBe("not-invoked");
    // Configured model names must never substitute for observed responses:
    // empty provenance with no tools is heuristic-fallback, not provider.
    expect(classifyPlannerPath({ ...base, verified: false })).toBe("heuristic-fallback");
  });

  it("requires the gate budget to be at least as strict as the run budget", () => {
    expect(isGateTimeoutCompatible(60_000, 60_000).compatible).toBe(true);
    // A stricter (smaller) gate authorizes a more lenient run.
    expect(isGateTimeoutCompatible(15_000, 60_000).compatible).toBe(true);
    // A lenient gate cannot authorize a tighter run: re-gate required.
    const lax = isGateTimeoutCompatible(60_000, 30_000);
    expect(lax.compatible).toBe(false);
    expect(lax.reason).toMatch(/re-run the gate/);
    // A gate without a recorded budget predates the policy: re-gate required.
    for (const missing of [undefined, null, "60000", -1]) {
      const r = isGateTimeoutCompatible(missing, 60_000);
      expect(r.compatible).toBe(false);
      expect(r.reason).toMatch(/re-run the stability gate/);
    }
  });

  it("records timeout and 502/503 failures as infrastructure, not task outcomes", () => {
    for (const e of [
      "Meterless timed out after 60000ms.",
      "modeB-timeout-300000ms",
      "gate-timeout",
      "Meterless returned HTTP 502.",
      "Meterless returned HTTP 503.",
    ]) expect(isInfraFailureText(e)).toBe(true);
    // Genuine task failures stay task failures.
    for (const e of [
      "Verification failed: analysis references no row values.",
      "Blocked by Warden.",
    ]) expect(isInfraFailureText(e)).toBe(false);
  });

  it("splits end-to-end vs provider-conditional rates", () => {
    const runs = [
      { pass: true, ok: true }, { pass: true, ok: true }, { pass: false, ok: true },
      { pass: false, ok: false }, { pass: false, ok: false },
    ];
    const r = splitRates(runs);
    expect(r.assigned).toBe(5);
    expect(r.endToEndPct).toBe(40);
    expect(r.providerOk).toBe(3);
    expect(r.infraFailed).toBe(2);
    expect(r.conditionalPct).toBeCloseTo(66.7, 0);
    expect(splitRates([]).conditionalPct).toBe(null);
  });
});
