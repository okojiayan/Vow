import { listMemories } from "@/core/memory/source-store";
import { readDictionary } from "@/core/memory/dictionary-store";
import { ownerOf } from "@/core/memory/store-ops";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "local";
  const memories = (await listMemories()).filter((r) => ownerOf(r) === accountId && (r.status ?? "active") !== "deleted");
  const dictionary = await readDictionary();
  return Response.json({
    exportedAt: new Date().toISOString(),
    accountId,
    memories,
    entries: dictionary.entries.filter((e) => e.accountId === accountId),
    relations: dictionary.relations.filter((r) => r.accountId === accountId),
  });
}
