import { explainBlocked } from "@/core/warden/task-label";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.taskId || !body?.tool) return Response.json({ error: "taskId and tool required" }, { status: 400 });
    // Replay is explanation-only: it reads the denial record and never
    // executes the blocked action.
    return Response.json({ replay: await explainBlocked(body.taskId, body.tool), executed: false });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
