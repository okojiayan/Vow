import { deleteRecall, editRecall, exportRecall, recall, rememberExchange } from "@/core/keep/recall";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q) return Response.json(await recall(q, 3));
  return Response.json({ entries: await exportRecall() });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.op === "delete") {
      await deleteRecall(body.id);
      return Response.json({ ok: true });
    }
    if (body.op === "edit") {
      const entry = await editRecall(body.id, body.content);
      return Response.json({ ok: true, entry });
    }
    const res = await rememberExchange({
      chat_id: body.chat_id ?? "demo",
      turn_ref: body.turn_ref ?? "t1",
      content: body.content ?? "",
      source: body.source ?? "user",
      topic: body.topic,
      type: body.type,
      importance: body.importance,
    });
    if (!res.ok) return Response.json({ ok: false, reason: res.reason }, { status: 403 });
    return Response.json({ ok: true, entry: res.entry });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
