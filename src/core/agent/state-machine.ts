import type { TaskStatus } from "./types";

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  received: ["planning", "queued", "failed", "cancelled"],
  queued: ["claimed", "planning", "executing", "cancelled", "failed"],
  claimed: ["planning", "executing", "cancelled", "failed", "interrupted"],
  planning: ["executing", "awaiting_approval", "blocked", "failed", "cancelled", "interrupted"],
  awaiting_approval: ["executing", "blocked", "failed", "cancelled", "interrupted"],
  executing: ["verifying", "awaiting_approval", "blocked", "failed", "cancelled", "interrupted"],
  verifying: ["completed", "failed", "executing", "cancelled", "interrupted"],
  interrupted: ["queued", "planning", "executing", "failed", "cancelled"],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (from === to) return from;
  if (!canTransition(from, to)) {
    throw new Error(`Illegal task transition ${from} → ${to}`);
  }
  return to;
}

export function isTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "cancelled";
}
