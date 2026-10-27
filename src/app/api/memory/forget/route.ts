import { forgetMemory } from "@/core/memory/time-machine";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body?.id) return Response.json({ error: "id required" }, { status: 400 });
    // Two-step semantics: the UI must first show what will be removed.
    if (!body?.confirm) {
      return Response.json({ preview: "Forget removes content, keywords, entities, links, excerpts, access metadata, and all version bodies from VOW-controlled stores. Audit keeps a content-free tombstone. Confirm with confirm:true to proceed." });
    }
    return Response.json(await forgetMemory(body.id, { by: body.by }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
