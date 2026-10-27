import { previewRewind, rewindSince } from "@/core/execution/reversals";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.taskId || !body?.since) return Response.json({ error: "taskId and since required" }, { status: 400 });
    if (!body?.confirm) return Response.json({ preview: await previewRewind(body.taskId, body.since) });
    return Response.json(await rewindSince(body.taskId, body.since));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
