import { addRelation, relationsFrom } from "@/core/memory/dictionary-store";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entryId = url.searchParams.get("entryId");
  if (!entryId) return Response.json({ error: "entryId is required." }, { status: 400 });
  return Response.json({ relations: await relationsFrom(entryId, url.searchParams.get("accountId") ?? "local") });
}

const schema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  type: z.string().min(1).max(60),
  provenance: z.string().min(1).max(300),
  accountId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const relation = await addRelation(body);
    return Response.json({ relation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
