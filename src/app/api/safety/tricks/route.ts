import { collectSecurityEvents, listPinned, pinTrick } from "@/core/safety/tricks";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ events: await collectSecurityEvents(), pinned: await listPinned() });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.auditId) return Response.json({ error: "auditId required" }, { status: 400 });
    return Response.json({ pinned: await pinTrick(body.auditId, body.taskId, body.note) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
