import { isKilled, killTask } from "@/core/keep/task-pass";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    await killTask(body.task_id);
    return Response.json({ ok: true, killed: body.task_id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
export async function GET(req: Request) {
  const task_id = new URL(req.url).searchParams.get("task_id") ?? "";
  return Response.json({ killed: await isKilled(task_id) });
}
