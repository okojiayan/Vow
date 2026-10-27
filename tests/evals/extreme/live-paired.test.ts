/** Live-paired harness validation with mocked transport (no live calls). */
import { describe, it, expect, vi } from "vitest";
import { LIVE_PAIRED_CASES } from "./live-paired";

describe("live-paired harness", () => {
  it("declares <=12 comparable cases with stable IDs", () => {
    expect(LIVE_PAIRED_CASES.length).toBeLessThanOrEqual(12);
    expect(LIVE_PAIRED_CASES.length).toBeGreaterThanOrEqual(10);
    const ids = LIVE_PAIRED_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("early-stops after 2 consecutive infra failures (mocked)", async () => {
    const mod = await import("@/integrations/meterless/client");
    const spy = vi.spyOn(mod, "completeChat").mockResolvedValue({ ok: false, error: "HTTP 503 Service Unavailable" } as never);
    try {
      const { runLivePaired } = await import("./live-paired");
      const out = await runLivePaired("/tmp/xt2-live-mock", { maxCases: 12, infraStop: 2 });
      expect(out.stoppedEarly).toBe(true);
      expect(out.results.length).toBeLessThan(24);
      expect(out.results.every((r) => r.mode === "A")).toBe(true);
    } finally { spy.mockRestore(); }
    // cleanup mock output
    const { rmSync } = await import("node:fs");
    try { rmSync("/tmp/xt2-live-mock", { recursive: true, force: true }); } catch {}
  });
  it("pairs A and B per case when provider succeeds (mocked)", async () => {
    const mod = await import("@/integrations/meterless/client");
    const spy = vi.spyOn(mod, "completeChat").mockResolvedValue({ ok: true, text: "42", model: "nvidia/nemotron-3-ultra-550b-a55b", usage: null } as never);
    const orch = await import("@/core/agent/orchestrator");
    const ospy = vi.spyOn(orch, "startAndRun").mockResolvedValue({ task: { id: "t1", status: "completed", resultSummary: "42", error: null, inferenceMode: "deterministic" } } as never);
    try {
      const { runLivePaired } = await import("./live-paired");
      const out = await runLivePaired("/tmp/xt2-live-mock2", { maxCases: 2, infraStop: 2 });
      expect(out.stoppedEarly).toBe(false);
      expect(out.results.length).toBe(4);
      expect(out.results.filter((r) => r.mode === "A").length).toBe(2);
      expect(out.results.filter((r) => r.mode === "B").length).toBe(2);
    } finally { spy.mockRestore(); ospy.mockRestore(); }
    const { rmSync } = await import("node:fs");
    try { rmSync("/tmp/xt2-live-mock2", { recursive: true, force: true }); } catch {}
  });
});
