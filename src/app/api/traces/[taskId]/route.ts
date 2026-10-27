import { getTrace, listTraces } from "@/core/traces/trace-store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  if (taskId === "all") {
    return Response.json({ traces: await listTraces() });
  }
  const trace = await getTrace(taskId);
  return Response.json({ trace });
}
