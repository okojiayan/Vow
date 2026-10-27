/* Benchmark timeout-policy alignment (mocked, no live inference).
 * Complements staged-protocol.test.ts: verifies the selected 60s/300s policy
 * defaults and the fail-fast rules for invalid configuration. Pure only. */
import { describe, expect, it } from "vitest";
import {
  getBenchTimeoutPolicy,
  BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS,
  BENCH_DEFAULT_TASK_DEADLINE_MS,
} from "./bench-protocol";

describe("benchmark timeout policy (mocked)", () => {
  it("defaults to 60s per-call and 300s task deadline", () => {
    expect(BENCH_DEFAULT_MODEL_CALL_TIMEOUT_MS).toBe(60_000);
    expect(BENCH_DEFAULT_TASK_DEADLINE_MS).toBe(300_000);
    expect(getBenchTimeoutPolicy({})).toEqual({ modelCallTimeoutMs: 60_000, taskDeadlineMs: 300_000 });
  });

  it("honors explicit overrides within bounds", () => {
    expect(getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "45000", BENCH_TASK_DEADLINE_MS: "240000" }))
      .toEqual({ modelCallTimeoutMs: 45_000, taskDeadlineMs: 240_000 });
  });

  it("clamps out-of-range numerics but rejects non-numeric configuration", () => {
    expect(getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "5000" }).modelCallTimeoutMs).toBe(15_000);
    expect(getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "999999" }).modelCallTimeoutMs).toBe(120_000);
    for (const bad of ["junk", "0", "-5"]) {
      expect(() => getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: bad })).toThrow(/Invalid BENCH_MODEL_TIMEOUT_MS/);
    }
  });

  it("floors an unset deadline but rejects an explicitly contradictory one", () => {
    expect(getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "120000" }))
      .toEqual({ modelCallTimeoutMs: 120_000, taskDeadlineMs: 360_000 });
    expect(() => getBenchTimeoutPolicy({ BENCH_MODEL_TIMEOUT_MS: "60000", BENCH_TASK_DEADLINE_MS: "120000" }))
      .toThrow(/Contradictory benchmark timeouts/);
  });

  it("keeps the default task deadline long enough for several sequential calls", () => {
    const p = getBenchTimeoutPolicy({});
    expect(p.taskDeadlineMs).toBeGreaterThanOrEqual(3 * p.modelCallTimeoutMs);
    expect(p.taskDeadlineMs / p.modelCallTimeoutMs).toBeGreaterThanOrEqual(4);
  });
});
