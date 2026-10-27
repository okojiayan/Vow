import { undoReceipt } from "@/core/execution/reversals";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.receiptId) return Response.json({ error: "receiptId required" }, { status: 400 });
    return Response.json(await undoReceipt(body.receiptId));
  } catch (e) {
    return Response.json({ ok: false, reason: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
