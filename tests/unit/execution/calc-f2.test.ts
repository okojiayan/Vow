import { afterEach, describe, expect, it } from "vitest";
import {
  CalcError,
  evaluateCalcExpression,
  translateRequestToExpression,
} from "@/core/execution/calc";
import { heuristicPlan } from "@/core/agent/planner";
import { checkCalc } from "@/core/verification/checks";
import { startAndRun } from "@/core/agent/orchestrator";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../../helpers";
import type { PlanStep } from "@/core/agent/types";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

function num(expr: string): number {
  const out = evaluateCalcExpression(expr);
  if (out.kind !== "number" || typeof out.result !== "number") throw new Error(`not numeric: ${expr}`);
  return out.result;
}

// General fixtures only. No benchmark IDs, prompts, or expected answers.
describe("F2 deterministic calculation", () => {
  afterEach(() => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
  });

  it("evaluates arithmetic with documented precedence", () => {
    expect(num("2 + 3 * 4")).toBe(14);
    expect(num("(2 + 3) * 4")).toBe(20);
    expect(num("2^3^2")).toBe(512);
    expect(num("(2^3)^2")).toBe(64);
    expect(num("-5 + 3")).toBe(-2);
    expect(num("2 * -3")).toBe(-6);
    expect(num("7 / 2")).toBe(3.5);
    expect(num("7 % 3")).toBe(1);
    expect(num("0.5 * 8")).toBe(4);
    expect(num("((1 + 2) * (3 + 4)) - 5")).toBe(16);
  });

  it("supports gcd with defined integer semantics", () => {
    expect(num("gcd(54, 24)")).toBe(6);
    expect(num("gcd(7, 13)")).toBe(1);
    expect(num("gcd(0, 5)")).toBe(5);
    expect(num("gcd(-12, 18)")).toBe(6);
    expect(num("gcd(100, 10)")).toBe(10);
  });

  it("evaluates boolean expressions with NOT > AND > OR", () => {
    expect(evaluateCalcExpression("(true AND false) OR (NOT false)").result).toBe(true);
    expect(evaluateCalcExpression("true AND false").result).toBe(false);
    expect(evaluateCalcExpression("NOT true").result).toBe(false);
    expect(evaluateCalcExpression("NOT true OR true AND false").result).toBe(false);
    expect(evaluateCalcExpression("(NOT true OR true) AND false").result).toBe(false);
    expect(evaluateCalcExpression("true && false || !false").result).toBe(true);
  });

  it("evaluates string operations with clear semantics", () => {
    expect(evaluateCalcExpression("reverse('hello')").result).toBe("olleh");
    expect(evaluateCalcExpression("reverse('ab cd')").result).toBe("dc ba");
    expect(evaluateCalcExpression("count('l','hello world')").result).toBe(3);
    expect(evaluateCalcExpression("count('aa','aaaa')").result).toBe(2);
    expect(evaluateCalcExpression("count('z','abc')").result).toBe(0);
  });

  it("distinguishes error kinds", () => {
    expect(() => evaluateCalcExpression("")).toThrowError(CalcError);
    expect(() => evaluateCalcExpression("(1 + 2")).toThrowError(/parentheses/i);
    expect(() => evaluateCalcExpression("1 + ")).toThrowError(CalcError);
    expect(() => evaluateCalcExpression("1 / 0")).toThrowError(/zero/);
    expect(() => evaluateCalcExpression("7 % 0")).toThrowError(/zero/);
    expect(() => evaluateCalcExpression("gcd(0, 0)")).toThrowError(/undefined/);
    expect(() => evaluateCalcExpression("gcd(2.5, 4)")).toThrowError(/integers/);
    expect(() => evaluateCalcExpression("sqrt(4)")).toThrowError(CalcError);
    expect(() => evaluateCalcExpression("count('','abc')")).toThrowError(/non-empty/);
    expect(() => evaluateCalcExpression("2 $ 3")).toThrowError(CalcError);
  });

  it("enforces execution bounds", () => {
    expect(() => evaluateCalcExpression("1".padEnd(600, "+1"))).toThrowError(/limit/);
    expect(() => evaluateCalcExpression("(".repeat(60) + "1" + ")".repeat(60))).toThrowError(CalcError);
    expect(() => evaluateCalcExpression("10^1000")).toThrowError(CalcError);
  });

  it("translates word-form and chained requests deterministically", () => {
    expect(translateRequestToExpression("Compute 7 to the power 3, then subtract 2.")).toBe("(7^3)-2");
    expect(translateRequestToExpression("Compute (5 + 5) * 2, then add 3.")).toBe("((5 + 5) * 2)+3");
    expect(translateRequestToExpression("Compute 100 / 4, then multiply by 2.")).toBe("(100 / 4)*2");
    expect(translateRequestToExpression("What is the greatest common divisor of 54 and 24?")).toBe("gcd(54,24)");
    expect(translateRequestToExpression("Evaluate: (true AND false) OR (NOT false).")).toContain("true");
    expect(translateRequestToExpression("Reverse the string 'hello'.")).toBe("reverse('hello')");
    expect(translateRequestToExpression("Count the letter 'l' in 'hello world'.")).toBe("count('l','hello world')");
    expect(translateRequestToExpression("Output only the number equal to 7 * 6 + 8.")).toBe("7 * 6 + 8");
  });

  it("refuses non-calculation requests instead of inventing tool calls", () => {
    expect(translateRequestToExpression("How many days pass from 2024-01-01 to 2024-01-11?")).toBeNull();
    expect(translateRequestToExpression("Reply with these numbers sorted ascending: 9, 3, 7, 1.")).toBeNull();
    expect(translateRequestToExpression("What is the principle of least privilege?")).toBeNull();
    expect(translateRequestToExpression("A train travels at 60 km/h for 2.5 hours. How far?")).toBeNull();
  });

  it("routes calculation intents to calc without filesystem or memory side effects", () => {
    const chained = heuristicPlan("Compute (5 + 5) * 2, then add 3. Reply with the final number.");
    const tools = chained.steps.map((s) => s.action?.tool ?? "analysis");
    expect(tools).toEqual(["calc.evaluate"]);
    expect(tools).not.toContain("fs.list");
    expect(tools).not.toContain("memory.store");

    const boolean = heuristicPlan("Evaluate: (true AND false) OR (NOT false). Reply true or false.");
    expect(boolean.steps.map((s) => s.action?.tool)).toEqual(["calc.evaluate"]);

    const dates = heuristicPlan("How many days pass from 2024-01-01 to 2024-01-11? Reply with the number.");
    expect(dates.steps.map((s) => s.action?.tool)).not.toContain("calc.evaluate");
    expect(dates.steps.map((s) => s.action?.tool)).not.toContain("fs.list");
  });

  it("verifies numeric, boolean, and string tool results", async () => {
    const okNum = await checkCalc(step({ id: "a", action: { tool: "calc.evaluate", args: {} }, output: { result: 42 } }));
    expect(okNum.passed).toBe(true);
    const okBool = await checkCalc(step({ id: "b", action: { tool: "calc.evaluate", args: {} }, output: { result: true } }));
    expect(okBool.passed).toBe(true);
    const okStr = await checkCalc(step({ id: "c", action: { tool: "calc.evaluate", args: {} }, output: { result: "olleh" } }));
    expect(okStr.passed).toBe(true);
    const bad = await checkCalc(step({ id: "d", action: { tool: "calc.evaluate", args: {} }, output: { result: Number.NaN } }));
    expect(bad.passed).toBe(false);
    const missing = await checkCalc(step({ id: "e", action: { tool: "calc.evaluate", args: {} }, output: {} }));
    expect(missing.passed).toBe(false);
  });

  it("completes a multi-step chain with the final result, offline-safe", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute (5 + 5) * 2, then add 3. Reply with the final number.");
    expect(task.plan?.steps.map((s) => s.action?.tool)).toEqual(["calc.evaluate"]);
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(task.resultSummary ?? "").toContain("23");
  });
});
