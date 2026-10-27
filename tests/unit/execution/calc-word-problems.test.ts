import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicCalcPlan } from "@/core/agent/planner";
import {
  evaluateCalcExpression,
  translateRequestToCalcExpressions,
  translateRequestToExpression,
} from "@/core/execution/calc";
import { checkCalc } from "@/core/verification/checks";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { updateSettings } from "@/core/settings";
import { resetEnvCache } from "@/lib/env";
import { isolatedEnv } from "../../helpers";
import type { PlanStep } from "@/core/agent/types";

vi.mock("@/integrations/meterless/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/integrations/meterless/client")>();
  return {
    ...orig,
    completeChat: vi.fn(async () => ({
      ok: false as const,
      code: "not_configured" as const,
      error: "mocked offline for word-problem tests",
    })),
  };
});

import { completeChat } from "@/integrations/meterless/client";

const mockedCompleteChat = vi.mocked(completeChat);

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

// General word-problem fixtures only: different numbers and phrasings from any
// benchmark case. Proves the deterministic route is general, not ID-specific.
describe("general word-problem calculations (isolated)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("translates rate*time with an explicit numeric cue", () => {
    const got = translateRequestToCalcExpressions(
      "A van drives at 80 km/h for 3 hours. Reply with the number of km.",
    );
    expect(got).toEqual(["80*3"]);
    expect(evaluateCalcExpression(got![0]).result).toBe(240);
  });

  it("translates discount to a single net-price expression", () => {
    const got = translateRequestToCalcExpressions(
      "A $100 price is discounted 20%. What is the sale price? Reply with the number.",
    );
    expect(got).toHaveLength(1);
    expect(evaluateCalcExpression(got![0]).result).toBe(80);
  });

  it("translates percent-off phrasing", () => {
    const got = translateRequestToCalcExpressions(
      "Compute 20% off $50. Reply with the number.",
    );
    expect(got).toHaveLength(1);
    expect(evaluateCalcExpression(got![0]).result).toBe(40);
  });

  it("translates average of an explicit list", () => {
    const got = translateRequestToCalcExpressions(
      "What is the average of 10, 20 and 30? Reply with the number.",
    );
    expect(got).toEqual(["(10+20+30)/3"]);
    expect(evaluateCalcExpression(got![0]).result).toBe(20);
  });

  it("translates fraction and percent-of phrasing", () => {
    expect(translateRequestToCalcExpressions("What is half of 100? Reply with the number.")).toEqual(["(100)/2"]);
    expect(translateRequestToCalcExpressions("Compute two thirds of 90. Reply with the number.")).toEqual(["(90)*2/3"]);
    expect(translateRequestToCalcExpressions("What is 25% of 200? Reply with the number.")).toEqual(["(200)*25/100"]);
    expect(evaluateCalcExpression("(100)/2").result).toBe(50);
  });

  it("translates rectangle area+perimeter to two expressions", () => {
    const got = translateRequestToCalcExpressions(
      "A rectangle is 5 by 3. Reply with its area followed by its perimeter, comma separated.",
    );
    expect(got).toEqual(["5*3", "2*(5+3)"]);
    expect(evaluateCalcExpression(got![0]).result).toBe(15);
    expect(evaluateCalcExpression(got![1]).result).toBe(16);
  });

  it("refuses narrative prose without a numeric cue", () => {
    expect(translateRequestToExpression("A van drives at 80 km/h for 3 hours. How far did it go in the story?")).toBeNull();
    expect(translateRequestToExpression("What was half of 100 in the old tale?")).toBeNull();
    expect(translateRequestToExpression("The average of the readings was discussed at length.")).toBeNull();
    expect(translateRequestToCalcExpressions("A rectangle 5 by 3 was described in the novel.")).toBeNull();
  });

  it("fast path builds one step per expression with deterministic mode", () => {
    const single = deterministicCalcPlan("What is half of 100? Reply with the number.")!;
    expect(single.plan.inferenceMode).toBe("deterministic");
    expect(single.expressions).toHaveLength(1);
    expect(single.plan.steps.map((s) => s.action?.tool)).toEqual(["calc.evaluate"]);

    const rect = deterministicCalcPlan(
      "A rectangle is 5 by 3. Reply with its area followed by its perimeter, comma separated.",
    )!;
    expect(rect.plan.inferenceMode).toBe("deterministic");
    expect(rect.expressions).toEqual(["5*3", "2*(5+3)"]);
    expect(rect.plan.steps.map((s) => s.action?.tool)).toEqual(["calc.evaluate", "calc.evaluate"]);
  });
});

describe("word-problem lifecycle (isolated, mocked offline)", () => {
  afterEach(() => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
    delete process.env.METERLESS_API_KEY;
    resetEnvCache();
    mockedCompleteChat.mockClear();
  });

  it.each([
    ["A van drives at 80 km/h for 3 hours. Reply with the number of km.", "240"],
    ["A $100 price is discounted 20%. What is the sale price? Reply with the number.", "80"],
    ["What is the average of 10, 20 and 30? Reply with the number.", "20"],
    ["What is half of 100? Reply with the number.", "50"],
  ])("completes %s without model calls", async (prompt, want) => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun(prompt);
    expect(mockedCompleteChat).not.toHaveBeenCalled();
    expect(task.inferenceMode).toBe("deterministic");
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(task.resultSummary ?? "").toContain(want);
    const trace = await getTrace(task.id);
    expect(trace.events.some((e) => e.title === "Deterministic calculation plan")).toBe(true);
    expect(trace.events.some((e) => e.kind === "model_response")).toBe(false);
  });

  it("completes rectangle area+perimeter with both numbers verified", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun(
      "A rectangle is 5 by 3. Reply with its area followed by its perimeter, comma separated.",
    );
    expect(mockedCompleteChat).not.toHaveBeenCalled();
    expect(task.plan?.steps.map((s) => s.action?.tool)).toEqual(["calc.evaluate", "calc.evaluate"]);
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(task.resultSummary ?? "").toContain("15");
    expect(task.resultSummary ?? "").toContain("16");
  });

  it("wrong word-problem result still fails verification", async () => {
    const bad = await checkCalc(
      step({
        id: "s1",
        action: { tool: "calc.evaluate", args: { expression: "(100)/2" } },
        output: { result: 999, kind: "number", expression: "(100)/2" },
      }),
    );
    expect(bad.passed).toBe(false);
  });
});
