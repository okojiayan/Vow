import { history, revertToVersion } from "@/core/memory/time-machine";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    return Response.json(await history(url.searchParams.get("id") ?? ""));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.id || typeof body?.version !== "number") return Response.json({ error: "id and version required" }, { status: 400 });
    // Confirmation gate: reverting (especially forced) needs an explicit flag.
    if (!body?.confirm) return Response.json({ error: "Revert requires explicit confirm:true." }, { status: 400 });
    return Response.json(await revertToVersion(body.id, body.version, { force: body.force, reason: body.reason }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
