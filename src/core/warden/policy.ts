import type { OperatingMode, PolicyDecision, PolicyEffect, RiskClass, ToolPermission } from "./types";
import { fingerprintAction } from "./approval-service";
import { validateReadOnlyZetarisSql } from "@/integrations/zetaris/sql-policy";

export const TOOL_PERMISSIONS: ToolPermission[] = [
  { tool: "fs.list", risk: "read", defaultEffect: "allow" },
  { tool: "fs.read", risk: "read", defaultEffect: "allow" },
  {
    tool: "fs.write",
    risk: "write",
    defaultEffect: "require_approval",
    assistedEffect: "require_approval",
    autonomousEffect: "allow",
  },
  {
    tool: "notes.create",
    risk: "write",
    defaultEffect: "require_approval",
    assistedEffect: "require_approval",
    autonomousEffect: "allow",
  },
  { tool: "memory.search", risk: "read", defaultEffect: "allow" },
  {
    tool: "memory.store",
    risk: "write",
    defaultEffect: "allow",
    assistedEffect: "allow",
    autonomousEffect: "allow",
  },
  { tool: "calc.evaluate", risk: "read", defaultEffect: "allow" },
  { tool: "run_sql", risk: "read", defaultEffect: "allow" },
  {
    tool: "subagent.spawn",
    risk: "write",
    defaultEffect: "require_approval",
    assistedEffect: "require_approval",
    autonomousEffect: "allow",
  },
  {
    tool: "skill.invoke",
    risk: "write",
    defaultEffect: "require_approval",
    assistedEffect: "require_approval",
    autonomousEffect: "allow",
  },
  {
    tool: "http.fetch",
    risk: "network",
    defaultEffect: "deny",
    assistedEffect: "deny",
    autonomousEffect: "require_approval",
  },
  {
    tool: "shell.exec",
    risk: "command",
    defaultEffect: "deny",
    assistedEffect: "deny",
    autonomousEffect: "deny",
  },
  {
    tool: "fs.delete",
    risk: "destructive",
    defaultEffect: "deny",
    assistedEffect: "deny",
    autonomousEffect: "require_approval",
  },
];

export function getToolPermission(tool: string): ToolPermission | undefined {
  return TOOL_PERMISSIONS.find((item) => item.tool === tool);
}

/**
 * Register a permission for a namespaced plugin tool ("plugin.<id>.<tool>").
 * Same source of truth as the static list above — never a parallel policy.
 * Rejects duplicates and non-plugin names so plugins can never silently
 * replace trusted tool permissions. Plugin tools always require approval by
 * default; read-only plugins are allowed in autonomous mode only.
 */
export function registerToolPermission(permission: ToolPermission): ToolPermission {
  if (!permission.tool.startsWith("plugin.")) {
    throw new Error(`Refusing non-plugin permission "${permission.tool}".`);
  }
  const existing = getToolPermission(permission.tool);
  if (existing) {
    const same =
      existing.risk === permission.risk &&
      existing.defaultEffect === permission.defaultEffect &&
      existing.assistedEffect === permission.assistedEffect &&
      existing.autonomousEffect === permission.autonomousEffect;
    if (!same) throw new Error(`Permission collision for "${permission.tool}".`);
    return existing;
  }
  const entry: ToolPermission = {
    tool: permission.tool,
    risk: permission.risk,
    defaultEffect: "require_approval",
    assistedEffect: "require_approval",
    autonomousEffect: permission.risk === "read" ? "allow" : "require_approval",
  };
  TOOL_PERMISSIONS.push(entry);
  return entry;
}

export function effectForMode(permission: ToolPermission, mode: OperatingMode): PolicyEffect {
  if (mode === "autonomous" && permission.autonomousEffect) return permission.autonomousEffect;
  if (mode === "assisted" && permission.assistedEffect) return permission.assistedEffect;
  return permission.defaultEffect;
}

export function classifyRisk(tool: string): RiskClass {
  return getToolPermission(tool)?.risk ?? "command";
}

export function evaluatePolicy(input: {
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  mode: OperatingMode;
  hasMatchingApproval: boolean;
}): PolicyDecision {
  const decidedAt = new Date().toISOString();
  const fingerprint = fingerprintAction(input.tool, input.args, input.target);
  const permission = getToolPermission(input.tool);

  if (!permission) {
    return {
      requestId: input.requestId,
      effect: "deny",
      allowed: false,
      reason: `Default-deny: tool "${input.tool}" is not in the allowlist.`,
      policy: "default-deny.unknown-tool",
      risk: "command",
      actionFingerprint: fingerprint,
      decidedAt,
    };
  }

  if (input.tool === "run_sql") {
    const validation = validateReadOnlyZetarisSql(input.args.sql);
    if (!validation.ok) {
      return {
        requestId: input.requestId,
        effect: "deny",
        allowed: false,
        reason: validation.reason,
        policy: "deny.zetaris.read-only",
        risk: permission.risk,
        actionFingerprint: fingerprint,
        decidedAt,
      };
    }
  }

  const effect = effectForMode(permission, input.mode);
  if (effect === "deny") {
    return {
      requestId: input.requestId,
      effect,
      allowed: false,
      reason: `Warden denied "${input.tool}" (${permission.risk}) in ${input.mode} mode.`,
      policy: `deny.${permission.risk}.${input.mode}`,
      risk: permission.risk,
      actionFingerprint: fingerprint,
      decidedAt,
    };
  }

  if (effect === "require_approval" && !input.hasMatchingApproval) {
    return {
      requestId: input.requestId,
      effect,
      allowed: false,
      reason: `Action-specific approval is required for "${input.tool}" before execution.`,
      policy: `approval.${permission.risk}.${input.mode}`,
      risk: permission.risk,
      actionFingerprint: fingerprint,
      decidedAt,
    };
  }

  return {
    requestId: input.requestId,
    effect: "allow",
    allowed: true,
    reason:
      effect === "require_approval"
        ? `Approved exact action "${input.tool}" may proceed.`
        : `Pre-authorized "${input.tool}" in ${input.mode} mode still passed the Warden gateway.`,
    policy: `allow.${permission.risk}.${input.mode}`,
    risk: permission.risk,
    actionFingerprint: fingerprint,
    decidedAt,
  };
}
