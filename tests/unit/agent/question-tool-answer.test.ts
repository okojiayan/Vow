import { describe, expect, it } from "vitest";
import type { PlanStep } from "@/core/agent/types";
import {
  classifyIntent,
  heuristicPlan,
  isAdvisoryHowTo,
  isQuestionLike,
  needsWorkspaceAnswerStep,
  workspaceAnswerStep,
} from "@/core/agent/planner";
import { formatFailureShortfall } from "@/core/agent/orchestrator";
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

function fsListStep() {
  return step({
    id: "list",
    title: "List workspace",
    action: { tool: "fs.list", args: { path: "." } },
    status: "verified",
    output: [
      { name: "README.md", type: "file" },
      { name: "notes", type: "directory" },
    ],
  });
}

function workspaceAnswerStepFor(analysis: string, provenance = "live-model") {
  return step({
    id: "answer",
    title: "Answer from the observed workspace listing",
    analysis: true,
    expectGrounding: "workspace",
    status: "verified",
    output: { analysis, provenance, evidenceId: "ev_test", memoryRefs: [], sourceRecordIds: [] },
  });
}

describe("question / tool-answer routing (Phase 2S, no network)", () => {
  it("1. advisory how-to explains instead of auto-executing a tool", () => {
    const q = "What is the safe read-only way to list files in this workspace?";
    expect(isAdvisoryHowTo(q)).toBe(true);
    expect(classifyIntent(q)).toBe("direct-answer");
    const plan = heuristicPlan(q);
    expect(plan.steps.some((s) => s.action)).toBe(false);
    expect(plan.steps.some((s) => s.analysis === true && s.expectGrounding === "none")).toBe(true);
  });

  it("1b. how-do-I advisory variants explain without tools", () => {
    for (const q of [
      "How do I safely list files in this workspace?",
      "What is the best way to back up these notes?",
      "What is the recommended method for listing workspace files?",
    ]) {
      expect(isAdvisoryHowTo(q), `advisory: ${q}`).toBe(true);
      expect(classifyIntent(q), `intent: ${q}`).toBe("direct-answer");
      expect(heuristicPlan(q).steps.some((s) => s.action), `no tool: ${q}`).toBe(false);
    }
  });

  it("2. direct listing imperatives still route through authorized fs.list", () => {
    const q = "List the files in this workspace.";
    expect(isAdvisoryHowTo(q)).toBe(false);
    expect(classifyIntent(q)).toBe("tool-action");
    const plan = heuristicPlan(q);
    expect(plan.steps.some((s) => s.action?.tool === "fs.list")).toBe(true);
  });

  it("2b. destructive and unrelated action routes are unchanged", () => {
    expect(classifyIntent("Delete the file old-report.txt now.")).toBe("tool-action");
    expect(heuristicPlan("Delete the file old-report.txt now.").steps.some((s) => s.action?.tool === "fs.delete")).toBe(true);
    expect(classifyIntent("Which models cost under $1000? Reply with both names.")).toBe("direct-answer");
    expect(classifyIntent("What is the principle of least privilege? Reply briefly.")).toBe("direct-answer");
    expect(classifyIntent("List the IDs of open severity-1 incidents:\n- INC-1 open\n- INC-2 closed")).toBe("direct-answer");
  });

  it("3. workspace-state questions retrieve the listing and compose a grounded answer", () => {
    const q = "What files are in this workspace?";
    expect(isAdvisoryHowTo(q)).toBe(false);
    expect(classifyIntent(q)).toBe("tool-action");
    const plan = heuristicPlan(q);
    const tools = plan.steps.map((s) => (s.action ? s.action.tool : `analysis:${s.expectGrounding ?? "?"}`));
    expect(tools).toContain("fs.list");
    expect(tools).toContain("analysis:workspace");
    expect(needsWorkspaceAnswerStep(plan.steps, q)).toBe(false);
  });

  it("3b. needsWorkspaceAnswerStep is narrow", () => {
    expect(needsWorkspaceAnswerStep([fsListStep()], "What files are in this workspace?")).toBe(true);
    expect(needsWorkspaceAnswerStep([fsListStep()], "List the files in this workspace.")).toBe(true);
    expect(needsWorkspaceAnswerStep([fsListStep()], "Delete the file x.")).toBe(false);
    expect(needsWorkspaceAnswerStep([fsListStep(), workspaceAnswerStep()], "What files are in this workspace?")).toBe(false);
    expect(needsWorkspaceAnswerStep([step({ analysis: true, expectGrounding: "none" })], "What is 2+2?")).toBe(false);
  });

  it("3c. isQuestionLike matches the historical routing gate", () => {
    expect(isQuestionLike("What files are in this workspace?")).toBe(true);
    expect(isQuestionLike("List the files in this workspace.")).toBe(true);
    expect(isQuestionLike("Delete the file old-report.txt now.")).toBe(false);
    expect(isQuestionLike("Read the file notes/todo.md")).toBe(false);
  });

  it("4. context-only listing alone can never verify the outcome", async () => {
    const v = await verifySteps([fsListStep()], "What files are in this workspace?");
    expect(v.passed).toBe(false);
  });

  it("5. empty explanation plus empty step errors never yields '.' or empty", () => {
    for (const terminal of ["failed", "unverified"] as const) {
      const shortfall = formatFailureShortfall(terminal, "", []);
      expect(shortfall).not.toBe(".");
      expect(shortfall.trim().length).toBeGreaterThan(1);
      expect(shortfall).toMatch(/Verification failed/);
    }
    expect(formatFailureShortfall("unverified", "", [])).toMatch(/^Ended unverified: /);
    expect(formatFailureShortfall("unverified", "", [])).not.toBe("Ended unverified: .");
    expect(formatFailureShortfall("failed", "No evidence.", [])).toBe("No evidence.");
    expect(formatFailureShortfall("failed", "", ["boom"])).toBe(
      "Verification failed; the requested outcome was not established. Caused by: boom",
    );
    expect(formatFailureShortfall("unverified", "No evidence.", [])).toBe("Ended unverified: No evidence..");
  });

  it("6. a workspace-grounded answer verifies against observed entries", async () => {
    const v = await verifySteps(
      [
        fsListStep(),
        workspaceAnswerStepFor("Use fs.list on the workspace root: it shows README.md and the notes directory."),
      ],
      "What files are in this workspace?",
    );
    expect(v.passed).toBe(true);
  });

  it("6b. an ungrounded workspace answer is still refused", async () => {
    const v = await verifySteps(
      [fsListStep(), workspaceAnswerStepFor("The workspace holds secrets.txt and passwords.db.")],
      "What files are in this workspace?",
    );
    expect(v.passed).toBe(false);
  });

  it("7. heuristic-demo analysis never passes, even when grounded", async () => {
    const v = await verifySteps(
      [
        fsListStep(),
        workspaceAnswerStepFor("Use fs.list: it shows README.md and notes.", "heuristic-demo"),
      ],
      "What files are in this workspace?",
    );
    expect(v.passed).toBe(false);
  });
});
