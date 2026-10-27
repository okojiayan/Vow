import { getConversation, getTask } from "@/core/agent/task-store";
import { getTrace } from "@/core/traces/trace-store";
import { buildEvidenceReceipt } from "@/core/verification/evidence-receipt";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const task = await getTask(taskId);
  if (!task) return Response.json({ error: "Unknown task" }, { status: 404 });
  const trace = await getTrace(taskId);
  const conversation = await getConversation(task.conversationId).catch(() => undefined);
  // Source-backed evidence receipt from the same records. Best-effort: a
  // receipt failure must never break the existing task-result pathway.
  const receipt = await buildEvidenceReceipt(taskId).catch(() => null);
  return Response.json({ task, trace, conversation, receipt });
}
