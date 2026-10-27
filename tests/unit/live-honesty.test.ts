import { describe, expect, it } from "vitest";
import {
  agentStatusText,
  formatOutcome,
  isWorkingState,
  monitorHeaderFor,
  stepProgress,
  stepStatusText,
  stepTone,
  taskCardState,
  taskStateLabel,
  wardenDisplay,
} from "@/lib/task-display";

/**
 * Regression tests for the live-monitor honesty fixes in LiveActivity,
 * TaskDrawer, TaskInspector and HomePanels. They prove the derivation rules
 * those components share: the authoritative header wins over any caller
 * isActive flag, progress requires real step data, and terminal states never
 * present as working or successful.
 */

function showWorkingFor(task: { status: string; outcome?: { outcome: string } | null } | null, isActive: boolean): boolean {
  const header = monitorHeaderFor(task);
  const state = task ? taskCardState(task.status, task.outcome ?? null) : null;
  const working = state ? isWorkingState(state) : false;
  return header.mode === "working" && (isActive || working);
}

describe("live monitor never claims work that is not happening", () => {
  it("terminal blocked task never shows working even when the caller passes isActive", () => {
    const task = { status: "executing", outcome: { outcome: "blocked" } };
    expect(taskCardState(task.status, task.outcome)).toBe("blocked");
    expect(monitorHeaderFor(task).mode).toBe("idle");
    expect(showWorkingFor(task, true)).toBe(false);
  });

  it("waiting-for-approval task shows waiting, not working", () => {
    const task = { status: "awaiting_approval" };
    expect(taskCardState(task.status, null)).toBe("waiting_approval");
    expect(monitorHeaderFor(task)).toEqual({ mode: "waiting", text: "Waiting for approval" });
    expect(showWorkingFor(task, true)).toBe(false);
  });

  it("executing task shows working only from authoritative state", () => {
    const task = { status: "executing" };
    expect(monitorHeaderFor(task).mode).toBe("working");
    expect(showWorkingFor(task, true)).toBe(true);
    expect(showWorkingFor(task, false)).toBe(true);
    expect(showWorkingFor(null, true)).toBe(false);
  });

  it("progress bar requires both working state and real step data", () => {
    const working = isWorkingState(taskCardState("executing", null));
    expect(working).toBe(true);
    expect(stepProgress([])).toBeNull();
    // showProgress = working && progress !== null
    expect(working && stepProgress([]) !== null).toBe(false);
    const progress = stepProgress([{ status: "verified" }, { status: "failed" }]);
    expect(progress).toEqual({ done: 1, total: 2, pct: 50 });
    expect(working && progress !== null).toBe(true);
  });

  it("failed and blocked steps are never counted as done", () => {
    expect(stepTone("failed")).toBe("failed");
    expect(stepTone("blocked")).toBe("blocked");
    const progress = stepProgress([{ status: "failed" }, { status: "blocked" }]);
    expect(progress?.done).toBe(0);
  });
});

describe("task headings and warden labels stay honest", () => {
  it("inspector heading uses the card label, not the raw status string", () => {
    expect(taskStateLabel(taskCardState("blocked", { outcome: "blocked" }))).toBe("Blocked");
    expect(taskStateLabel(taskCardState("awaiting_approval", null))).toBe("Waiting for approval");
    expect(taskStateLabel(taskCardState("executing", null))).toBe("Running");
  });

  it("warden panel reflects confirmed backend, never animation alone", () => {
    const confirmed = { status: "confirmed" as const, gatewayAlwaysOn: true, mode: "autonomous" };
    expect(wardenDisplay(true, confirmed).panelTitle).toBe("WARDEN ACTIVE");
    expect(wardenDisplay(false, confirmed).panelTitle).toBe("WARDEN STANDBY");
    expect(wardenDisplay(true, { status: "pending" }).panelTitle).not.toBe("WARDEN ACTIVE");
  });
});

describe("waiting steps are never shown as actively executing", () => {
  it("labels awaiting_approval steps as waiting approval", () => {
    expect(stepStatusText("awaiting_approval")).toBe("Waiting approval");
    expect(stepStatusText("AWAITING_APPROVAL")).toBe("Waiting approval");
  });

  it("keeps the remaining step labels distinct and user-facing", () => {
    expect(stepStatusText("verified")).toBe("Completed");
    expect(stepStatusText("executing")).toBe("In progress");
    expect(stepStatusText("failed")).toBe("Failed");
    expect(stepStatusText("blocked")).toBe("Blocked");
    expect(stepStatusText("cancelled")).toBe("Cancelled");
    expect(stepStatusText("queued")).toBe("Queued");
    expect(stepStatusText("pending")).toBe("Queued");
    expect(stepStatusText("skipped")).toBe("Skipped");
  });
});

describe("outcome text never restates itself", () => {
  it("strips a stored Outcome prefix instead of doubling it", () => {
    expect(formatOutcome({ outcome: "blocked", reason: "Outcome: blocked after 3 cycles." })).toBe(
      "Blocked after 3 cycles."
    );
  });

  it("collapses doubly-prefixed records to a single statement", () => {
    expect(
      formatOutcome({ outcome: "blocked", reason: "Outcome: blocked \u2014 Outcome: blocked after 3 cycles." })
    ).toBe("Blocked after 3 cycles.");
  });

  it("keeps genuine reasons intact and null for missing outcomes", () => {
    expect(formatOutcome({ outcome: "failed", reason: "Acceptance not satisfied." })).toBe(
      "Failed \u2014 Acceptance not satisfied."
    );
    expect(formatOutcome(null)).toBeNull();
  });
});

describe("agents never report Done for unfinished terminal tasks", () => {
  it("maps every card state to an honest presence label", () => {
    expect(agentStatusText("blocked", false)).toBe("Blocked");
    expect(agentStatusText("failed", false)).toBe("Failed");
    expect(agentStatusText("partial", false)).toBe("Partially completed");
    expect(agentStatusText("cancelled", false)).toBe("Cancelled");
    expect(agentStatusText("unverified", false)).toBe("Unverified");
    expect(agentStatusText("completed", false)).toBe("Done");
    expect(agentStatusText("waiting_approval", false)).toBe("Waiting for approval");
    expect(agentStatusText("running", true)).toBe("Working...");
    expect(agentStatusText("blocked", true)).toBe("Working...");
  });
});
