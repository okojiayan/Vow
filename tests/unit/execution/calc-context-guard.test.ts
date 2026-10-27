import { describe, expect, it } from "vitest";
import {
  CalcError,
  evaluateCalcExpression,
  translateRequestToExpression,
} from "@/core/execution/calc";
import { deterministicCalcPlan } from "@/core/agent/planner";
import { checkCalc } from "@/core/verification/checks";
import { startAndRun } from "@/core/agent/orchestrator";
import { isolatedEnv } from "../../helpers";
import type { PlanStep } from "@/core/agent/types";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

// v2.2.1: context-safe calculation routing. Identifier-like text, phone-like
// numbers, and bracketed log IDs must not become arithmetic; genuine
// subtraction and mixed-prose arithmetic must keep working. No benchmark IDs.
describe("context-safe calculation routing", () => {
  it("refuses identifier fragments, phone shapes, and bracketed log IDs", () => {
    // Frozen v2.2.0 audit failures (anchors).
    expect(translateRequestToExpression("Order XT2-4491-B was shipped yesterday.")).toBeNull();
    expect(translateRequestToExpression("Call me at 555-0142 after lunch.")).toBeNull();
    expect(translateRequestToExpression("Log entry [20261101-2] archived.")).toBeNull();
    // Fresh variants: identifiers in different positions and shapes.
    expect(translateRequestToExpression("Ticket AB12-345-CD is pending review.")).toBeNull();
    expect(translateRequestToExpression("The replacement unit, serial 8X-2201-Z, ships Friday.")).toBeNull();
    expect(translateRequestToExpression("Flight BA2490-B boards at gate 7.")).toBeNull();
    expect(translateRequestToExpression("See ref [98765-4321] for details.")).toBeNull();
    expect(translateRequestToExpression("Reach me on 212-8675 tomorrow morning.")).toBeNull();
    expect(translateRequestToExpression("Pick a number from 10-20 for the raffle.")).toBeNull();
    expect(translateRequestToExpression("The 6A57 train leaves at 6:45pm from platform 3.")).toBeNull();
    expect(translateRequestToExpression("Meeting rescheduled to 2025-03-14, room B-12.")).toBeNull();
    // No deterministic plan is produced for any of the above.
    expect(deterministicCalcPlan("Order XT2-4491-B was shipped yesterday.")).toBeNull();
    expect(deterministicCalcPlan("Call me at 555-0142 after lunch.")).toBeNull();
    expect(deterministicCalcPlan("Log entry [20261101-2] archived.")).toBeNull();
    expect(deterministicCalcPlan("Ticket AB12-345-CD is pending review.")).toBeNull();
  });

  it("preserves genuine subtraction and legitimate mixed-prose arithmetic", () => {
    expect(translateRequestToExpression("What is 100 minus 37?")).toBe("100-37");
    expect(translateRequestToExpression("Compute 50-8?")).toBe("50-8");
    expect(translateRequestToExpression("What is (14 - 6) * 3?")).toBe("(14 - 6) * 3");
    expect(translateRequestToExpression("Compute 12 times 3?")).toBe("12*3");
    expect(translateRequestToExpression("Lena has 3 baskets with 6 oranges. Compute 3 times 6?")).toBe("3*6");
    expect(translateRequestToExpression("What is 10 minus 4 then add 2?")).toBe("(10-4)+2");
    expect(translateRequestToExpression("What is -5 plus 12?")).toBe("-5+12");
    expect(translateRequestToExpression("Output only the number equal to 7 * 6 + 8.")).toBe("7 * 6 + 8");
    // Explicit cue authorizes an otherwise ambiguous hyphen shape.
    expect(translateRequestToExpression("What is 555-0142?")).toBe("555-0142");
    expect(translateRequestToExpression("Compute 100-50-25?")).toBe("100-50-25");
    expect(evaluateCalcExpression("100-50-25").result).toBe(25);
  });

  it("rejects inexact integer arithmetic beyond the safe range", () => {
    // Frozen v2.2.0 D06 input: finite but inexact in doubles.
    expect(
      translateRequestToExpression("Compute 9999999999999999999999 times 88888888888888888888?"),
    ).toBeNull();
    expect(() =>
      evaluateCalcExpression("9999999999999999999999*88888888888888888888"),
    ).toThrowError(CalcError);
    expect(() => evaluateCalcExpression("9999999999999999999999+1")).toThrowError(/exactly-representable/);
    // Exact small-integer arithmetic is unaffected.
    expect(evaluateCalcExpression("7^3").result).toBe(343);
    expect(evaluateCalcExpression("(100)/2").result).toBe(50);
    expect(evaluateCalcExpression("7/2").result).toBe(3.5);
  });

  it("fails verification for calculator expressions the request did not authorize", async () => {
    const unauthorized = await checkCalc(
      step({
        id: "u",
        action: { tool: "calc.evaluate", args: { expression: "2-4491" } },
        output: { expression: "2-4491", result: -4489, kind: "number" },
      }),
      "Order XT2-4491-B was shipped yesterday.",
    );
    expect(unauthorized.passed).toBe(false);
    const authorized = await checkCalc(
      step({
        id: "a",
        action: { tool: "calc.evaluate", args: { expression: "45+38" } },
        output: { expression: "45+38", result: 83, kind: "number" },
      }),
      "Compute 45 plus 38?",
    );
    expect(authorized.passed).toBe(true);
    const mismatched = await checkCalc(
      step({
        id: "m",
        action: { tool: "calc.evaluate", args: { expression: "45+38" } },
        output: { expression: "45+38", result: 84, kind: "number" },
      }),
      "Compute 45 plus 38?",
    );
    expect(mismatched.passed).toBe(false);
  });

  it("fails identifier-like requests closed at the task level without provider calls", async () => {
    for (const input of [
      "Order XT2-4491-B was shipped yesterday.",
      "Call me at 555-0142 after lunch.",
      "Log entry [20261101-2] archived.",
    ]) {
      await isolatedEnv();
      const { task } = await startAndRun(input);
      expect(["failed", "blocked"]).toContain(task.status);
      expect(task.inferenceMode).not.toBe("live-model");
    }
  });
});
