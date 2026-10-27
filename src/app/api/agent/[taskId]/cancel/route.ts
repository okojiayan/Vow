import { getTask } from "@/core/agent/task-store";
import { requestCancellation } from "@/core/agent/queue";
import { getTrace } from "@/core/traces/trace-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    let reason: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.reason === "string") reason = body.reason;
    } catch {
      reason = undefined;
    }
    const task = await requestCancellation(taskId, reason);
    const full = await getTask(taskId);
    const trace = await getTrace(taskId);
    return Response.json({ task: full ?? task, trace });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Unknown task") ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
