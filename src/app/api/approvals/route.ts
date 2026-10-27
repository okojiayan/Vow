import { continueTask, rejectTask } from "@/core/agent/orchestrator";
import { decideApproval, listApprovals } from "@/core/warden/approval-service";
import { recordAudit } from "@/core/warden/audit";
import { approvalDecisionSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const approvals = await listApprovals();
  return Response.json({ approvals });
}

export async function POST(request: Request) {
  try {
    const body = approvalDecisionSchema.parse(await request.json());
    const grant = await decideApproval(body.approvalId, body.decision, body.note);
    await recordAudit({
      kind: "approval",
      taskId: grant.taskId,
      tool: grant.tool,
      decision: grant.status,
      policy: "approval.user",
      reason: body.note ?? `Human ${body.decision}d exact action ${grant.tool}.`,
      outcome: grant.status === "approved" ? "pending" : "blocked",
      fingerprint: grant.actionFingerprint,
    });
    let task = null;
    if (grant.status === "approved") {
      task = await continueTask(grant.taskId);
    } else if (grant.status === "denied") {
      task = await rejectTask(grant.taskId, "Human denied the exact action. Warden will not execute it.");
    }
    return Response.json({ approval: grant, task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
