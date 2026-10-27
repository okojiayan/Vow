import { resolveEntry } from "@/core/memory/dictionary-store";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  surface: z.string().trim().min(1).max(200),
  type: z.string().optional(),
  accountId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const result = await resolveEntry(body.surface, { accountId: body.accountId ?? "local", type: body.type });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
