import { getConversation } from "@/core/agent/task-store";
import { enqueueTask } from "@/core/agent/queue";
import { startWorker, tickWorker } from "@/core/agent/worker";
import { getTrace } from "@/core/traces/trace-store";
import { enqueueTaskSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = enqueueTaskSchema.parse(await request.json());
    const { task, conversationId } = await enqueueTask(
      body.message,
      body.conversationId,
      body.autonomyMode ?? "autonomous",
      body.effortLevel,
    );
    const conversation = await getConversation(conversationId);
    const trace = await getTrace(task.id);
    // Best-effort background progress without holding the request open.
    // The HTTP response returns immediately with queued state; the worker
    // claims the job independently so closing the tab does not cancel it.
    void startWorker().then(() => tickWorker().catch(() => undefined)).catch(() => undefined);
    return Response.json({ task, conversation, trace, queued: true }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
