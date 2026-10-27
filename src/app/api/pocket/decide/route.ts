import { consumePocketToken } from "@/core/remote/pocket";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { token?: string; decision?: "approve" | "deny"; planVersion?: string; approver?: string };
    if (!body.token || !body.decision || !body.planVersion) {
      return Response.json({ error: "token, decision, and planVersion are required." }, { status: 400 });
    }
    const out = await consumePocketToken({
      raw: body.token,
      decision: body.decision,
      planVersion: body.planVersion,
      approver: (body.approver ?? "pocket-local").slice(0, 120),
    });
    if (!out.ok) return Response.json({ error: out.reason }, { status: 400 });
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
