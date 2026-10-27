import { buildContextBundle } from "@/core/memory/context";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  query: z.string().trim().min(1).max(2000),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  conversationId: z.string().optional(),
  taskId: z.string().optional(),
  limit: z.number().int().min(1).max(25).optional(),
  budgetChars: z.number().int().min(500).max(20000).optional(),
  includeHistory: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const bundle = await buildContextBundle(body);
    return Response.json({ bundle, query: body.query });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
