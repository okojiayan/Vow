import { activeRules, confirmRule, deactivateRule, findConflicts, listRules, proposeRule, stageRule } from "@/core/warden/house-rules";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ rules: await listRules() });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body?.op === "confirm") return Response.json({ rule: await confirmRule(body.id) });
    if (body?.op === "deactivate") return Response.json({ rule: await deactivateRule(body.id) });
    if (typeof body?.text !== "string") return Response.json({ error: "text required" }, { status: 400 });
    const proposal = proposeRule(body.text);
    if (!proposal.supported || !proposal.rule) return Response.json({ proposal });
    const conflicts = await findConflicts(proposal.rule);
    const staged = await stageRule(proposal.rule);
    // Hard-denied categories take effect only after explicit confirmation.
    return Response.json({ proposal: { ...proposal, conflicts: conflicts.map((c) => c.id) }, staged });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
