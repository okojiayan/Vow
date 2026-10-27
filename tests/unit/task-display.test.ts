import { describe, expect, it } from "vitest";
import {
  dedupeOutcomeBlocks,
  isTerminalTaskStatus,
  monitorHeaderFor,
  shouldPlayActivation,
  stepProgress,
  stepTone,
  taskCardState,
  taskStateLabel,
  wardenDisplay,
} from "@/lib/task-display";
import { SIDEBAR_LINKS } from "@/components/shell/Sidebar";
import { MOBILE_NAV_LINKS } from "@/components/shell/AppShell";

describe("terminal task states are never running or successful", () => {
  it("maps blocked/failed/unverified outcomes over step-level status", () => {
    expect(taskCardState("executing", { outcome: "blocked" })).toBe("blocked");
    expect(taskCardState("planning", { outcome: "failed" })).toBe("failed");
    expect(taskCardState("completed", { outcome: "unverified" })).toBe("unverified");
    expect(taskCardState("completed", { outcome: "completed" })).toBe("completed");
  });

  it("never reports 0% progress for terminal tasks without step data", () => {
    expect(stepProgress([])).toBeNull();
  });

  it("labels terminal states distinctly from running", () => {
    for (const [status, label] of [["blocked", "Blocked"], ["failed", "Failed"], ["unverified", "Unverified"], ["cancelled", "Cancelled"]] as const) {
      expect(taskStateLabel(taskCardState(status, null))).toBe(label);
    }
    expect(taskStateLabel(taskCardState("executing", null))).toBe("Running");
  });

  it("marks terminal statuses as terminal", () => {
    for (const s of ["completed", "failed", "blocked", "cancelled", "interrupted"]) {
      expect(isTerminalTaskStatus(s)).toBe(true);
    }
    expect(isTerminalTaskStatus("executing")).toBe(false);
  });
});

describe("monitor truthfulness", () => {
  it("shows approval-required state for tasks waiting on approval", () => {
    expect(monitorHeaderFor({ status: "awaiting_approval" })).toEqual({
      mode: "waiting",
      text: "Waiting for approval",
    });
  });

  it("never describes terminal tasks as currently working", () => {
    for (const s of ["blocked", "failed", "completed", "cancelled", "unverified"]) {
      expect(monitorHeaderFor({ status: s }).mode).toBe("idle");
    }
    expect(monitorHeaderFor({ status: "executing" }).mode).toBe("working");
    expect(monitorHeaderFor(null).mode).toBe("idle");
  });

  it("reports honest progress only when step data exists", () => {
    expect(stepProgress([{ status: "verified" }, { status: "queued" }])).toEqual({ done: 1, total: 2, pct: 50 });
  });

  it("never presents failed or blocked steps as in progress", () => {
    expect(stepTone("failed")).toBe("failed");
    expect(stepTone("blocked")).toBe("blocked");
    expect(stepTone("cancelled")).toBe("cancelled");
    expect(stepTone("executing")).toBe("now");
    expect(stepTone("verified")).toBe("done");
  });
});

describe("warden labels follow confirmed backend state", () => {
  const confirmed = { status: "confirmed" as const, gatewayAlwaysOn: true, mode: "autonomous" };

  it("shows standby with activate control when the theme is off", () => {
    const d = wardenDisplay(false, confirmed);
    expect(d.pill).toBe("ACTIVATE WARDEN");
    expect(d.panelTitle).toBe("WARDEN STANDBY");
  });

  it("shows active only when the backend confirms enforcement", () => {
    expect(wardenDisplay(true, confirmed).pill).toBe("WARDEN ACTIVE");
    expect(wardenDisplay(true, { status: "pending" }).pill).toBe("WARDEN CHECKING");
    const d = wardenDisplay(true, { status: "unknown", error: "offline" });
    expect(d.pill).toBe("WARDEN UNCONFIRMED");
    expect(d.panelSub).toContain("independent");
  });

  it("disables toggling while confirmation is pending", () => {
    expect(wardenDisplay(true, { status: "pending" }).toggleDisabled).toBe(true);
  });

  it("never plays the transition when motion is reduced or interrupted", () => {
    expect(shouldPlayActivation({ reduceMotion: false, playFullActivation: true, prefersReducedMotion: false })).toBe(true);
    expect(shouldPlayActivation({ reduceMotion: true, playFullActivation: true, prefersReducedMotion: false })).toBe(false);
    expect(shouldPlayActivation({ reduceMotion: false, playFullActivation: true, prefersReducedMotion: true })).toBe(false);
    expect(shouldPlayActivation({ reduceMotion: false, playFullActivation: false, prefersReducedMotion: false })).toBe(false);
  });
});

describe("navigation has one canonical location per destination", () => {
  it("mobile nav is a documented subset of the sidebar destinations", () => {
    const sidebar = new Set(SIDEBAR_LINKS.map((l) => l.href));
    for (const link of MOBILE_NAV_LINKS) {
      expect(sidebar.has(link.href)).toBe(true);
    }
  });
});

describe("completed receipts preserve the real verification outcome", () => {
  it("drops repeated sentences but keeps distinct verification results", () => {
    const out = dedupeOutcomeBlocks({
      summary: "Warden denied shell.exec in autonomous mode.",
      verification: null,
      error: "Warden denied \"shell.exec\" (command) in autonomous mode.",
      outcome: "blocked — Outcome: blocked after 3 cycles.",
    });
    expect(out.summary).not.toBeNull();
    expect(out.error).toBeNull();
    expect(out.outcome).not.toBeNull();
  });

  it("keeps a failing verification distinct from a passing-looking summary", () => {
    const out = dedupeOutcomeBlocks({
      summary: "Create note completed.",
      verification: "did not pass — file missing",
      error: null,
      outcome: "failed — acceptance not satisfied",
    });
    expect(out.verification).toContain("did not pass");
    expect(out.outcome).toContain("failed");
  });
});

describe("stale active tasks never present as working or waiting", () => {
  it("flags a quiet executing record as stale", async () => {
    const m = await import("@/lib/task-display");
    const now = Date.now();
    const old = new Date(now - 60 * 60 * 1000).toISOString();
    expect(m.isStaleActiveTask({ status: "executing", updatedAt: old }, now)).toBe(true);
    expect(m.isStaleActiveTask({ status: "completed", updatedAt: old }, now)).toBe(false);
    const fresh = new Date(now - 60 * 1000).toISOString();
    expect(m.isStaleActiveTask({ status: "executing", updatedAt: fresh }, now)).toBe(false);
  });

  it("renders stale records as up-to-date instead of working", async () => {
    const m = await import("@/lib/task-display");
    expect(m.monitorHeaderFor({ status: "executing" }, { stale: true })).toEqual({
      mode: "idle",
      text: "Up to date",
    });
  });

  it("asks for review when approval state has no pending record", async () => {
    const m = await import("@/lib/task-display");
    expect(
      m.monitorHeaderFor({ status: "awaiting_approval" }, { hasPendingApproval: false })
    ).toEqual({ mode: "waiting", text: "Approval needs review" });
    expect(m.monitorHeaderFor({ status: "awaiting_approval" })).toEqual({
      mode: "waiting",
      text: "Waiting for approval",
    });
  });
});
