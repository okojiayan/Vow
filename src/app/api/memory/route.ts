import { dictionarySnapshot } from "@/core/memory/dictionary";
import { submitCandidate } from "@/core/memory/lifecycle";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId") ?? "local";
  const records = await dictionarySnapshot(accountId);
  return Response.json({ records });
}

const createSchema = z.object({
  content: z.string().min(1).max(8000),
  kind: z.string().optional(),
  entities: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  conversationId: z.string().optional(),
  projectId: z.string().optional(),
  scope: z.enum(["account", "project", "conversation", "task"]).optional(),
  scopeId: z.string().optional(),
  accountId: z.string().optional(),
  idempotencyKey: z.string().max(200).optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  explicit: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const outcome = await submitCandidate({
      ...body,
      source: { type: "user", ref: "memory-explorer" },
      provenance: "user:memory-explorer",
      explicit: body.explicit ?? true,
    });
    if (!outcome.stored) {
      return Response.json({ error: outcome.message, reason: outcome.reason }, { status: 400 });
    }
    return Response.json({ record: outcome.record, deduped: outcome.deduped });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
