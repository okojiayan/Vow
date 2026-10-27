import { searchDictionary } from "@/core/memory/dictionary";
import { memorySearchSchema } from "@/lib/schemas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const extendedSchema = memorySearchSchema.extend({
  accountId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = extendedSchema.parse(await request.json());
    const records = await searchDictionary(body.query, body.limit ?? 12, body.accountId ?? "local");
    return Response.json({ records, query: body.query });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
