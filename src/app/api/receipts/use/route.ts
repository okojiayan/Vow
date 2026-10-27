import { buildUseReceipt } from "@/core/warden/use-receipt";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") ?? "";
  if (!taskId) return Response.json({ error: "taskId required" }, { status: 400 });
  try {
    return Response.json({ receipt: await buildUseReceipt(taskId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
