import { listAudit } from "@/core/warden/audit";

export const dynamic = "force-dynamic";

/** Read-only: recent Warden audit events (policy decisions with reasons). */
export async function GET(request: Request) {
  const limit = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 50), 1),
    500,
  );
  const events = await listAudit(limit);
  return Response.json({ events });
}
