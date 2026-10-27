import { startAndRun } from "@/core/agent/orchestrator";
import { listTasks } from "@/core/agent/task-store";
import { getTrace } from "@/core/traces/trace-store";
import { runTaskSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const tasks = await listTasks();
  return Response.json({ tasks });
}

export async function POST(request: Request) {
  try {
    const body = runTaskSchema.parse(await request.json());
    const { task, conversation } = await startAndRun(body.message, body.conversationId, { effortCeiling: body.effortLevel });
    const trace = await getTrace(task.id);
    return Response.json({ task, conversation, trace });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
