import { describe, expect, it } from "vitest";
import { runReasoningCycle } from "@/core/reasoning/runner";
import { clearLedger } from "@/core/reasoning/ledger";
import type { AgentTask } from "@/core/agent/types";

function task(): AgentTask {
  const now = new Date().toISOString();
  return { id: "rt-1", conversationId: "c", request: "Read notes", status: "executing",
    plan: { summary: "s", steps: [
      { id: "s1", title: "List", instruction: "list", action: { tool: "fs.list", args: { dir: "." } }, status: "pending", requiresApproval: false },
    ], inferenceMode: "heuristic-demo" },
    currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null,
    inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null,
    cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now };
}

describe("reasoning runner (evidence-based)", () => {
  it("executes tool and finishes with evidence provenance", async () => {
    clearLedger("rt-1");
    const r = await runReasoningCycle({
      task: task(), acceptance: ["notes listed"], ceiling: "Medium",
      model: { complete: async (p) => ({ text: `plan for ${p}`, provenance: "test-model:v1" }) },
      memory: { search: async () => [{ id: "m1", content: "prior note" }] },
      tools: { exec: async () => ({ ok: true, output: ["a.md"], provenance: "real-executor:fs.list" }) },
      onTrace: () => {},
    });
    expect(r.ops).toContain("execute_tool");
    expect(r.graph.evidence.length).toBeGreaterThan(0);
    expect(r.provenance).toContain("real-executor:fs.list");
    expect(["completed", "partial", "unverified", "failed", "blocked"]).toContain(r.outcome);
  });
  it("denial escalates to blocked, not fake success", async () => {
    const r = await runReasoningCycle({
      task: { ...task(), id: "rt-2" }, acceptance: ["x"], ceiling: "Medium",
      model: { complete: async () => ({ text: "t", provenance: "test-model" }) },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: false, error: "Denied by policy", provenance: "warden:deny" }) },
      maxCycles: 6, onTrace: () => {},
    });
    expect(r.outcome).not.toBe("completed");
    expect(r.graph.blockers.length + r.ops.filter((o) => o.startsWith("finish_") || o === "ask_user").length).toBeGreaterThan(0);
  });
});
