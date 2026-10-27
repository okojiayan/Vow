import { correctMemory, deleteMemory, getMemory, setMemoryStatus } from "@/core/memory/store-ops";
import { z } from "zod";

export const dynamic = "force-dynamic";

function accountOf(request: Request): string {
  return new URL(request.url).searchParams.get("accountId") ?? "local";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await getMemory(id, accountOf(request));
  if (!record) return Response.json({ error: "Memory not found." }, { status: 404 });
  return Response.json({ record });
}

const patchSchema = z.object({
  content: z.string().min(1).max(8000).optional(),
  action: z.enum(["correct", "pin", "unpin", "archive", "dispute", "verify"]).optional(),
  accountId: z.string().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());
    const accountId = body.accountId ?? accountOf(request);
    if (body.action === "correct" || (!body.action && body.content)) {
      if (!body.content) return Response.json({ error: "content is required to correct a memory." }, { status: 400 });
      const record = await correctMemory(id, body.content.trim(), accountId, "user:correction");
      return Response.json({ record, superseded: true });
    }
    if (body.action === "pin") return Response.json({ record: await setMemoryStatus(id, "active", accountId, { pinned: true }) });
    if (body.action === "unpin") return Response.json({ record: await setMemoryStatus(id, "active", accountId, { pinned: false }) });
    if (body.action === "archive") return Response.json({ record: await setMemoryStatus(id, "archived", accountId) });
    if (body.action === "dispute")
      return Response.json({ record: await setMemoryStatus(id, "disputed", accountId, { verificationStatus: "disputed" }) });
    if (body.action === "verify")
      return Response.json({ record: await setMemoryStatus(id, "active", accountId, { verificationStatus: "verified" }) });
    return Response.json({ error: "Provide content to correct, or an action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const record = await deleteMemory(id, accountOf(request));
    return Response.json({ record, deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : 400;
    return Response.json({ error: message }, { status });
  }
}
