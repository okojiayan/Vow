import { createTaskPass, getTaskPass } from "@/core/keep/task-pass";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pass = await createTaskPass({
      mode: body.mode ?? "warden",
      grantPaths: body.grantPaths ?? ["demo/sandbox"],
      allowed_actions: body.allowed_actions,
      network: body.network ?? false,
    });
    return Response.json({ pass });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("task_id") ?? "";
  if (!id) return Response.json({ error: "task_id required" }, { status: 400 });
  const pass = await getTaskPass(id);
  if (!pass) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ pass });
}
