import { blastRadius, getTaskPass } from "@/core/keep/task-pass";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pass = await getTaskPass(url.searchParams.get("task_id") ?? "");
  if (!pass) return Response.json({ error: "pass not found" }, { status: 404 });
  const total = Number(url.searchParams.get("total") ?? 120);
  return Response.json({ blast: blastRadius(pass, total), mode: pass.mode, turbo: pass.mode === "turbo" ? 100 : undefined });
}
