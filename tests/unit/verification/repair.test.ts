import { describe, expect, it } from "vitest";
import { verifySteps } from "@/core/verification/verifier";
import { hasDistinctiveOverlap, isPlanEnvelope } from "@/core/verification/checks";
import type { PlanStep } from "@/core/agent/types";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

describe("non-vacuous verification", () => {
  it("rejects the old false-success plan: request-echo store verifies nothing", async () => {
    const steps = [
      step({ id: "a", action: { tool: "fs.list", args: { path: "." } }, output: [{ name: "README.md" }] }),
      step({ id: "b", action: { tool: "memory.store", args: {} }, output: { record: { id: "m1" } } }),
    ];
    const v = await verifySteps(steps, "What is the deploy window?");
    expect(v.passed).toBe(false);
  });

  it("memory.store verifies a genuine remember request", async () => {
    const v = await verifySteps(
      [step({ id: "b", action: { tool: "memory.store", args: {} }, output: { record: { id: "m1" } } })],
      "Remember that the deploy window is Saturday.",
    );
    expect(v.passed).toBe(true);
  });

  it("fs.list alone never verifies", async () => {
    const v = await verifySteps([
      step({ id: "a", action: { tool: "fs.list", args: { path: "." } }, output: [{ name: "README.md" }] }),
    ]);
    expect(v.passed).toBe(false);
  });

  it("memory.search with no records fails; with records passes", async () => {
    const empty = await verifySteps([step({ id: "a", action: { tool: "memory.search", args: {} }, output: [] })]);
    expect(empty.passed).toBe(false);
    const hits = await verifySteps([
      step({ id: "a", action: { tool: "memory.search", args: {} }, output: [{ id: "m1", content: "Deploy window is Saturday." }] }),
    ]);
    expect(hits.passed).toBe(true);
  });

  it("memory-grounded analysis requires a distinctive retrieved fact", async () => {
    const mem = step({ id: "a", action: { tool: "memory.search", args: {} }, output: [{ id: "m1", content: "The deploy window is Saturday 02:00-04:00 UTC." }] });
    const good = step({
      id: "b", analysis: true, expectGrounding: "memory",
      output: { analysis: "The window is Saturday 02:00-04:00 UTC.", provenance: "live-model" },
    });
    const v = await verifySteps([mem, good], "From memory, what is the deploy window?");
    expect(v.passed).toBe(true);

    const restating = step({
      id: "b", analysis: true, expectGrounding: "memory",
      output: { analysis: "The deploy window is unknown.", provenance: "live-model" },
    });
    const v2 = await verifySteps([mem, restating], "From memory, what is the deploy window?");
    expect(v2.passed).toBe(false);
  });

  it("planner-explicit standalone answers verify without tools", async () => {
    const v = await verifySteps([
      step({ id: "a", analysis: true, expectGrounding: "none", output: { analysis: "Least privilege limits access.", provenance: "live-model" } }),
    ]);
    expect(v.passed).toBe(true);
  });

  it("model-authored tool-less plans still do not verify", async () => {
    const v = await verifySteps([
      step({ id: "a", analysis: true, output: { analysis: "I did it.", provenance: "live-model" } }),
    ]);
    expect(v.passed).toBe(false);
  });

  it("heuristic fallback analysis never passes", async () => {
    const v = await verifySteps([
      step({ id: "b", analysis: true, expectGrounding: "none", output: { analysis: "Heuristic answer.", provenance: "heuristic-demo" } }),
    ]);
    expect(v.passed).toBe(false);
  });

  it("rejects plan/JSON envelopes instead of the artifact", async () => {
    const envelope = (analysis: string) =>
      step({ id: "b", analysis: true, expectGrounding: "none", output: { analysis, provenance: "live-model" } });
    for (const text of [
      '{"analysis":"1. Identify colors. 2. Format bullets. 3. Output three lines."}',
      'Answer directly: {"analysis":"do this then that"}',
      '{"steps":["one","two"]}',
    ]) {
      expect(isPlanEnvelope(text, "Reply with three bullet lines.")).toBe(true);
      const v = await verifySteps([envelope(text)], "Reply with three bullet lines.");
      expect(v.passed).toBe(false);
    }
    // Genuine JSON answers still verify when the goal requests JSON.
    expect(isPlanEnvelope('{"city":"Paris","temp":21}', "Reply with valid JSON with keys city and temp.")).toBe(false);
    const ok = await verifySteps(
      [envelope('{"city":"Paris","temp":21}')],
      "Reply with valid JSON with keys city and temp.",
    );
    expect(ok.passed).toBe(true);
    // Plain-text artifacts are unaffected.
    expect(isPlanEnvelope("- red\n- blue\n- yellow", "Reply with three bullet lines.")).toBe(false);
  });

  it("decimal measurements ground memory answers", () => {
    expect(hasDistinctiveOverlap("0.5", ["The error budget for checkout is 0.5 percent."], "What is the checkout error budget from project memory?")).toBe(true);
    expect(hasDistinctiveOverlap("0.5%", ["The error budget for checkout is 0.5 percent."], "What is the checkout error budget from project memory?")).toBe(true);
    expect(hasDistinctiveOverlap("unknown", ["The error budget for checkout is 0.5 percent."], "What is the checkout error budget from project memory?")).toBe(false);
  });

  it("hasDistinctiveOverlap ignores question restatement", () => {
    expect(hasDistinctiveOverlap("The deploy window is unknown.", ["The deploy window is Saturday."], "What is the deploy window?")).toBe(false);
    expect(hasDistinctiveOverlap("Saturday 02:00 works.", ["The deploy window is Saturday 02:00-04:00 UTC."], "What is the deploy window?")).toBe(true);
  });
});
