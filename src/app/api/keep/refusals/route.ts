import { listAudit } from "@/core/warden/audit";
export const dynamic = "force-dynamic";
export async function GET() {
  const audit = await listAudit(200);
  const refusals = audit.filter((a) => a.outcome === "blocked" || a.decision.includes("deny") || a.kind === "block");
  return Response.json({ refusals, count: refusals.length });
}
