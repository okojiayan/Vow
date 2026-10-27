import { getTask } from "@/core/agent/task-store";
import { recoverStaleTasks } from "@/core/agent/queue";
import { drainQueue } from "@/core/agent/worker";
import { checkTickAccess } from "@/core/agent/worker-guard";
import { getEnv } from "@/lib/env";
import { getTrace } from "@/core/traces/trace-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const access = checkTickAccess({
      authorizationHeader: request.headers.get("authorization"),
      workerToken: env.VOW_WORKER_TOKEN ?? "",
      rateLimitPerMinute: env.VOW_WORKER_TICK_PER_MINUTE ?? 20,
    });
    if (!access.authorized) {
      return Response.json({ error: access.reason }, { status: access.status });
    }
    let maxTasks = 5;
    let recover = false;
    try {
      const body = await request.json();
      if (typeof body?.maxTasks === "number") maxTasks = Math.max(1, Math.min(25, Math.floor(body.maxTasks)));
      if (body?.recover === true) recover = true;
    } catch {
      // Empty body is fine; use defaults.
    }
    if (recover) await recoverStaleTasks();
    const ids = await drainQueue(maxTasks);
    const tasks = [];
    for (const id of ids) {
      const task = await getTask(id);
      if (task) tasks.push(task);
    }
    const traces = [];
    for (const id of ids) {
      traces.push(await getTrace(id));
    }
    return Response.json({ processed: ids, tasks, traces });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const { listTasks } = await import("@/core/agent/task-store");
  const tasks = await listTasks();
  const summary = {
    queued: tasks.filter((t) => t.status === "queued").length,
    claimed: tasks.filter((t) => t.status === "claimed").length,
    executing: tasks.filter((t) => t.status === "executing").length,
    awaiting_approval: tasks.filter((t) => t.status === "awaiting_approval").length,
    interrupted: tasks.filter((t) => t.status === "interrupted").length,
    total: tasks.length,
  };
  return Response.json(summary);
}
