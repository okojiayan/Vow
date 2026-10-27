import { getTask } from "@/core/agent/task-store";
import { requeueInterrupted } from "@/core/agent/queue";
import { startWorker, tickWorker } from "@/core/agent/worker";
import { getTrace } from "@/core/traces/trace-store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const task = await requeueInterrupted(taskId);
    const full = await getTask(taskId);
    const trace = await getTrace(taskId);
    void startWorker().then(() => tickWorker().catch(() => undefined)).catch(() => undefined);
    return Response.json({ task: full ?? task, trace });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Unknown task") ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
