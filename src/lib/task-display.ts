/**
 * Single source of truth for deriving honest task/monitor/Warden display state
 * from authoritative lifecycle data. No component may hardcode status text,
 * progress, or mode labels for a specific task, percentage, or Warden string.
 */

export const ACTIVE_TASK_STATUSES = [
  "planning",
  "awaiting_approval",
  "executing",
  "verifying",
  "queued",
  "claimed",
  "received",
] as const;

export const TERMINAL_TASK_STATUSES = [
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "interrupted",
] as const;

export type TaskCardState =
  | "waiting_approval"
  | "running"
  | "verifying"
  | "completed"
  | "partial"
  | "failed"
  | "blocked"
  | "cancelled"
  | "unverified"
  | "idle";

export function isActiveTaskStatus(status: string): boolean {
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status.toLowerCase());
}

export function isTerminalTaskStatus(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status.toLowerCase());
}

/**
 * Authoritative card state: a structured terminal outcome always wins over a
 * step-level status, so a blocked/failed/unverified task can never present as
 * running or successful.
 */
export function taskCardState(
  status: string,
  outcome?: { outcome: string } | null,
): TaskCardState {
  const o = outcome?.outcome.toLowerCase();
  if (o === "completed") return "completed";
  if (o === "partial") return "partial";
  if (o === "failed") return "failed";
  if (o === "blocked") return "blocked";
  if (o === "cancelled") return "cancelled";
  if (o === "unverified") return "unverified";
  const s = status.toLowerCase();
  if (s === "unverified") return "unverified";
  if (s === "awaiting_approval") return "waiting_approval";
  if (s === "verifying") return "verifying";
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  if (s === "blocked") return "blocked";
  if (s === "cancelled" || s === "interrupted") return "cancelled";
  if (isActiveTaskStatus(s)) return "running";
  return "idle";
}

export function taskStateLabel(state: TaskCardState): string {
  switch (state) {
    case "waiting_approval": return "Waiting for approval";
    case "running": return "Running";
    case "verifying": return "Verifying";
    case "completed": return "Completed";
    case "partial": return "Partially completed";
    case "failed": return "Failed";
    case "blocked": return "Blocked";
    case "cancelled": return "Cancelled";
    case "unverified": return "Unverified";
    case "idle": return "Idle";
  }
}

/** A task counts as actively working only when it is not waiting or terminal. */
export function isWorkingState(state: TaskCardState): boolean {
  return state === "running" || state === "verifying";
}

export interface StepProgress { done: number; total: number; pct: number }

/**
 * Step progress, or null when no step data exists. Callers must render an
 * honest unavailable state instead of 0% when this returns null.
 */
export function stepProgress(steps: Array<{ status: string }>): StepProgress | null {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => stepTone(s.status) === "done").length;
  return { done, total: steps.length, pct: Math.round((done / steps.length) * 100) };
}

export type StepTone = "done" | "now" | "todo" | "failed" | "blocked" | "cancelled";

export interface StructuredOutcome { outcome: string; reason: string }

/**
 * Compose a structured terminal outcome for display without restating it.
 * Stored reasons sometimes repeat the outcome ("Outcome: blocked after 3
 * cycles."), and renderers prefix their own "Outcome:" label, so naive
 * composition yields "Outcome: blocked \u2014 Outcome: blocked after 3 cycles."
 * This strips those redundant prefixes (repeatedly, for doubly-prefixed
 * records) while preserving the genuine reason text. Display-only: the stored
 * record is never modified.
 */
