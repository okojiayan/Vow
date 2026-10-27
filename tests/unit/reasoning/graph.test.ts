import { describe, expect, it } from "vitest";
import { buildGraphFromTask, readySubgoals, markSubgoal, addEvidence, checkpoint, serializeCheckpoint, restoreCheckpoint, acceptanceSatisfied } from "@/core/reasoning/task-graph";
import type { AgentTask } from "@/core/agent/types";

function fakeTask(): AgentTask {
  const now = new Date().toISOString();
  return { id: "task-1", conversationId: "c1", request: "Summarize notes", status: "planning", plan: { summary: "s", steps: [
    { id: "s1", title: "Read", instruction: "read", status: "pending", requiresApproval: false },
    { id: "s2", title: "Write", instruction: "write", status: "pending", requiresApproval: false },
  ], inferenceMode: "heuristic-demo" }, currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null, inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now };
}

describe("task graph", () => {
  it("builds subgoals with dependencies", () => {
    const g = buildGraphFromTask(fakeTask(), ["done"]);
    expect(g.subgoals).toHaveLength(2);
    expect(g.subgoals[1].dependsOn).toEqual(["s1"]);
    expect(readySubgoals(g).map((s) => s.id)).toEqual(["s1"]);
  });
  it("dependency gating works", () => {
    let g = buildGraphFromTask(fakeTask());
    g = markSubgoal(g, "s1", "succeeded");
    expect(readySubgoals(g).map((s) => s.id)).toEqual(["s2"]);
  });
  it("checkpoints round-trip", () => {
    let g = buildGraphFromTask(fakeTask());
    g = checkpoint(g, "c1");
    const r = restoreCheckpoint(serializeCheckpoint(g));
    expect(r.checkpoints).toHaveLength(1);
    expect(() => restoreCheckpoint("{}")).toThrow();
  });
  it("acceptance requires evidence", () => {
    const g = buildGraphFromTask(fakeTask(), ["done"]);
    expect(acceptanceSatisfied(g)).toBe(false);
    const { graph: g2, id } = addEvidence(g, "tool", "fs.read", "ok");
    const g3 = { ...g2, acceptance: g2.acceptance.map((a) => ({ ...a, satisfied: true as const, evidenceIds: [id] })) };
    expect(acceptanceSatisfied(g3)).toBe(true);
  });
});
