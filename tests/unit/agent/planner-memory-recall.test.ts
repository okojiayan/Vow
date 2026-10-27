import { describe, expect, it } from "vitest";
import { classifyIntent, heuristicPlan } from "@/core/agent/planner";

const SPRINT_POSITIVES = [
  "From project memory, what did we decide?",
  "Recall the constraints from the previous VOW work.",
  "What do you remember about the architecture?",
  "Find the earlier decision about model selection.",
];

describe("planner memory-recall routing (Loop 2 sprint)", () => {
  it("routes all four sprint memory phrases to memory.search", () => {
    for (const q of SPRINT_POSITIVES) {
      expect(classifyIntent(q), `intent for: ${q}`).toBe("memory-recall");
      const plan = heuristicPlan(q);
      expect(
        plan.steps.some((s) => s.action?.tool === "memory.search"),
        `memory.search for: ${q}`,
      ).toBe(true);
      // Grounded analysis step must follow recall.
      expect(
        plan.steps.some((s) => s.analysis === true && s.expectGrounding === "memory"),
        `grounded analysis for: ${q}`,
      ).toBe(true);
    }
  });

  it("handles decision-recall variants without memory keywords", () => {
    for (const q of [
      "What did we decide about the deadline?",
      "Did we agree on a launch date?",
      "What was the earlier conclusion on model choice?",
      "Find the previous resolution about caching.",
      "We discussed the API shape last time, what did we decide?",
    ]) {
      expect(classifyIntent(q), `intent for: ${q}`).toBe("memory-recall");
      const plan = heuristicPlan(q);
      expect(plan.steps[0]?.action?.tool, `tool for: ${q}`).toBe("memory.search");
    }
  });

  it("does not capture forward-looking or unrelated requests", () => {
    const negatives: Array<[string, string]> = [
      ["Make a decision about lunch", "tool-action"],
      ["What is the deployment outcome?", "direct-answer"],
      ["What is the capital of France?", "direct-answer"],
      ["Compute 45 plus 38?", "direct-answer"],
      ["We should agree on lunch tomorrow", "tool-action"],
      ["We will decide the venue next week", "tool-action"],
      ["Resolve the merge conflict in main", "tool-action"],
      ["Delete all files now", "tool-action"],
    ];
    for (const [q, expected] of negatives) {
      expect(classifyIntent(q), `intent for: ${q}`).toBe(expected);
      const plan = heuristicPlan(q);
      expect(
        plan.steps.some((s) => s.action?.tool === "memory.search"),
        `no memory.search for: ${q}`,
      ).toBe(false);
    }
  });

  it("empty retrieval is handled by grounded analysis copy, not invented facts", () => {
    const plan = heuristicPlan("Find the earlier decision about model selection.");
    const analysis = plan.steps.find((s) => s.analysis === true);
    expect(analysis?.instruction).toMatch(/ONLY using the memory\.search records/i);
    expect(analysis?.instruction).toMatch(/instead of inventing/i);
  });
});