export function formatOutcome(outcome: StructuredOutcome | null | undefined): string | null {
  if (!outcome) return null;
  const label = taskStateLabel(taskCardState("", outcome));
  let detail = (outcome.reason ?? "").trim();
  for (let i = 0; i < 3; i += 1) {
    const next = detail
      .replace(/^outcome:\s*/i, "")
      .replace(new RegExp(`^${outcome.outcome}\\s*[\u2014\u2013\\-:]+\\s*`, "i"), "")
      .trim();
    if (next === detail) break;
    detail = next;
  }
  if (!detail) return label;
  // When the reason already states the outcome ("blocked after 3 cycles."),
  // prefixing the label restates it ("Blocked \u2014 blocked after 3 cycles.").
  // Return the reason as a single sentence instead.
  if (new RegExp(`^${outcome.outcome}\\b`, "i").test(detail)) {
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  return `${label} \u2014 ${detail}`;
}

/**
 * Agent presence text derived from the authoritative card state. A blocked or
 * failed task must never report its agent as "Done".
 */
export function agentStatusText(cardState: TaskCardState | null, working: boolean): string {
  if (working) return "Working...";
  if (!cardState) return "Idle";
  switch (cardState) {
    case "waiting_approval": return "Waiting for approval";
    case "running": return "Working...";
    case "verifying": return "Verifying...";
    case "completed": return "Done";
    default: return taskStateLabel(cardState);
  }
}

/**
 * Honest per-step status text. A step parked on awaiting_approval is labelled
 * as waiting — never as generically "in progress" — so a task waiting on the
 * user cannot present any of its steps as actively executing.
 */
export function stepStatusText(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "awaiting_approval") return "Waiting approval";
  if (lower === "blocked") return "Blocked";
  if (lower === "queued" || lower === "pending") return "Queued";
  if (lower === "failed") return "Failed";
  if (lower === "skipped") return "Skipped";
  const tone = stepTone(status);
  if (tone === "done") return "Completed";
  if (tone === "now") return "In progress";
  if (tone === "failed") return "Failed";
  if (tone === "blocked") return "Blocked";
  if (tone === "cancelled") return "Cancelled";
  return "Queued";
}

/** Step tone: terminal step states are never presented as in-progress. */
export function stepTone(status: string): StepTone {
  const s = status.toLowerCase();
  if (["verified", "done", "completed"].includes(s)) return "done";
  if (["failed", "error"].includes(s)) return "failed";
  if (s === "blocked") return "blocked";
  if (["cancelled", "canceled", "interrupted"].includes(s)) return "cancelled";
  if (["running", "executing", "awaiting_approval", "in_progress"].includes(s)) return "now";
  return "todo";
}

export type MonitorHeader =
  | { mode: "working"; text: string }
  | { mode: "waiting"; text: string }
  | { mode: "idle"; text: string };

/** Monitor header derived from the authoritative card state, never step counts. */
export function monitorHeaderFor(
  task: { status: string; outcome?: { outcome: string } | null } | null,
  opts?: { stale?: boolean; hasPendingApproval?: boolean },
): MonitorHeader {
  if (!task) return { mode: "idle", text: "Up to date" };
  // A stale active task (no heartbeat for a long time) must never present as
  // currently working or waiting. Display-only: persisted status is untouched.
  if (opts?.stale) return { mode: "idle", text: "Up to date" };
  const state = taskCardState(task.status, task.outcome ?? null);
  if (state === "waiting_approval") {
    // Awaiting approval without a live pending approval record (expired,
    // consumed, or otherwise resolved) is not actionable waiting.
    if (opts?.hasPendingApproval === false) {
      return { mode: "waiting", text: "Approval needs review" };
    }
    return { mode: "waiting", text: "Waiting for approval" };
  }
  if (isWorkingState(state)) return { mode: "working", text: "VOW is working" };
  return { mode: "idle", text: "Up to date" };
}

/**
 * Staleness threshold for active tasks. An active-status task whose freshest
 * activity timestamp is older than this is displayed as stale, never as
 * currently running. Display-only: no persisted outcome is modified.
 */
export const STALE_ACTIVE_AFTER_MS = 10 * 60 * 1000;

export function freshestTaskTimestamp(task: {
  lastHeartbeat?: string | null;
  updatedAt?: string | null;
  queuedAt?: string | null;
}): number | null {
  const stamps = [task.lastHeartbeat, task.updatedAt, task.queuedAt]
    .map((s) => (s ? Date.parse(s) : NaN))
    .filter((n) => Number.isFinite(n));
  if (stamps.length === 0) return null;
  return Math.max(...stamps);
}

/** True when an active-status task has gone quiet past the staleness threshold. */
export function isStaleActiveTask(
  task: { status: string; lastHeartbeat?: string | null; updatedAt?: string | null; queuedAt?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!isActiveTaskStatus(task.status)) return false;
  const freshest = freshestTaskTimestamp(task);
  if (freshest === null) return false;
  return nowMs - freshest > STALE_ACTIVE_AFTER_MS;
}

