import { describe, expect, it } from "vitest";
import { decideNext } from "@/core/reasoning/controller";
import { buildGraphFromTask } from "@/core/reasoning/task-graph";
import { runReasoningCycle } from "@/core/reasoning/runner";
import { clearLedger } from "@/core/reasoning/ledger";
import { checkAnalysis } from "@/core/verification/checks";
import { heuristicPlan } from "@/core/agent/planner";
import type { AgentTask } from "@/core/agent/types";

function taskWithAnalysis(): AgentTask {
  const now = new Date().toISOString();
  return { id: "t", conversationId: "c", request: "Summarize Pikachu abilities", status: "executing",
    plan: { summary: "s", inferenceMode: "deterministic", steps: [
      { id: "s1", title: "Query", instruction: "q", action: { tool: "run_sql", args: { sql: "SELECT 1" } }, status: "pending", requiresApproval: false },
      { id: "s2", title: "Summarize", instruction: "summarize", analysis: true, status: "pending", requiresApproval: false },
    ] }, currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null,
    inferenceMode: "deterministic", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null,
    cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now };
}

describe("sponsor handoff (mocked)", () => {
  it("planner always pairs a Zetaris query with a row-grounded summarize step", () => {
    for (const q of [
      "Query Pikachu abilities from pokeapi.pikachu_abilities_table and summarize them",
      "Query Pikachu abilities from pokeapi.pikachu_abilities_table",
      "Query pokeapi.pikachu_abilities_table for Pikachu and report how many rows were returned.",
    ]) {
      const plan = heuristicPlan(q);
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].action?.tool).toBe("run_sql");
      expect(plan.steps[1].analysis).toBe(true);
      expect(plan.steps[1].expectGrounding).toBe("tool-rows");
      expect(plan.steps[1].action).toBeUndefined();
    }
  });
  it("controller routes ready analysis subgoals to investigate, not execute_tool", () => {
    const g = buildGraphFromTask(taskWithAnalysis());
    expect(g.subgoals[1].kind).toBe("analysis");
    const done = { ...g, subgoals: g.subgoals.map((s) => (s.id === "s1" ? { ...s, status: "succeeded" as const } : s)) };
    const d = decideNext({ graph: done, budget: { ceiling: "Medium", modelCallsUsed: 0, toolCallsUsed: 0 } });
    expect(d.op).toBe("investigate");
    expect(d.subgoalId).toBe("s2");
  });
  it("model prompt carries real rows; <think> stripped; step output set", async () => {
    clearLedger("t");
    let seenPrompt = "";
    const r = await runReasoningCycle({
      task: taskWithAnalysis(), acceptance: ["done"], ceiling: "Medium",
      model: { complete: async (p) => { seenPrompt = p; return { text: "<think>hidden</think>Pikachu has lightning-rod.", provenance: "test-model:v1" }; } },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: true, output: { sql: "SELECT 1", rows: [["lightning-rod", "true"]], rowCount: 1, requestId: "r1" }, provenance: "executor" }) },
      onTrace: () => {},
    });
    expect(seenPrompt).toMatch(/lightning-rod/);
    expect(r.graph.evidence.some((e) => e.kind === "model" && !(e.note ?? "").includes("<think>"))).toBe(true);
    const s2 = r.graph.subgoals.find((s) => s.id === "s2");
    expect(s2?.status).toBe("succeeded");
  });
  it("strips unpaired think closers so no chain-of-thought is stored", async () => {
    clearLedger("t3");
    const r = await runReasoningCycle({
      task: { ...taskWithAnalysis(), id: "t3" }, acceptance: ["done"], ceiling: "Medium",
      model: { complete: async () => ({ text: "private musings here</think>Public: lightning-rod.", provenance: "test-model" }) },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: true, output: { sql: "SELECT 1", rows: [["lightning-rod", "true"]], rowCount: 1, requestId: "r1" }, provenance: "executor" }) },
      onTrace: () => {},
    });
    const notes = r.graph.evidence.filter((e) => e.kind === "model").map((e) => e.note ?? "");
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).not.toMatch(/musing|think/);
    expect(notes.some((n) => /lightning-rod/.test(n))).toBe(true);
  });
  it("analysis check rejects fabrication and heuristic fallback", async () => {
    const rows = { rows: [["lightning-rod", "true"]] };
    const bad = await checkAnalysis({ id: "a", title: "t", instruction: "i", analysis: true, requiresApproval: false, status: "running", output: { analysis: "Pikachu has static and volt-absorb.", provenance: "test-model" } }, [{ id: "q", title: "q", instruction: "q", action: { tool: "run_sql", args: {} }, requiresApproval: false, status: "verified", output: rows }]);
    expect(bad.passed).toBe(false);
    const heur = await checkAnalysis({ id: "a", title: "t", instruction: "i", analysis: true, requiresApproval: false, status: "running", output: { analysis: "lightning-rod observed.", provenance: "heuristic-demo" } }, [{ id: "q", title: "q", instruction: "q", action: { tool: "run_sql", args: {} }, requiresApproval: false, status: "verified", output: rows }]);
    expect(heur.passed).toBe(false);
    const good = await checkAnalysis({ id: "a", title: "t", instruction: "i", analysis: true, requiresApproval: false, status: "running", output: { analysis: "Pikachu has lightning-rod.", provenance: "nvidia/nemotron-x" } }, [{ id: "q", title: "q", instruction: "q", action: { tool: "run_sql", args: {} }, requiresApproval: false, status: "verified", output: rows }]);
    expect(good.passed).toBe(true);
  });
  it("failed query yields no grounded analysis (fails honestly)", async () => {
    const r = await runReasoningCycle({
      task: { ...taskWithAnalysis(), id: "t2" }, acceptance: ["done"], ceiling: "Medium",
      model: { complete: async () => ({ text: "no data", provenance: "test-model" }) },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: false, error: "Zetaris API key is not configured", provenance: "warden" }) },
      maxCycles: 8, onTrace: () => {},
    });
    expect(r.outcome).not.toBe("completed");
  });
});
