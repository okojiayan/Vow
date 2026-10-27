import { appendTrace } from "@/core/traces/trace-store";
import { getTask, saveTask } from "./task-store";
import { runTask } from "./orchestrator";
import { claimNextTask, recoverStaleTasks, workerId } from "./queue";

const GLOBAL_KEY = "__vowWorker";

interface WorkerState {
  workerId: string;
  running: boolean;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  recoverOnStart: boolean;
}

function globalState(): WorkerState {
  const g = globalThis as unknown as Record<string, WorkerState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { workerId: workerId("away"), running: false, intervalMs: 2000, timer: null, recoverOnStart: true };
  }
  return g[GLOBAL_KEY] as WorkerState;
}

/** Execute a single claim→run cycle. Returns the processed task id or null when idle. */
export async function tickWorker(id?: string): Promise<string | null> {
  const wid = id ?? globalState().workerId;
  const claimed = await claimNextTask(wid);
  if (!claimed) return null;
  // Move claimed -> planning eagerly so a crash between claim and runTask is recoverable as interrupted.
  const current = await getTask(claimed.id);
  if (!current) return claimed.id;
  if (current.cancelRequested) {
    const { cancelNow } = await import("./orchestrator");
    await cancelNow(current, current.cancelReason ?? "Cancelled before worker start.");
    return claimed.id;
  }
  try {
    await runTask(claimed.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await getTask(claimed.id);
    if (failed && failed.status !== "cancelled") {
      const now = new Date().toISOString();
      await saveTask({ ...failed, status: "interrupted", error: message, updatedAt: now });
      await appendTrace(claimed.id, {
        kind: "interrupted",
        title: "Worker error parked task",
        detail: message,
      });
    }
  }
  return claimed.id;
}

/** Drain the queue (used by tests and the tick API). Bounded to avoid infinite loops. */
export async function drainQueue(maxTasks = 10, id?: string): Promise<string[]> {
  const done: string[] = [];
  for (let i = 0; i < maxTasks; i++) {
    const next = await tickWorker(id);
    if (!next) break;
    done.push(next);
  }
  return done;
}

export async function startWorker(intervalMs = 2000): Promise<string> {
  const state = globalState();
  state.intervalMs = intervalMs;
  if (state.recoverOnStart) {
    state.recoverOnStart = false;
    try {
      await recoverStaleTasks();
    } catch {
      // Recovery is best-effort at startup.
    }
  }
  if (state.running) return state.workerId;
  state.running = true;
  state.timer = setInterval(() => {
    void tickWorker().catch(() => undefined);
  }, state.intervalMs);
  // Don't keep the process alive just for the poller in tests/CI.
  const t = state.timer as unknown as { unref?: () => void };
  if (typeof t.unref === "function") t.unref();
  return state.workerId;
}

export function stopWorker(): void {
  const state = globalState();
  state.running = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.recoverOnStart = true;
}

export function isWorkerRunning(): boolean {
  return globalState().running;
}
