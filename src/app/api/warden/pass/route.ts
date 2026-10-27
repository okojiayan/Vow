import { getTask } from "@/core/agent/task-store";
import { blastRadiusForPass, buildTaskPass } from "@/core/warden/task-pass";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("taskId") ?? "";
  if (!id) return Response.json({ error: "taskId required" }, { status: 400 });
  const task = await getTask(id);
  if (!task?.plan) return Response.json({ error: "Task has no plan yet." }, { status: 409 });
  const pass = buildTaskPass(task, task.plan);
  const blast = blastRadiusForPass(pass);
  return Response.json({ pass, blast, planLock: task.planLock ?? null });
}
