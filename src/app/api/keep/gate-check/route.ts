import { checkGate } from "@/core/keep/gate";
import { getTaskPass } from "@/core/keep/task-pass";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pass = await getTaskPass(body.task_id);
    if (!pass) return Response.json({ error: "pass not found" }, { status: 404 });
    const verdict = await checkGate({ tool: body.tool, target: body.target, args: body.args }, pass);
    return Response.json({ verdict, mode: pass.mode });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
