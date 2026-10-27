import { cancelCooling, listCooling } from "@/core/warden/cooling";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") ?? undefined;
  return Response.json({ cooling: await listCooling(taskId) });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.id) return Response.json({ error: "id required" }, { status: 400 });
    const rec = await cancelCooling(body.id);
    if (!rec) return Response.json({ error: "Unknown cooling record." }, { status: 404 });
    return Response.json({ cooling: rec });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
