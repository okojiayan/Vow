import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";
import { runSwapComparison, confirmModelSwitch, validateCandidates } from "@/core/models/swap-guard";
import { collectDeadlines, dismissDeadline } from "@/core/time/deadlines";
import { explain } from "@/core/i18n/explain";
import { submitCandidate } from "@/core/memory/lifecycle";

describe("phase3 swap guard + deadlines + language (isolated)", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; delete process.env.METERLESS_API_KEY; vi.restoreAllMocks(); resetEnvCache(); });

  it("rejects non-nvidia candidates; mock comparison is labelled; no auto-switch", async () => {
    await isolatedEnv();
    expect(() => validateCandidates(["gpt-4"])).toThrow(/not a supported NVIDIA/i);
    expect(() => validateCandidates([])).toThrow(/No candidate/i);
    const report = await runSwapComparison({
      candidates: ["mock-1"],
      cases: [
        { id: "a", prompt: "Return {\"ok\": true}", expectJson: false },
        { id: "b", prompt: "Say hello", expectJson: false },
      ],
    });
    expect(report.switched).toBe(false);
    expect(report.live).toBe(false);
    expect(report.cases.every((c) => c.mocked)).toBe(true);
    expect(report.summary["mock-1"].total).toBe(2);
    const noConfirm = await confirmModelSwitch({ candidate: "nvidia/nemotron-3-ultra-550b-a55b", confirmed: false, fallback: "mock-1" });
    expect(noConfirm.ok).toBe(false);
  });

  it("timeouts recorded honestly; active model preserved", async () => {
    await isolatedEnv();
    const { MockAdapter } = await import("@/core/keep/adapter");
    vi.spyOn(MockAdapter.prototype, "generate").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { text: "late", tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, latency_ms: 50, adapter: "mock", model: "mock-1" };
    });
    const report = await runSwapComparison({ candidates: ["mock-1"], cases: [{ id: "slow", prompt: "hi" }], timeoutMs: 5 });
    expect(report.cases[0].timedOut).toBe(true);
    expect(report.cases[0].ok).toBe(false);
  });

  it("deadlines are read-only, explicit, deduplicated, dismissable", async () => {
    await isolatedEnv();
    const seeded = await submitCandidate({ content: "Visa renewal due 2026-11-20, file before deadline.", kind: "semantic", source: { type: "user", ref: "test" }, provenance: "user-explicit:test", accountId: "local" });
    expect(seeded.stored).toBe(true);
    const all = await collectDeadlines(Date.parse("2026-10-01"));
    const hit = all.find((d) => d.date === "2026-11-20");
    expect(hit).toBeDefined();
    expect(hit?.explicit).toBe(true);
    expect(hit?.source).toMatch(/^memory:/);
    expect(hit?.stale).toBe(false);
    const twice = await collectDeadlines(Date.parse("2026-10-01"));
    expect(twice.filter((d) => d.id === hit!.id)).toHaveLength(1);
    await dismissDeadline(hit!.id);
    expect((await collectDeadlines(Date.parse("2026-10-01"))).some((d) => d.id === hit!.id)).toBe(false);
  });

  it("language mode preserves meaning across en/hi/hinglish with fallback", async () => {
    await isolatedEnv();
    const en = explain("hard-denied", "en", { tool: "shell.exec" });
    const hi = explain("hard-denied", "hi", { tool: "shell.exec" });
    const hg = explain("hard-denied", "hinglish", { tool: "shell.exec" });
    for (const s of [en, hi, hg]) {
      expect(s).toContain("shell.exec");
    }
    expect(hi).not.toBe(en);
    expect(hg).not.toBe(en);
    // Fallback: unknown lang code -> en
    const { explainLang } = await import("@/core/i18n/explain");
    expect(explainLang("fr")).toBe("en");
    const leakHi = explain("leak-blocked", "hi");
    expect(leakHi.length).toBeGreaterThan(10);
  });
});
