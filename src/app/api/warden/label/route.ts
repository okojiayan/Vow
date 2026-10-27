import { buildTaskLabel, notChecked } from "@/core/warden/task-label";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") ?? "";
  if (!taskId) return Response.json({ error: "taskId required" }, { status: 400 });
  try {
    const [label, unchecked] = await Promise.all([buildTaskLabel(taskId), notChecked(taskId)]);
    return Response.json({ label, notChecked: unchecked });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
