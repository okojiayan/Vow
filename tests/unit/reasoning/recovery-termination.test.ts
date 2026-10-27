import { describe, expect, it } from "vitest";
import { applyReplan, decideRecovery } from "@/core/reasoning/recovery";
import { buildGraphFromTask as buildGraph, buildGraphFromTask } from "@/core/reasoning/task-graph";
import { createBudget } from "@/core/reasoning/effort";
import type { AgentTask } from "@/core/agent/types";

function fakeTask(): AgentTask {
  const now = new Date().toISOString();
  return { id: "t", conversationId: "c", request: "q", status: "executing", plan: { summary: "s", inferenceMode: "heuristic-demo", steps: [{ id: "s1", title: "A", action: { tool: "calc.evaluate", args: { expression: "1+1" } }, instruction: "a", status: "pending", requiresApproval: false }] }, currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null, inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now };
}

describe("recovery termination", () => {
  it("stops after repeated identical-signature failures instead of looping", () => {
    const g = buildGraph(fakeTask());
    const sg = { ...g.subgoals[0], attempts: 2 };
    const d = decideRecovery({ subgoal: sg, kind: "tool_error", replans: 0, budget: createBudget("Max"), sameSignatureFailures: 2 });
    expect(d.action).toBe("stop");
    expect(d.reason).toMatch(/pointless/i);
  });
  it("denials escalate immediately without retrying", () => {
    const g = buildGraph(fakeTask());
    const d = decideRecovery({ subgoal: g.subgoals[0], kind: "denied", replans: 0, budget: createBudget("Max"), sameSignatureFailures: 0 });
    expect(d.action).toBe("escalate");
  });
  it("replan re-queues the same vetted action (same stepId), never a new one", () => {
    const g = buildGraphFromTask(fakeTask());
    const g2 = applyReplan(g, "s1", "Alt");
    const alt = g2.subgoals.find((s) => s.id !== "s1");
    expect(alt?.stepId).toBe("s1");
    const step = fakeTask().plan!.steps[0];
    expect(step.action).toEqual({ tool: "calc.evaluate", args: { expression: "1+1" } });
  });
});