export type WardenBackend =
  | { status: "confirmed"; gatewayAlwaysOn: boolean; mode: string | null }
  | { status: "pending" }
  | { status: "unknown"; error: string };

export interface WardenDisplay {
  pill: string;
  panelTitle: string;
  panelSub: string;
  toggleDisabled: boolean;
  toggleTitle: string;
}

/**
 * Warden labels derived from the actual theme + backend-confirmed policy state.
 * Enforcement never depends on this display: the gateway stays on regardless.
 */
export function wardenDisplay(themeWarden: boolean, backend: WardenBackend): WardenDisplay {
  if (!themeWarden) {
    const gatewayNote =
      backend.status === "confirmed"
        ? backend.gatewayAlwaysOn
          ? "Normal mode. Safety gateway stays on — consequential actions still need approval."
          : "Normal mode. Backend gateway state is unexpected — actions remain gated."
        : backend.status === "pending"
          ? "Normal mode. Confirming enforcement state — consequential actions still pause for approval."
          : "Normal mode. Backend state unconfirmed — consequential actions still pause for approval.";
    return {
      pill: "ACTIVATE WARDEN",
      panelTitle: "WARDEN STANDBY",
      panelSub: gatewayNote,
      toggleDisabled: backend.status === "pending",
      toggleTitle: "Click to activate Warden Mode",
    };
  }
  if (backend.status === "pending") {
    return {
      pill: "WARDEN CHECKING",
      panelTitle: "WARDEN CHECKING",
      panelSub: "Confirming enforcement state with the backend…",
      toggleDisabled: true,
      toggleTitle: "Confirming Warden state…",
    };
  }
  if (backend.status === "unknown") {
    return {
      pill: "WARDEN UNCONFIRMED",
      panelTitle: "WARDEN UNCONFIRMED",
      panelSub: `Backend state unavailable (${backend.error}). Policy enforcement is independent of this display.`,
      toggleDisabled: false,
      toggleTitle: "Warden state could not be confirmed. Click to return to Normal Mode.",
    };
  }
  return {
    pill: "WARDEN ACTIVE",
    panelTitle: "WARDEN ACTIVE",
    panelSub: backend.gatewayAlwaysOn
      ? "Strict enforcement is on. Every consequential action needs approval."
      : "Warden theme is on; backend gateway state is unexpected — actions remain gated.",
    toggleDisabled: false,
    toggleTitle: "Warden Protection is active. Click to return to Normal Mode.",
  };
}

/** Whether the celebratory Warden transition overlay may play at all. */
export function shouldPlayActivation(input: {
  reduceMotion: boolean;
  playFullActivation: boolean;
  prefersReducedMotion: boolean;
}): boolean {
  return !input.reduceMotion && !input.prefersReducedMotion && input.playFullActivation;
}

export interface OutcomeBlocks {
  summary: string | null;
  verification: string | null;
  error: string | null;
  outcome: string | null;
}

/**
 * Drop outcome blocks that merely repeat an already-shown block, keeping the
 * verification result distinct from the summary/error/final outcome.
 * Comparison is token-based so quoted or lightly reworded repeats are still
 * recognised without hardcoding any specific message.
 */
function outcomeTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
}

function repeatsOutcome(known: string[], candidate: string): boolean {
  const cand = outcomeTokens(candidate);
  if (cand.size === 0) return true;
  return known.some((k) => {
    const ks = outcomeTokens(k);
    if (ks.size === 0) return false;
    const [small, big] = ks.size <= cand.size ? [ks, cand] : [cand, ks];
    let overlap = 0;
    for (const t of small) if (big.has(t)) overlap += 1;
    return overlap / small.size >= 0.8;
  });
}

export function dedupeOutcomeBlocks(blocks: OutcomeBlocks): OutcomeBlocks {
  const seen: string[] = [];
  const keep = (text: string | null): string | null => {
    if (!text || !text.trim()) return null;
    if (repeatsOutcome(seen, text)) return null;
    seen.push(text);
    return text;
  };
  return {
    summary: keep(blocks.summary),
    verification: keep(blocks.verification),
    error: keep(blocks.error),
    outcome: keep(blocks.outcome),
  };
}
