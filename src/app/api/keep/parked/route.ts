import { decideParked, listParked, parkAction } from "@/core/keep/task-pass";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const task_id = new URL(req.url).searchParams.get("task_id") ?? undefined;
  return Response.json({ parked: await listParked(task_id) });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.op === "decide") return Response.json({ item: await decideParked(body.id, Boolean(body.approve)) });
    const item = await parkAction({ task_id: body.task_id ?? "demo", action: body.action ?? "pay", target: body.target, consequence: body.consequence ?? "This would move money and cannot be undone automatically." });
    return Response.json({ parked: item });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
