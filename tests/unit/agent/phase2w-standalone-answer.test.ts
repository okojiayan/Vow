import { describe, expect, it } from "vitest";
import type { AgentTask, PlanStep } from "@/core/agent/types";
import { checkAnalysis, standaloneAbstention } from "@/core/verification/checks";
import { verifySteps } from "@/core/verification/verifier";
import { heuristicPlan } from "@/core/agent/planner";
import { buildGraphFromTask } from "@/core/reasoning/task-graph";
import { clearLedger } from "@/core/reasoning/ledger";
import { runReasoningCycle } from "@/core/reasoning/runner";

/** Phase 2V attempt r1, Mode B S11: the provider-backed analysis text that
 *  wrongly passed standalone verification and was stamped completed. */
const R1_VACUOUS_ANALYSIS = "No tool evidence is available to answer this question.";

const S11 = "What is the safe read-only way to list files in this workspace?";

function standaloneStep(analysis: string, provenance = "nvidia/nemotron-3-ultra-550b-a55b"): PlanStep {
  return {
    id: "answer",
    title: "Explain the safe method",
    instruction: "Answer directly from general knowledge.",
    analysis: true,
    expectGrounding: "none",
    status: "running",
    requiresApproval: false,
    output: { analysis, provenance, evidenceId: "ev_test", memoryRefs: [], sourceRecordIds: [] },
  } as PlanStep;
}

function standaloneTask(id: string, analysis: string): AgentTask {
  const now = new Date().toISOString();
  return {
    id, conversationId: "c", request: S11, status: "executing",
    plan: { summary: "s", inferenceMode: "heuristic-demo", steps: [standaloneStep(analysis)] },
    currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null,
    error: null, inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null,
    claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null,
    attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now,
  };
}

