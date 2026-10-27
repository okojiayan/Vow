import { listEntries, upsertEntry } from "@/core/memory/dictionary-store";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "local";
  return Response.json({ entries: await listEntries(accountId) });
}

const schema = z.object({
  id: z.string().optional(),
  type: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().max(200)).max(30).optional(),
  description: z.string().max(2000).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  status: z.enum(["current", "historical", "disputed", "unverified", "archived"]).optional(),
  provenance: z.string().min(1).max(300),
  accountId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const entry = await upsertEntry(body);
    return Response.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
