import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicCalcPlan, heuristicPlan } from "@/core/agent/planner";
import { evaluateCalcExpression } from "@/core/execution/calc";
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
      error: "mocked offline for calc fast-path test",
    })),
  };
});

import { completeChat } from "@/integrations/meterless/client";

const mockedCompleteChat = vi.mocked(completeChat);

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

describe("calc fast path routing (unit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes straightforward arithmetic deterministically", () => {
    for (const q of ["Compute 21 * 2 + 8", "What is (2 + 3) * 4?", "Calculate 2 + 3 * 4"]) {
      const fast = deterministicCalcPlan(q);
      expect(fast).not.toBeNull();
      expect(fast?.plan.inferenceMode).toBe("deterministic");
      expect(fast?.plan.steps).toHaveLength(1);
      expect(fast?.plan.steps[0]?.action?.tool).toBe("calc.evaluate");
      expect(typeof fast?.plan.steps[0]?.action?.args?.expression).toBe("string");
      // Expression must trial-evaluate to a finite number.
      const parsed = evaluateCalcExpression(fast!.expression);
      expect(parsed.kind).toBe("number");
      expect(Number.isFinite(parsed.result as number)).toBe(true);
    }
  });

  it("routes chained, power, GCD, boolean and string forms", () => {
    const chained = deterministicCalcPlan("Compute (2 + 3) * 4 then add 10");
    expect(chained?.plan.inferenceMode).toBe("deterministic");
    expect(chained?.plan.steps[0]?.action?.tool).toBe("calc.evaluate");

    const power = deterministicCalcPlan("What is 2 to the power 10?");
    expect(power?.plan.steps[0]?.action?.tool).toBe("calc.evaluate");

    const caret = deterministicCalcPlan("Calculate 2^3^2");
    expect(caret?.plan.steps[0]?.action?.tool).toBe("calc.evaluate");

    const gcd = deterministicCalcPlan("What is the greatest common divisor of 54 and 24?");
    expect(gcd?.expression).toBe("gcd(54,24)");

    const bool = deterministicCalcPlan("Evaluate true AND false OR NOT false");
    expect(bool?.plan.steps[0]?.action?.tool).toBe("calc.evaluate");

    const str = deterministicCalcPlan("Reverse 'hello'");
    expect(str?.plan.steps[0]?.action?.tool).toBe("calc.evaluate");
  });

  it("matches the heuristic fallback calc branch exactly", () => {
    for (const q of ["Compute 21 * 2 + 8", "Calculate 2^3^2", "What is the greatest common divisor of 54 and 24?"]) {
      const fast = deterministicCalcPlan(q)!;
      const heur = heuristicPlan(q);
      expect(heur.inferenceMode).not.toBe("deterministic");
      expect(heur.steps.map((s) => s.action?.tool)).toEqual(["calc.evaluate"]);
      expect(heur.steps[0]?.action?.args).toEqual(fast.plan.steps[0]?.action?.args);
    }
  });

  it("does not route ambiguous prose, dates, or hyphen fragments", () => {
    expect(deterministicCalcPlan("What was three quarters of 96 in the old story?")).toBeNull();
    expect(deterministicCalcPlan("What happened on 2024-03-15?")).toBeNull();
    expect(deterministicCalcPlan("Look up abc-123 in the catalog")).toBeNull();
    expect(deterministicCalcPlan("Tell me about Apollo 11")).toBeNull();
    expect(deterministicCalcPlan("")).toBeNull();
  });

  it("does not route store requests without operators, dangerous strings, or Zetaris requests", () => {
    expect(deterministicCalcPlan("Remember that the harbor ferry departs at 07:40.")).toBeNull();
    expect(deterministicCalcPlan("Please delete the file report.txt")).toBeNull();
    expect(deterministicCalcPlan("Run shell.exec to list files")).toBeNull();
    expect(deterministicCalcPlan("What abilities does Pikachu have?")).toBeNull();
    expect(deterministicCalcPlan("SELECT ability_name FROM pokeapi.pikachu_abilities_table")).toBeNull();
  });

  it("incorrect calculation results fail verification", async () => {
    const bad = await checkCalc(
      step({
        id: "s1",
        action: { tool: "calc.evaluate", args: { expression: "2 + 3 * 4" } },
        output: { result: 999, kind: "number", expression: "2 + 3 * 4" },
      }),
    );
    expect(bad.passed).toBe(false);
    const good = await checkCalc(
      step({
        id: "s2",
        action: { tool: "calc.evaluate", args: { expression: "2 + 3 * 4" } },
        output: { result: 14, kind: "number", expression: "2 + 3 * 4" },
      }),
    );
    expect(good.passed).toBe(true);
  });
});

describe("calc fast path lifecycle (isolated, mocked offline)", () => {
  afterEach(() => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
    delete process.env.METERLESS_API_KEY;
    resetEnvCache();
    mockedCompleteChat.mockClear();
  });

  it("calc task completes with zero model planning calls and deterministic provenance", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const before = Date.now();
    const { task } = await startAndRun("Compute 21 * 2 + 8");
    const wallMs = Date.now() - before;
    // Fast path must not issue any model planning/analysis call.
    expect(mockedCompleteChat).not.toHaveBeenCalled();
    expect(task.inferenceMode).toBe("deterministic");
    expect(task.plan?.steps.some((s) => s.action?.tool === "calc.evaluate")).toBe(true);
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(String(task.resultSummary ?? task.verification?.explanation ?? "")).toMatch(/50/);
    const trace = await getTrace(task.id);
    const titles = trace.events.map((e) => e.title);
    expect(titles).toContain("Deterministic calculation plan");
    expect(titles).toContain("Markovian skipped");
    // No provider-backed plan claim; deterministic calc is never labelled live-model.
    expect(task.inferenceMode).not.toBe("live-model");
    expect(trace.events.some((e) => e.kind === "model_response")).toBe(false);
    // Honest latency guard: must be far below the 60s planning timeout it replaces.
    expect(wallMs).toBeLessThan(30_000);
  });

  it("non-calc direct-answer still goes through the model path and fails honestly offline", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun("What is the principle of least privilege? Reply briefly.");
    expect(mockedCompleteChat).toHaveBeenCalled();
    expect(task.status).not.toBe("completed");
    expect(task.verification?.passed).not.toBe(true);
  });

  it("unsupported expressions fall back safely instead of calc-routing", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun("What happened on 2024-03-15?");
    // Date-like request must not select calc.
    expect(task.plan?.steps.some((s) => s.action?.tool === "calc.evaluate")).toBe(false);
    expect(mockedCompleteChat).toHaveBeenCalled();
  });
});
