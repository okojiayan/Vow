import { createId } from "@/lib/ids";
import { consumeMatchingApproval, createApproval, findUsableApproval } from "./approval-service";
import { recordAudit } from "./audit";
import { evaluatePolicy } from "./policy";
import type { ActionRequest, OperatingMode, PolicyDecision } from "./types";

export type GatewayOutcome =
  | { status: "allowed"; decision: PolicyDecision; request: ActionRequest }
  | { status: "needs_approval"; decision: PolicyDecision; request: ActionRequest; approvalId: string }
  | { status: "denied"; decision: PolicyDecision; request: ActionRequest };

export async function authorizeTool(input: {
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  mode: OperatingMode;
}): Promise<GatewayOutcome> {
  const request: ActionRequest = {
    id: createId("act"),
    taskId: input.taskId,
    tool: input.tool,
    args: input.args,
    target: input.target,
    requestedAt: new Date().toISOString(),
  };

  const existing = await findUsableApproval({
    tool: input.tool,
    args: input.args,
    target: input.target,
    taskId: input.taskId,
  });

  const decision = evaluatePolicy({
    requestId: request.id,
    tool: input.tool,
    args: input.args,
    target: input.target,
    mode: input.mode,
    hasMatchingApproval: Boolean(existing),
  });

  if (decision.effect === "deny") {
    await recordAudit({
      kind: "block",
      taskId: input.taskId,
      tool: input.tool,
      decision: "deny",
      policy: decision.policy,
      reason: decision.reason,
      outcome: "blocked",
      fingerprint: decision.actionFingerprint,
    });
    return { status: "denied", decision, request };
  }

  if (decision.effect === "require_approval" && !existing) {
    const approval = await createApproval({
      taskId: input.taskId,
      tool: input.tool,
      args: input.args,
      target: input.target,
    });
    decision.approvalId = approval.id;
    await recordAudit({
      kind: "approval",
      taskId: input.taskId,
      tool: input.tool,
      decision: "require_approval",
      policy: decision.policy,
      reason: decision.reason,
      outcome: "pending",
      fingerprint: decision.actionFingerprint,
    });
    return { status: "needs_approval", decision, request, approvalId: approval.id };
  }

  if (existing) {
    const consumed = await consumeMatchingApproval({
      tool: input.tool,
      args: input.args,
      target: input.target,
      taskId: input.taskId,
    });
    if (!consumed) {
      const retry = evaluatePolicy({
        requestId: request.id,
        tool: input.tool,
        args: input.args,
        target: input.target,
        mode: input.mode,
        hasMatchingApproval: false,
      });
      await recordAudit({
        kind: "block",
        taskId: input.taskId,
        tool: input.tool,
        decision: "deny",
        policy: "approval.replay-or-mismatch",
        reason: "Approval could not be consumed. Replay and modified actions are rejected.",
        outcome: "blocked",
        fingerprint: decision.actionFingerprint,
      });
      return { status: "denied", decision: { ...retry, reason: "Approval replay or argument mismatch." }, request };
    }
  }

  await recordAudit({
    kind: "policy",
    taskId: input.taskId,
    tool: input.tool,
    decision: "allow",
    policy: decision.policy,
    reason: decision.reason,
    outcome: "pending",
    fingerprint: decision.actionFingerprint,
  });
  return { status: "allowed", decision, request };
}

export async function recordExecutionOutcome(input: {
  taskId: string;
  tool: string;
  policy: string;
  success: boolean;
  reason: string;
  fingerprint?: string;
}) {
  await recordAudit({
    kind: "execution",
    taskId: input.taskId,
    tool: input.tool,
    decision: input.success ? "allow" : "allow",
    policy: input.policy,
    reason: input.reason,
    outcome: input.success ? "success" : "failure",
    fingerprint: input.fingerprint,
  });
}
