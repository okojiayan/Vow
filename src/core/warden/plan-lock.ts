import { createHash } from "node:crypto";
import type { AgentPlan, PlannedAction } from "@/core/agent/types";
import { fingerprintAction } from "./approval-service";

export interface PlanLock {
  version: string;
  approvedAt: string;
  fingerprints: string[];
}

function canonicalPlan(plan: AgentPlan): string {
  return JSON.stringify({
    summary: plan.summary,
    steps: plan.steps.map((s) => ({ tool: s.action?.tool ?? null, args: s.action?.args ?? {}, target: s.action?.target ?? null })),
  });
}

export function lockPlanVersion(plan: AgentPlan): PlanLock {
  const version = createHash("sha256").update(canonicalPlan(plan)).digest("hex").slice(0, 16);
  const fingerprints = plan.steps.filter((s) => s.action).map((s) => fingerprintAction((s.action as PlannedAction).tool, (s.action as PlannedAction).args, (s.action as PlannedAction).target));
  return { version, approvedAt: new Date().toISOString(), fingerprints };
}

export function checkAgainstLock(plan: AgentPlan, lock: PlanLock): { ok: boolean; reason?: string } {
  const current = lockPlanVersion(plan);
  if (current.version === lock.version) return { ok: true };
  // Allow identical action sets with reordered summaries? No: any version
  // change widens scope until revalidated. Report precisely.
  const added = current.fingerprints.filter((f) => !lock.fingerprints.includes(f));
  if (added.length > 0) return { ok: false, reason: `Plan changed: ${added.length} new action(s) require revalidation before execution.` };
  return { ok: false, reason: `Plan changed (version ${lock.version} → ${current.version}); revalidation required.` };
}
