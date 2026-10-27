import { describe, expect, it } from "vitest";
import { decideNext } from "@/core/reasoning/controller";
import { buildGraphFromTask, markSubgoal } from "@/core/reasoning/task-graph";
import { clampToCeiling, createBudget, effortAllowed, recordModelCall, recordToolCall, suggestEffort, budgetExhausted } from "@/core/reasoning/effort";
import { appendLedger, getLedger, clearLedger } from "@/core/reasoning/ledger";
import { applyReplan, classifyFailure, decideRecovery, finalOutcome } from "@/core/reasoning/recovery";
import type { AgentTask } from "@/core/agent/types";

function fakeTask(): AgentTask {
  const now = new Date().toISOString();
  return { id: "t", conversationId: "c", request: "q", status: "executing", plan: { summary: "s", steps: [{ id: "s1", title: "A", instruction: "a", status: "pending", requiresApproval: false }], inferenceMode: "heuristic-demo" }, currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null, inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now };
}

describe("controller", () => {
  it("plans when no subgoals", () => {
    const g = { ...buildGraphFromTask(fakeTask()), subgoals: [] };
    expect(decideNext({ graph: g, budget: createBudget("High") }).op).toBe("plan");
  });
  it("executes ready subgoal and escalates on denied approval", () => {
    const g = buildGraphFromTask(fakeTask());
    expect(decideNext({ graph: g, budget: createBudget("High") }).op).toBe("execute_tool");
    expect(decideNext({ graph: g, budget: createBudget("High"), approvalDenied: true }).op).toBe("finish_blocked");
    expect(decideNext({ graph: g, budget: createBudget("High"), needsApproval: true }).op).toBe("ask_user");
  });
  it("stops honestly when budget exhausted", () => {
    const b = createBudget("Light");
    recordModelCall(b);
    const g = buildGraphFromTask(fakeTask());
    expect(decideNext({ graph: g, budget: b }).op).toMatch(/^finish_/);
  });
});

describe("effort", () => {
  it("ceiling enforced per subtask", () => {
    expect(effortAllowed("Max", "Medium")).toBe(false);
    expect(clampToCeiling("Max", "Medium")).toBe("Medium");
    expect(suggestEffort({})).toBe("Light");
    expect(suggestEffort({ consequential: true })).toBe("High");
  });
  it("budgets bound calls", () => {
    const b = createBudget("Light");
    expect(recordToolCall(b) && recordToolCall(b)).toBe(true);
    expect(recordToolCall(b)).toBe(false);
    expect(budgetExhausted(b)).toBe(true);
  });
});

describe("ledger", () => {
  it("records without chain-of-thought", () => {
    clearLedger("t1");
    appendLedger("t1", { kind: "decision", title: "d", detail: "why" });
    expect(getLedger("t1")).toHaveLength(1);
  });
});

describe("recovery", () => {
  it("denials escalate; retries bounded; replan inserts alternative", () => {
    const g = buildGraphFromTask(fakeTask());
    const sg = { ...g.subgoals[0], attempts: 0 };
    expect(classifyFailure("denied by policy")).toBe("denied");
    expect(decideRecovery({ subgoal: sg, kind: "denied", replans: 0, budget: createBudget("High") }).action).toBe("escalate");
    expect(decideRecovery({ subgoal: sg, kind: "tool_error", replans: 0, budget: createBudget("High") }).action).toBe("retry");
    const g2 = applyReplan(markSubgoal(g, "s1", "failed"), "s1", "Alt");
    expect(g2.subgoals.length).toBe(2);
  });
  it("honest outcomes", () => {
    const g = buildGraphFromTask(fakeTask(), ["ok"]);
    expect(finalOutcome(g, null)).toBe("unverified");
    const blocked = { ...g, blockers: [{ id: "b", reason: "x", resolved: false, createdAt: "" }] };
    expect(finalOutcome(blocked, null)).toBe("blocked");
  });
});
