import { describe, expect, it } from "vitest";
import {
  evaluateCalcExpression,
  translateRequestToExpression,
} from "@/core/execution/calc";
import { checkCalc } from "@/core/verification/checks";
import { startAndRun } from "@/core/agent/orchestrator";
import { isolatedEnv } from "../../helpers";
import type { PlanStep } from "@/core/agent/types";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

// v2.3.1: explicit calculation cue outranks incidental bare-hyphen ranges.
// Frozen expectations: written before execution, no benchmark IDs.
describe("cue-priority calculation routing", () => {
  it("prefers the explicitly requested calculation over incidental ranges", () => {
    expect(translateRequestToExpression("Ticket 100-20 is ready. What is 5 plus 5?")).toBe("5+5");
    // Reference number before the cue, separate sentences.
    expect(translateRequestToExpression("Order 200-30 shipped. Compute 8 plus 7?")).toBe("8+7");
    // Cue first, reference after.
    expect(translateRequestToExpression("What is 9 minus 4? Ticket 300-11 closed.")).toBe("9-4");
    // Multiple incidental fragments plus one clear request.
    expect(translateRequestToExpression("Error codes 11-2, 45-9 and 70-3 logged. Evaluate 9 times 9?")).toBe("9*9");
    expect(translateRequestToExpression("Scores 12-10 and 21-19 recorded. How much is 50 minus 5?")).toBe("50-5");
    // Phone-shaped incidental plus a clear request.
    expect(translateRequestToExpression("Call 800-5557 for pickup. What is 100 divided by 4?")).toBe("100/4");
    // Identifier-shaped incidental plus a clear request.
    expect(translateRequestToExpression("Shipment BX-900-221 arrived. Calculate 7 times 6?")).toBe("7*6");
  });

  it("preserves legitimate hyphen calculations", () => {
    expect(translateRequestToExpression("What is 555-0142?")).toBe("555-0142");
    expect(translateRequestToExpression("Compute 100-50-25?")).toBe("100-50-25");
    expect(evaluateCalcExpression("100-50-25").result).toBe(25);
    expect(translateRequestToExpression("What is 214 minus 89?")).toBe("214-89");
    expect(translateRequestToExpression("Compute 36 / 12?")).toBe("36 / 12");
  });

  it("stays fail-closed for identifier-only and vague numeric prose", () => {
    expect(translateRequestToExpression("Ticket 100-20 is ready.")).toBeNull();
    expect(translateRequestToExpression("Call me at 555-0142 after lunch.")).toBeNull();
    expect(translateRequestToExpression("Ticket 100-20 is ready. The 6A57 train leaves.")).toBeNull();
    expect(translateRequestToExpression("Scores were 12-10.")).toBeNull();
    // Global fallback still resolves cue-less heads with real arithmetic.
    expect(translateRequestToExpression("Compute the total. The bill is 40 plus 60.")).toBe("40+60");
  });

  it("authorizes the cued expression and rejects the incidental one", async () => {
    const goal = "Ticket 100-20 is ready. What is 5 plus 5?";
    const good = await checkCalc(
      step({
        id: "g",
        action: { tool: "calc.evaluate", args: { expression: "5+5" } },
        output: { expression: "5+5", result: 10, kind: "number" },
      }),
      goal,
    );
    expect(good.passed).toBe(true);
    const bad = await checkCalc(
      step({
        id: "b",
        action: { tool: "calc.evaluate", args: { expression: "100-20" } },
        output: { expression: "100-20", result: 80, kind: "number" },
      }),
      goal,
    );
    expect(bad.passed).toBe(false);
  });

  it("completes the cued request at the task level with the requested value", async () => {
    await isolatedEnv();
    const { task } = await startAndRun("Ticket 100-20 is ready. What is 5 plus 5?");
    expect(task.status).toBe("completed");
    expect(task.inferenceMode).toBe("deterministic");
    const planSteps = task.plan?.steps ?? [];
    expect(planSteps.map((s) => (s.action?.args as { expression?: string } | undefined)?.expression)).toContain("5+5");
    const texts = planSteps.map((s) => JSON.stringify(s.output ?? ""));
    expect(texts.join(" ")).toContain("10");
    expect(task.verification?.passed).toBe(true);
  });
});
