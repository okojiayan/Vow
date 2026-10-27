import { appendReceipt, listReceipts } from "@/core/keep/receipts";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const task_id = new URL(req.url).searchParams.get("task_id") ?? undefined;
  return Response.json({ receipts: await listReceipts(task_id) });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const r = await appendReceipt({ task_id: body.task_id ?? "demo", action: body.action ?? "allow:read", target: body.target, result: body.result ?? "success", reversible: Boolean(body.reversible), undo_data: body.undo_data });
    return Response.json({ receipt: r });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