describe("Phase 2W standalone-answer integrity (no network)", () => {
  it("1. the demonstrated vacuous echo is detected as an abstention", () => {
    expect(standaloneAbstention(R1_VACUOUS_ANALYSIS)).toBe("states no evidence is available");
  });

  it("2. abstention variants are detected", () => {
    expect(standaloneAbstention("There is no evidence to answer this.")).not.toBeNull();
    expect(standaloneAbstention("I am unable to answer without more data.")).toBe("states it is unable to answer");
    expect(standaloneAbstention("I cannot answer this question.")).toBe("states it cannot answer");
    expect(standaloneAbstention("The evidence is insufficient to answer.")).not.toBeNull();
  });

  it("3. legitimate answers and refusal language are not abstentions", () => {
    expect(standaloneAbstention(
      "Use the built-in **fs.list** tool \u2014 it\u2019s read-only and won\u2019t modify anything. " +
      "Run it on the workspace root (e.g., `fs.list(path=\".\")`) to see all files and directories.",
    )).toBeNull();
    expect(standaloneAbstention("yes")).toBeNull();
    expect(standaloneAbstention("50")).toBeNull();
    // Safety-refusal wording is out of scope and must not be reclassified here.
    expect(standaloneAbstention("I can't help with deleting files.")).toBeNull();
  });

  it("4. the r1 vacuous analysis fails standalone verification (no falseSuccess)", async () => {
    const res = await checkAnalysis(standaloneStep(R1_VACUOUS_ANALYSIS), [standaloneStep(R1_VACUOUS_ANALYSIS)], S11);
    expect(res.passed).toBe(false);
    expect(res.explanation).toMatch(/abstain/i);
  });

  it("5. a genuine standalone answer still verifies", async () => {
    const answer = "Use the built-in fs.list tool on the workspace root; it is read-only.";
    const res = await checkAnalysis(standaloneStep(answer), [standaloneStep(answer)], S11);
    expect(res.passed).toBe(true);
    expect(res.explanation).toMatch(/no external grounding required/i);
  });

  it("6. verifySteps rejects the abstention end to end (task cannot complete)", async () => {
    const bad = await verifySteps([standaloneStep(R1_VACUOUS_ANALYSIS)], S11);
    expect(bad.passed).toBe(false);
    expect(bad.explanation).not.toMatch(/verified; no tools required/i);
    const good = await verifySteps(
      [standaloneStep("Use the built-in fs.list tool on the workspace root; it is read-only.")], S11);
    expect(good.passed).toBe(true);
  });

  it("7. heuristic-demo fallback text still fails (ordering preserved)", async () => {
    const res = await checkAnalysis(
      standaloneStep("Use fs.list on the workspace root.", "heuristic-demo"),
      [standaloneStep("Use fs.list on the workspace root.", "heuristic-demo")], S11);
    expect(res.passed).toBe(false);
    expect(res.explanation).toMatch(/heuristic fallback/i);
  });

  it("8. runner asks standalone steps for a direct answer, never for missing evidence", async () => {
    clearLedger("w8");
    const plan = heuristicPlan(S11);
    expect(plan.steps.some((s) => s.analysis === true && s.expectGrounding === "none")).toBe(true);
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: "w8", conversationId: "c", request: S11, status: "executing", plan,
      currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null,
      error: null, inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null,
      claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null,
      attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now,
    };
    // Sanity: the controller must route this single analysis step to investigate.
    const g = buildGraphFromTask(task, [S11]);
    expect(g.subgoals.some((s) => s.kind === "analysis")).toBe(true);
    let seenPrompt = "";
    let toolCalls = 0;
    await runReasoningCycle({
      task, acceptance: [S11], ceiling: "Medium",
      model: {
        complete: async (p) => {
          seenPrompt = p;
          return { text: "Use the built-in fs.list tool on the workspace root; it is read-only.", provenance: "test-model:v1" };
        },
      },
      memory: { search: async () => [] },
      tools: { exec: async () => { toolCalls += 1; return { ok: false, error: "must not be called", provenance: "test" }; } },
      onTrace: () => {},
    });
    expect(seenPrompt).not.toMatch(/no tool evidence available/i);
    expect(seenPrompt).not.toMatch(/Analyze ONLY the evidence/);
    expect(seenPrompt).toMatch(/directly from the request itself and general knowledge/i);
    expect(toolCalls).toBe(0);
  });

  it("9. runner keeps the evidence-analysis instruction for grounded steps", async () => {
    clearLedger("w9");
    const now = new Date().toISOString();
    const task: AgentTask = {
      id: "w9", conversationId: "c", request: "Summarize rows", status: "executing",
      plan: {
        summary: "s", inferenceMode: "deterministic", steps: [
          { id: "q", title: "Query", instruction: "q", action: { tool: "run_sql", args: { sql: "SELECT 1" } }, status: "pending", requiresApproval: false },
          { id: "a", title: "Summarize", instruction: "summarize", analysis: true, status: "pending", requiresApproval: false },
        ],
      },
      currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null,
      error: null, inferenceMode: "deterministic", autonomyMode: null, queuedAt: null,
      claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null,
      attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now,
    };
    let seenPrompt = "";
    await runReasoningCycle({
      task, acceptance: ["Summarize rows"], ceiling: "Medium",
      model: { complete: async (p) => { seenPrompt = p; return { text: "One row observed.", provenance: "test-model" }; } },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: true, output: { sql: "SELECT 1", rows: [["a"]], rowCount: 1, requestId: "r1" }, provenance: "executor" }) },
      onTrace: () => {},
    });
    expect(seenPrompt).toMatch(/Analyze ONLY the evidence/);
  });

  it("10. standalone task record round-trips the failure (no throw, no completion signal)", async () => {
    const task = standaloneTask("w10", R1_VACUOUS_ANALYSIS);
    const res = await verifySteps(task.plan!.steps, task.request);
    expect(res.passed).toBe(false);
    expect(res.checks.some((c) => !c.passed)).toBe(true);
  });
});
