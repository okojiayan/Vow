export type OperatingMode = "supervised" | "assisted" | "autonomous";

export type RiskClass = "read" | "write" | "destructive" | "network" | "command";

export type PolicyEffect = "allow" | "deny" | "require_approval";

export interface ToolPermission {
  tool: string;
  risk: RiskClass;
  defaultEffect: PolicyEffect;
  autonomousEffect?: PolicyEffect;
  assistedEffect?: PolicyEffect;
}

export interface ActionRequest {
  id: string;
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  requestedAt: string;
}

export interface PolicyDecision {
  requestId: string;
  effect: PolicyEffect;
  allowed: boolean;
  reason: string;
  policy: string;
  risk: RiskClass;
  actionFingerprint: string;
  approvalId?: string;
  decidedAt: string;
}

export interface ApprovalGrant {
  id: string;
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  actionFingerprint: string;
  status: "pending" | "approved" | "denied" | "consumed" | "expired" | "cancelled";
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  consumedAt?: string;
  note?: string;
}

export interface AuditEvent {
  id: string;
  kind: "policy" | "approval" | "execution" | "block";
  taskId?: string;
  tool?: string;
  decision: string;
  policy: string;
  reason: string;
  outcome?: "success" | "failure" | "blocked" | "pending";
  fingerprint?: string;
  createdAt: string;
}
