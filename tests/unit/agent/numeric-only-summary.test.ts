import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatResultSummary,
  isNumericOnlyRequest,
  startAndRun,
  summarize,
  verifiedNumericCalcResult,
} from "@/core/agent/orchestrator";
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
      error: "mocked offline for numeric-only summary test",
    })),
  };
});

import { completeChat } from "@/integrations/meterless/client";

const mockedCompleteChat = vi.mocked(completeChat);

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

function calcStep(result: number, kind = "number") {
  return step({
    id: "calc",
    title: "Evaluate expression",
    action: { tool: "calc.evaluate", args: { expression: "7 * 6 + 8" } },
    output: { expression: "7 * 6 + 8", result, kind },
  });
}

describe("numeric-only deterministic presentation (Phase 2I)", () => {
  afterEach(() => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
    delete process.env.METERLESS_API_KEY;
    resetEnvCache();
    mockedCompleteChat.mockClear();
  });

  it("detects explicit numeric-only requests without matching ordinary prose", () => {
    expect(isNumericOnlyRequest("Output only the number equal to 7 * 6 + 8, with nothing else.")).toBe(true);
    expect(isNumericOnlyRequest("Reply with only the number equal to 2 + 2, nothing else.")).toBe(true);
    expect(isNumericOnlyRequest("Compute 21 * 2 + 8")).toBe(false);
    expect(isNumericOnlyRequest("Compute 21 * 2 + 8 and explain each step.")).toBe(false);
    expect(isNumericOnlyRequest("Reply with the word HELLO in uppercase only, nothing else.")).toBe(false);
  });

  it("returns a bare number for an explicitly numeric-only calculation", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun("Output only the number equal to 6 * 7 + 1, with nothing else.");
    expect(mockedCompleteChat).not.toHaveBeenCalled();
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(task.resultSummary).toBe("43");
  });

  it("handles a result of 50 through the general rule, not a hardcoded value", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun("Output only the number equal to 10 * 5, with nothing else.");
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(task.resultSummary).toBe("50");
    expect(isNumericOnlyRequest("Output only the number equal to 10 * 5, with nothing else.")).toBe(true);
  });

  it("keeps the explanatory response for ordinary calculation requests", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun("Compute 21 * 2 + 8");
    expect(task.status).toBe("completed");
    expect(task.resultSummary).toContain("Evaluate expression");
    expect(task.resultSummary).toContain("Verification:");
    expect(task.resultSummary).not.toBe("50");
  });

  it("never presents a failed or unverified calculation as bare success", () => {
    const verbose = summarize([calcStep(50)], "ok");
    expect(formatResultSummary("Output only the number equal to 7 * 6 + 8, with nothing else.", [calcStep(50)], "ok", false, "completed")).toBe(verbose);
    expect(formatResultSummary("Output only the number equal to 7 * 6 + 8, with nothing else.", [calcStep(50)], "ok", true, "partial")).toBe(verbose);
    expect(formatResultSummary("Output only the number equal to 7 * 6 + 8, with nothing else.", [calcStep(50)], "ok", true, "failed")).toBe(verbose);
  });

  it("does not strip non-numeric tool outputs", () => {
    const memStep = step({ id: "m", title: "Recall", action: { tool: "memory.search", args: {} }, output: [{ content: "Priya Nair" }] });
    const text = formatResultSummary(
      "Output only the number equal to 7 * 6 + 8, with nothing else.",
      [memStep],
      "ok",
      true,
      "completed",
    );
    expect(text).toContain("Recall");
    const multi = formatResultSummary(
      "Output only the number equal to 7 * 6 + 8, with nothing else.",
      [calcStep(50), calcStep(51)],
      "ok",
      true,
      "completed",
    );
    expect(multi).toContain("Verification:");
    expect(verifiedNumericCalcResult([memStep])).toBeNull();
  });

  it("preserves tool and verification evidence in the trace and task record", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockClear();
    const { task } = await startAndRun("Output only the number equal to 6 * 7 + 1, with nothing else.");
    expect(task.resultSummary).toBe("43");
    expect(task.verification?.passed).toBe(true);
    const calc = task.plan?.steps.find((s) => s.action?.tool === "calc.evaluate");
    expect((calc?.output as { result?: unknown })?.result).toBe(43);
    const trace = await getTrace(task.id);
    const titles = trace.events.map((e) => e.title);
    expect(titles.some((t) => t.startsWith("Tool ok: calc.evaluate"))).toBe(true);
    expect(titles).toContain("Verified");
  });
});
