import { appendTrace } from "@/core/traces/trace-store";
import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile } from "@/lib/persistence";
import { createTask, cancelNow } from "./orchestrator";
import { getTask, saveTask } from "./task-store";
import { canTransition } from "./state-machine";
import type { AgentTask } from "./types";
import type { OperatingMode } from "@/core/warden/types";

const TASKS = () => dataPath("tasks.json");

function normalize(task: Partial<AgentTask>): AgentTask {
  return Object.assign({
    autonomyMode: null,
    queuedAt: null,
    claimedAt: null,
    claimedBy: null,
    cancelRequested: false,
    cancelReason: null,
    attempts: 0,
    parentTaskId: null,
    allowedTools: null,
    lastHeartbeat: null,
    ...task});
}

export async function enqueueTask(
  request: string,
  conversationId?: string,
  autonomyMode: OperatingMode = "autonomous",
  effortCeiling?: unknown,
): Promise<{ task: AgentTask; conversationId: string }> {
  const created = await createTask(request, conversationId, effortCeiling);
  const now = new Date().toISOString();
  let task: AgentTask = {
    ...normalize(created.task),
    autonomyMode,
    status: "received",
    queuedAt: now,
  };
  // received -> queued is the durable-queue entry point.
  const { transition } = await import("./state-machine");
  try {
    task = { ...task, status: transition(task.status, "queued"), updatedAt: now };
  } catch {
    task = { ...task, status: "queued", updatedAt: now };
  }
  await saveTask(task);
  await appendTrace(task.id, {
    kind: "task_queued",
    title: "Task queued for Away Mode",
    detail: `Accepted for background execution in ${autonomyMode} mode. Closing the browser will not cancel it, but the server must stay running.`,
    data: { autonomyMode, queuedAt: now },
  });
  return { task, conversationId: task.conversationId };
}

/** Atomically claim the oldest queued task. Returns null when the queue is empty. */
export async function claimNextTask(workerId: string): Promise<AgentTask | null> {
  let claimed: AgentTask | null = null;
  await mutateJsonFile<AgentTask[]>(TASKS(), [], (current) => {
    const normalized = current.map(normalize);
    // Oldest queued first (createdAt ascending). Interrupted tasks must be re-queued first via recoverStaleTasks.
    const candidate = normalized
      .filter((t) => t.status === "queued" && !t.cancelRequested)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!candidate) return normalized;
    const now = new Date().toISOString();
    const next: AgentTask = {
      ...candidate,
      status: canTransition(candidate.status, "claimed") ? "claimed" : candidate.status,
      claimedAt: now,
      claimedBy: workerId,
      attempts: (candidate.attempts ?? 0) + 1,
      lastHeartbeat: now,
      updatedAt: now,
    };
    if (next.status !== "claimed") return normalized;
    claimed = next;
    return normalized.map((t) => (t.id === next.id ? next : t));
  });
  if (claimed) {
    const c = claimed as AgentTask;
    await appendTrace(c.id, {
      kind: "task_claimed",
      title: `Worker ${workerId} claimed task`,
      detail: `Attempt ${c.attempts}. Exclusive lease prevents duplicate execution.`,
      data: { workerId, attempt: c.attempts },
    });
  }
  return claimed;
}

export async function requestCancellation(taskId: string, reason?: string): Promise<AgentTask> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task");
  const normalized = normalize(task);
  const msg = reason?.trim() || "Cancelled by user.";
  if (["completed", "failed", "blocked", "cancelled"].includes(normalized.status)) {
    return normalized;
  }
  const flagged: AgentTask = {
    ...normalized,
    cancelRequested: true,
    cancelReason: msg,
    updatedAt: new Date().toISOString(),
  };
  await saveTask(flagged);
  await appendTrace(taskId, {
    kind: "cancellation_requested",
    title: "Cancellation requested",
    detail: msg,
  });
  // If the task is not actively executing a tool, finalize immediately so
  // retries never start it and paused tasks do not linger as awaiting approval.
  // Tasks mid-execution (executing/verifying/planning/claimed) are only flagged;
  // the orchestrator checks cancelRequested before each step and finalizes there,
  // which is the only safe point without aborting in-flight tool calls.
  if (
    flagged.status === "queued" ||
    flagged.status === "received" ||
    flagged.status === "awaiting_approval" ||
    flagged.status === "interrupted"
  ) {
    return cancelNow(flagged, msg);
  }
  return flagged;
}

/**
 * On startup, conservatively mark tasks that were mid-execution as interrupted.
 * Awaiting-approval tasks are safely paused and left alone. Verified plan steps
 * are skipped on resume; side-effecting steps revalidate authority and surface
 * ambiguity instead of blindly repeating.
 */
export async function recoverStaleTasks(): Promise<AgentTask[]> {
  const recovered: AgentTask[] = [];
  await mutateJsonFile<AgentTask[]>(TASKS(), [], (current) => {
    const now = new Date().toISOString();
    return current.map((raw) => {
      const t = normalize(raw);
      if (t.status === "executing" || t.status === "claimed" || t.status === "planning" || t.status === "verifying") {
        if (t.cancelRequested) return t;
        const next: AgentTask = {
          ...t,
          status: canTransition(t.status, "interrupted") ? "interrupted" : t.status,
          claimedBy: null,
          lastHeartbeat: now,
          updatedAt: now,
        };
        recovered.push(next);
        return next;
      }
      return t;
    });
  });
  for (const t of recovered) {
    await appendTrace(t.id, {
      kind: "interrupted",
      title: "Interrupted task recovered",
      detail:
        "The worker stopped while this task was mid-execution. It is safely parked as interrupted. Resume revalidates Warden authority and skips verified steps; uncertain side effects are not blindly duplicated.",
    });
  }
  return recovered;
}

export async function requeueInterrupted(taskId: string): Promise<AgentTask> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task");
  const t = normalize(task);
  if (t.status !== "interrupted") throw new Error(`Task ${taskId} is ${t.status}, not interrupted.`);
  if (t.cancelRequested) throw new Error("Task was cancelled and will not resume.");
  const now = new Date().toISOString();
  const next: AgentTask = {
    ...t,
    status: "queued",
    queuedAt: now,
    claimedAt: null,
    claimedBy: null,
    updatedAt: now,
  };
  await saveTask(next);
  await appendTrace(taskId, {
    kind: "task_queued",
    title: "Interrupted task re-queued",
    detail: "Operator re-queued an interrupted task. Warden authority will be revalidated on resume.",
  });
  return next;
}

export function workerId(prefix = "worker"): string {
  return `${prefix}-${createId("w").slice(0, 8)}`;
}
