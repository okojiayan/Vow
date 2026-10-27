import { listMemories } from "@/core/memory/source-store";
import { isVisible, ownerOf } from "@/core/memory/store-ops";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId") ?? "local";
  const all = await listMemories();
  const conflicts = all.filter(
    (r) => ownerOf(r) === accountId && isVisible(r, true) && r.conflictStatus === "open",
  );
  return Response.json({ conflicts });
}
