import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatResultSummary,
  isFormatConstrainedRequest,
  summarize,
  verifiedStandaloneAnswer,
} from "@/core/agent/orchestrator";
import { verifySteps } from "@/core/verification/verifier";
import { resetEnvCache } from "@/lib/env";
import type { PlanStep } from "@/core/agent/types";

vi.mock("@/integrations/meterless/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/integrations/meterless/client")>();
  return {
    ...orig,
    completeChat: vi.fn(async () => ({
      ok: false as const,
      code: "not_configured" as const,
      error: "mocked offline for bare-answer summary test",
    })),
  };
});

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

function answerStep(analysis: unknown, provenance = "nvidia/nemotron-3-ultra-550b-a55b") {
  return step({
    id: "answer",
    title: "Answer directly",
    analysis: true,
    expectGrounding: "none",
    status: "verified",
    output: { analysis, provenance, evidenceId: "ev_test", memoryRefs: [], sourceRecordIds: [] },
  });
}

const EXPLANATION = "Standalone provider-backed answer verified; no tools required.";

describe("format-constrained standalone presentation (Phase 2O)", () => {
  afterEach(() => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
    delete process.env.METERLESS_API_KEY;
    resetEnvCache();
  });

  it("detects explicit format directives without matching ordinary prose", () => {
    expect(isFormatConstrainedRequest("Is this argument valid? Reply yes or no.")).toBe(true);
    expect(isFormatConstrainedRequest("Reply with only the word, nothing else.")).toBe(true);
    expect(isFormatConstrainedRequest("Answer with only the name, no explanation.")).toBe(true);
    expect(isFormatConstrainedRequest("Compute 21 * 2 + 8")).toBe(false);
    expect(isFormatConstrainedRequest("Compute 21 * 2 + 8 and explain each step.")).toBe(false);
    expect(isFormatConstrainedRequest("Is this valid? Explain why.")).toBe(false);
    expect(isFormatConstrainedRequest("Summarize the quarterly report.")).toBe(false);
  });

  it("returns the bare deliverable for the Phase 2N incident shape (yes-or-no constraint)", () => {
    const request = "All bloops are razzies. All razzies are zazzies. So all bloops are zazzies. Is this argument valid? Reply yes or no.";
    const summary = formatResultSummary(request, [answerStep("yes")], EXPLANATION, true, "completed");
    expect(summary).toBe("yes");
    expect(summary).not.toContain("Verification:");
  });

  it("does not inject verification claims into a wrong answer either (honest grading, not false verification)", () => {
    const summary = formatResultSummary("Reply yes or no: is the sky green?", [answerStep("no")], EXPLANATION, true, "completed");
    expect(summary).toBe("no");
    expect(summary).not.toContain("Verification:");
  });

  it("keeps the explanatory summary for ordinary unconstrained requests", () => {
    const summary = formatResultSummary("Is this valid? Explain why.", [answerStep("yes")], EXPLANATION, true, "completed");
    expect(summary).toContain("yes");
    expect(summary).toContain("Verification:");
  });

  it("never strips presentation without completed, verified, single-step evidence", () => {
    const constrained = "Reply yes or no.";
    const steps = [answerStep("yes")];
    expect(formatResultSummary(constrained, steps, EXPLANATION, false, "completed")).toContain("Verification:");
    expect(formatResultSummary(constrained, steps, EXPLANATION, true, "partial")).toContain("Verification:");
    expect(formatResultSummary(constrained, steps, EXPLANATION, true, "failed")).toContain("Verification:");
    expect(formatResultSummary(constrained, [...steps, answerStep("yes")], EXPLANATION, true, "completed")).toContain("Verification:");
    const toolStep = step({ id: "tool", title: "List", action: { tool: "fs.list", args: { path: "." } }, output: { path: "." } });
    expect(formatResultSummary(constrained, [toolStep], EXPLANATION, true, "completed")).toContain("Verification:");
    expect(verifiedStandaloneAnswer([answerStep("  ")])).toBeNull();
  });

  it("summarize() itself still carries the verification note (evidence stays inspectable)", () => {
    expect(summarize([answerStep("yes")], EXPLANATION)).toContain("Verification:");
  });
});

describe("standalone verification is evidence-based, not claim-based (Phase 2O)", () => {
  it("passes a non-empty provider-backed analysis with recorded evidence", async () => {
    const result = await verifySteps([answerStep("yes")], "goal");
    expect(result.passed).toBe(true);
  });

  it("rejects an empty analysis even when a verification claim surrounds it", async () => {
    const result = await verifySteps([answerStep("   ")], "goal");
    expect(result.passed).toBe(false);
  });

  it("rejects heuristic fallback text even when it asserts verification", async () => {
    const claimed = answerStep("Verified: the answer is definitely correct.", "heuristic-demo");
    const result = await verifySteps([claimed], "goal");
    expect(result.passed).toBe(false);
    expect(result.explanation).toMatch(/heuristic fallback/i);
  });
});
