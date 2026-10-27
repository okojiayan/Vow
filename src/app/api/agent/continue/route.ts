import { continueTask } from "@/core/agent/orchestrator";
import { getConversation } from "@/core/agent/task-store";
import { getTrace } from "@/core/traces/trace-store";
import { continueTaskSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = continueTaskSchema.parse(await request.json());
    const task = await continueTask(body.taskId);
    const conversation = await getConversation(task.conversationId);
    const trace = await getTrace(task.id);
    return Response.json({ task, conversation, trace });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
