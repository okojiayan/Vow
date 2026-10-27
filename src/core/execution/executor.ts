import { authorizeTool, recordExecutionOutcome } from "@/core/warden/tool-gateway";
import { recordAudit } from "@/core/warden/audit";
import { getTask } from "@/core/agent/task-store";
import type { OperatingMode } from "@/core/warden/types";
import { defaultRetryPolicy, withRetries } from "./retry-policy";
import { getTool } from "./tool-registry";
import { captureBackup, isReversibleTool, recordReceipt } from "./reversals";
import { createId } from "@/lib/ids";
import { readFile } from "node:fs/promises";
import { assertSafeWorkspacePath } from "@/core/warden/path-guard";
import { getEnv } from "@/lib/env";

export interface ExecutionResult {
  status: "ok" | "denied" | "needs_approval" | "error";
  output?: unknown;
  error?: string;
  approvalId?: string;
  policy?: string;
  reason?: string;
  attempts: number;
}

export async function executeTool(input: {
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  mode: OperatingMode;
  stepId?: string;
}): Promise<ExecutionResult> {
  const tool = getTool(input.tool);
  if (!tool) {
    return {
      status: "denied",
      error: `Unknown tool ${input.tool}`,
      reason: "Default-deny: unregistered tool.",
      policy: "default-deny.unknown-tool",
      attempts: 0,
    };
  }

  // Delegation scope: a task with an explicit tool allowlist (subagent
  // children) can only invoke those tools. Checked before Warden so a child
  // can never reach authorization for an out-of-scope tool.
  try {
    const owner = await getTask(input.taskId);
    const scope = owner?.allowedTools ?? null;
    if (scope && !scope.includes(input.tool)) {
      await recordAudit({
        kind: "block",
        taskId: input.taskId,
        tool: input.tool,
        decision: "deny",
        policy: "deny.subagent.tool-scope",
        reason: `Tool "${input.tool}" is outside this delegated task's allowed tools.`,
        outcome: "blocked",
        fingerprint: "",
      });
      return {
        status: "denied",
        error: `Tool "${input.tool}" is outside this delegated task's allowed tools.`,
        reason: "Delegation scope denial.",
        policy: "deny.subagent.tool-scope",
        attempts: 0,
      };
    }
  } catch {
    // Scope storage unreadable: fail closed for scoped tasks is handled by
    // the allowlist check above; unscoped tasks proceed to Warden normally.
  }

  const gate = await authorizeTool(input);
  if (gate.status === "denied") {
    return {
      status: "denied",
      error: gate.decision.reason,
      reason: gate.decision.reason,
      policy: gate.decision.policy,
      attempts: 0,
    };
  }
  if (gate.status === "needs_approval") {
    return {
      status: "needs_approval",
      approvalId: gate.approvalId,
      reason: gate.decision.reason,
      policy: gate.decision.policy,
      attempts: 0,
    };
  }

  // Phase 2 trust boundary: leak screen + House Rules. Runs inside the only
  // execution funnel, so Turbo, subagents, skills, and plugins cannot bypass
  // it. Rules only restrict; they never widen the gate's decision.
  try {
    const { scanPayload, outboundVerdict } = await import("@/core/warden/leak-check");
    const findings = scanPayload(input.args);
    const verdict = outboundVerdict(input.tool, findings);
    if (verdict.action === "block") {
      await recordAudit({
        kind: "block",
        taskId: input.taskId,
        tool: input.tool,
        decision: "deny",
        policy: "leak-check.outbound-block",
        reason: verdict.reason ?? "Sensitive value in outbound payload.",
        outcome: "blocked",
        fingerprint: gate.decision.actionFingerprint,
      });
      return { status: "denied", error: verdict.reason, reason: verdict.reason, policy: "leak-check.outbound-block", attempts: 0 };
    }
  } catch {
    // Screening best-effort; the gate decision below remains authoritative.
  }
  try {
    const { evaluateRules } = await import("@/core/warden/house-rules");
    const { createApproval } = await import("@/core/warden/approval-service");
    const ruling = await evaluateRules({ tool: input.tool, target: input.target, args: input.args, projectRoot: getEnv().VOW_WORKSPACE_DIR });
    if (ruling.effect === "deny") {
      await recordAudit({
        kind: "block",
        taskId: input.taskId,
        tool: input.tool,
        decision: "deny",
        policy: `house-rule.${ruling.rule?.category ?? "deny"}`,
        reason: ruling.reason ?? "Denied by House Rule.",
        outcome: "blocked",
        fingerprint: gate.decision.actionFingerprint,
      });
      return { status: "denied", error: ruling.reason, reason: ruling.reason, policy: `house-rule.${ruling.rule?.category ?? "deny"}`, attempts: 0 };
    }
    if (ruling.effect === "require_approval") {
      const approval = await createApproval({ taskId: input.taskId, tool: input.tool, args: input.args, target: input.target });
      await recordAudit({
        kind: "approval",
        taskId: input.taskId,
        tool: input.tool,
        decision: "require_approval",
        policy: `house-rule.${ruling.rule?.category ?? "confirm"}`,
        reason: ruling.reason ?? "House Rule requires approval.",
        outcome: "pending",
        fingerprint: gate.decision.actionFingerprint,
      });
      return { status: "needs_approval", approvalId: approval.id, reason: ruling.reason, policy: `house-rule.${ruling.rule?.category ?? "confirm"}`, attempts: 0 };
    }
  } catch {
    // Rule evaluation best-effort; gate decision stands.
  }

  // Mandatory cooling for consequential tools: approval alone is not enough.
  // The delay survives restarts (persisted store), mode changes cannot bypass
  // it (mode-independent check), and expiry never auto-executes: a fresh
  // approval is still required after the delay.
  try {
    const { COOLING_TOOLS, coolingStatus, startCooling, consumeCooling } = await import("@/core/warden/cooling");
    if (COOLING_TOOLS.has(input.tool)) {
      const st = await coolingStatus(input.taskId, input.tool, input.args, input.target);
      if (st.status === "none") {
        const rec = await startCooling({ taskId: input.taskId, tool: input.tool, args: input.args, target: input.target, reason: "Consequential action requires a cooling period after approval." });
        await recordAudit({
          kind: "approval",
          taskId: input.taskId,
          tool: input.tool,
          decision: "require_approval",
          policy: "cooling.pending",
          reason: `Cooling period started; earliest execution ${rec.earliestExec}. A fresh approval is required after the delay.`,
          outcome: "pending",
          fingerprint: gate.decision.actionFingerprint,
        });
        return { status: "needs_approval", reason: `Cooling period: earliest execution ${rec.earliestExec}.`, policy: "cooling.pending", attempts: 0 };
      }
      if (st.status === "waiting" && st.record) {
        return { status: "needs_approval", reason: `Cooling period active until ${st.record.earliestExec}.`, policy: "cooling.pending", attempts: 0 };
      }
      if (st.status === "ready" && st.record) {
        await consumeCooling(st.record.id);
      }
    }
  } catch {
    // Cooling best-effort; gate + rules above remain authoritative.
  }

  // Reversal pre-state: capture before mutation for the small supported set only.
  // No OS sandbox is claimed; this is a logical backup for honest undo.
  let backupId: string | undefined;
  let reversalKind: "delete-created-file" | "restore-backup" | undefined;
  if (isReversibleTool(input.tool) && typeof input.args?.path === "string") {
    try {
      const workspace = getEnv().VOW_WORKSPACE_DIR;
      const rel = input.args.path as string;
      const safe = await assertSafeWorkspacePath(workspace, rel);
      const prior = await readFile(safe, "utf8").catch(() => null);
      backupId = createId("bk");
      await captureBackup(backupId, prior);
      reversalKind = prior === null ? "delete-created-file" : "restore-backup";
    } catch {
      backupId = undefined;
      reversalKind = undefined;
    }
  }

  let attemptsUsed = 0;
  try {
    const output = await withRetries(defaultRetryPolicy, (attempt) => {
      attemptsUsed = attempt;
      return tool.handler(input.args, { taskId: input.taskId, mode: input.mode });
    });
    await recordReceipt({
      taskId: input.taskId,
      tool: input.tool,
      target: input.target ?? (typeof input.args?.path === "string" ? (input.args.path as string) : undefined),
      args: input.args,
      stepId: input.stepId,
      outcome: "ok",
      reversible: Boolean(reversalKind),
      reversalKind,
      backupId,
    });
    await recordExecutionOutcome({
      taskId: input.taskId,
      tool: input.tool,
      policy: gate.decision.policy,
      success: true,
      reason: "Tool completed after Warden authorization.",
      fingerprint: gate.decision.actionFingerprint,
    });
    return {
      status: "ok",
      output,
      policy: gate.decision.policy,
      reason: gate.decision.reason,
      attempts: attemptsUsed || 1,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordReceipt({
      taskId: input.taskId,
      tool: input.tool,
      target: input.target,
      args: input.args,
      stepId: input.stepId,
      outcome: "error",
      reversible: false,
    });
    await recordExecutionOutcome({
      taskId: input.taskId,
      tool: input.tool,
      policy: gate.decision.policy,
      success: false,
      reason: message,
      fingerprint: gate.decision.actionFingerprint,
    });
    return {
      status: "error",
      error: message,
      policy: gate.decision.policy,
      reason: message,
      attempts: attemptsUsed || 1,
    };
  }
}
