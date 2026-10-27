import { describe, expect, it } from "vitest";
import type { PlanStep } from "@/core/agent/types";
import { taskStatusForOutcome } from "@/core/reasoning/outcome";
import { taskCardState } from "@/lib/task-display";
import { verifySteps } from "@/core/verification/verifier";

function step(overrides: Partial<PlanStep>): PlanStep {
  return {
    id: "s1",
    title: "step",
    instruction: "do it",
    requiresApproval: false,
    status: "running",
    ...overrides,
  } as PlanStep;
}

const GOAL = "Read the workspace file.";

describe("outcome integrity (adversarial, no network)", () => {
  it("1. model claims success but no tool output exists -> not verified", async () => {
    const v = await verifySteps(
      [step({ action: { tool: "fs.read", args: { path: "notes/a.md" } }, output: null })],
      GOAL,
    );
    expect(v.passed).toBe(false);
    expect(v.explanation).toMatch(/no tool output/i);
  });

  it("1b. model merely talks with no executable action -> not verified", async () => {
    const v = await verifySteps([step({ instruction: "All done, success!" })], GOAL);
    expect(v.passed).toBe(false);
  });

  it("1c. context-only tool output alone proves nothing", async () => {
    const v = await verifySteps(
      [
        step({
          action: { tool: "fs.list", args: { dir: "." } },
          output: { entries: ["notes/a.md", "notes/b.md"] },
        }),
      ],
      GOAL,
    );
    expect(v.passed).toBe(false);
  });

  it("2. tool fails then success is claimed -> step failure is not success", async () => {
    const v = await verifySteps(
      [
        step({
          action: { tool: "fs.read", args: { path: "notes/a.md" } },
          status: "failed",
          error: "boom",
          output: { content: "stale words" },
        }),
      ],
      GOAL,
    );
    expect(v.passed).toBe(false);
    expect(v.checks.some((c) => /failed/i.test(c.explanation))).toBe(true);
  });

  it("3. one step succeeds while a required step fails -> overall not verified", async () => {
    const v = await verifySteps(
      [
        step({
          id: "ok",
          action: { tool: "fs.read", args: { path: "notes/a.md" } },
          output: { content: "real content here" },
        }),
        step({
          id: "bad",
          action: { tool: "fs.read", args: { path: "notes/b.md" } },
          status: "failed",
          error: "missing",
          output: null,
        }),
      ],
      GOAL,
    );
    expect(v.passed).toBe(false);
  });

  it("4. warden blocks a required action -> blocked, never verified", async () => {
    const v = await verifySteps(
      [
        step({
          action: { tool: "run_sql", args: { sql: "SELECT 1" } },
          status: "blocked",
          error: "Blocked by Warden.",
          output: null,
        }),
      ],
      "Check the database.",
    );
    expect(v.passed).toBe(false);
    const failed = v.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(0);
  });

  it("5. verification cannot establish the outcome -> fails closed", async () => {
    // Unauthorized calculator expression: result may be internally correct,
    // but the request never authorized it.
    const v = await verifySteps(
      [
        step({
          action: { tool: "calc.evaluate", args: { expression: "9*9" } },
          output: { result: 81, kind: "number" },
        }),
      ],
      "What is the capital of France?",
    );
    expect(v.passed).toBe(false);
  });

  it("6. genuine success with required evidence -> verified", async () => {
    const v = await verifySteps(
      [
        step({
          action: { tool: "fs.read", args: { path: "notes/a.md" } },
          output: { content: "real content here" },
        }),
      ],
      GOAL,
    );
    expect(v.passed).toBe(true);
    expect(v.uncertain).toBe(false);
  });

  it("7. repeated identical failures stay failures, deterministically", async () => {
    const failing = [
      step({
        action: { tool: "fs.read", args: { path: "notes/a.md" } },
        status: "failed",
        error: "boom",
        output: null,
      }),
    ];
    const first = await verifySteps(failing, GOAL);
    const second = await verifySteps(failing, GOAL);
    expect(first.passed).toBe(false);
    expect(second.passed).toBe(false);
    expect(second.explanation).toBe(first.explanation);
  });

  it("persisted status and UI never present partial/unverified as plain success", () => {
    expect(taskStatusForOutcome("unverified")).toBe("failed");
    expect(taskStatusForOutcome("partial")).toBe("completed");
    // The structured outcome still wins on the card: partial and unverified
    // render distinctly even though partial persists as status completed.
    expect(taskCardState("completed", { outcome: "partial" })).toBe("partial");
    expect(taskCardState("completed", { outcome: "unverified" })).toBe("unverified");
    expect(taskCardState("completed", { outcome: "completed" })).toBe("completed");
    expect(taskCardState("failed", { outcome: "blocked" })).toBe("blocked");
  });
});
