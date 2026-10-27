import { listReceipts } from "@/core/execution/reversals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId") ?? undefined;
  return Response.json({ receipts: await listReceipts(taskId) });
}
