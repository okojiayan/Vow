import { describe, expect, it } from "vitest";
import { runReasoningCycle } from "@/core/reasoning/runner";
import { clearLedger } from "@/core/reasoning/ledger";
import { summarize } from "@/core/agent/orchestrator";
import type { AgentTask } from "@/core/agent/types";

function task(id: string): AgentTask {
  const now = new Date().toISOString();
  return { id, conversationId: "c", request: "Reply with three bullet lines.", status: "executing",
    plan: { summary: "s", steps: [
      { id: "a1", title: "Answer directly", instruction: "Answer directly.", status: "pending", requiresApproval: false, analysis: true, expectGrounding: "none" },
    ], inferenceMode: "heuristic-demo" },
    currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null,
    inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null,
    cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now };
}

describe("plan-envelope repair", () => {
  it("re-asks once when the provider returns a plan envelope, then uses the artifact", async () => {
    clearLedger("env-1");
    const calls: string[] = [];
    const r = await runReasoningCycle({
      task: task("env-1"), acceptance: ["three bullets"], ceiling: "Medium",
      model: {
        complete: async (p) => {
          calls.push(p);
          if (calls.length === 1) return { text: '{"analysis":"1. Identify. 2. Format. 3. Output."}', provenance: "test-model", usage: { promptTokens: 10, completionTokens: 5 } };
          return { text: "- red\n- blue\n- yellow", provenance: "test-model", usage: { promptTokens: 10, completionTokens: 5 } };
        },
      },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: true, output: {}, provenance: "t" }) },
      onTrace: () => {},
    });
    expect(calls.length).toBe(2);
    const out = r.graph.evidence.length;
    expect(out).toBeGreaterThan(0);
    expect(r.usage.promptTokens).toBe(20);
    expect(r.usage.completionTokens).toBe(10);
  });

  it("summarize emits only the analysis deliverable, not the envelope", () => {
    const text = summarize(
      [{ id: "a", title: "Answer directly", instruction: "i", requiresApproval: false, status: "running", analysis: true, expectGrounding: "none",
        output: { analysis: "- red\n- blue", provenance: "live" } }],
      "Verified.",
    );
    expect(text).not.toContain("provenance");
    expect(text).toContain("- red");
  });

  it("does not re-ask genuine JSON answers requested by the goal", async () => {
    clearLedger("env-2");
    let n = 0;
    await runReasoningCycle({
      task: { ...task("env-2"), request: "Reply with valid JSON with keys city and temp." },
      acceptance: ["json"], ceiling: "Medium",
      model: { complete: async () => { n += 1; return { text: '{"city":"Paris","temp":21}', provenance: "test-model" }; } },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: true, output: {}, provenance: "t" }) },
      onTrace: () => {},
    });
    expect(n).toBe(1);
  });
});
