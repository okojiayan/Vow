import { undoAction, undoTask } from "@/core/keep/receipts";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.task_id && !body.action_id) return Response.json(await undoTask(body.task_id));
    const res = await undoAction(body.action_id, body.currentContent);
    return Response.json(res);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
