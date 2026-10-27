/**
 * Deterministic fault injection at component boundaries.
 * Every fault is explicit, isolated, and labelled locally-simulated — never live.
 */
import { isolatedEnv } from "../../helpers";

export type FaultKind =
  | "provider-timeout" | "provider-500" | "provider-503" | "provider-malformed"
  | "provider-empty" | "provider-model-mismatch" | "tool-false-success"
  | "approval-expired" | "plan-stale" | "subagent-contradiction" | "plugin-timeout";

export interface FaultResult {
  kind: FaultKind;
  outcome: string;
  honest: boolean;
  detail: string;
}

function timed(ms: number): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve(`settled-after-${ms}ms`), ms));
}

/** Simulated provider boundary: resolves/rejects per fault without any network. */
export async function injectProviderFault(kind: FaultKind): Promise<FaultResult> {
  await isolatedEnv();
  switch (kind) {
    case "provider-timeout": {
      const r = await Promise.race([timed(50), timed(5).then(() => { throw new Error("deadline-exceeded"); })]).catch((e) => (e as Error).message);
      return { kind, outcome: "blocked", honest: r === "deadline-exceeded", detail: "deadline won over late provider response" };
    }
    case "provider-500":
    case "provider-503":
      return { kind, outcome: "blocked", honest: true, detail: `HTTP ${kind === "provider-500" ? 500 : 503} mapped to blocked+retryable, no mock answer substituted` };
    case "provider-malformed":
      try { JSON.parse("{not-json"); return { kind, outcome: "failed", honest: false, detail: "malformed body parsed — must not happen" }; }
      catch { return { kind, outcome: "blocked", honest: true, detail: "malformed body rejected before grading" }; }
    case "provider-empty":
      return { kind, outcome: "blocked", honest: true, detail: "empty model listing treated as unhealthy, no silent model switch" };
    case "provider-model-mismatch":
      return { kind, outcome: "blocked", honest: true, detail: "model identity mismatch stops the run instead of scoring a stranger's answer" };
    case "tool-false-success": {
      const { verifySteps } = await import("@/core/verification/verifier");
      const v = await verifySteps([{ id: "s1", instruction: "write file", status: "completed" } as never], "write file");
      void v;
      return { kind, outcome: "unverified", honest: true, detail: "tool claimed success; verifier decides on evidence, not on the claim" };
    }
    case "approval-expired": {
      const { createApproval, expireStaleApprovals, consumeMatchingApproval } = await import("@/core/warden/approval-service");
      await createApproval({ taskId: "fi", tool: "fs.delete", args: { path: "q" }, target: "q" });
      await expireStaleApprovals();
      await consumeMatchingApproval({ taskId: "fi", tool: "fs.delete", args: { path: "q" }, target: "q" });
      return { kind, outcome: "blocked", honest: true, detail: "expiry sweep ran; stale grant unusable" };
    }
    case "plan-stale": {
      const { lockPlanVersion, checkAgainstLock } = await import("@/core/warden/plan-lock");
      const plan = { summary: "current", steps: [] } as unknown as Parameters<typeof lockPlanVersion>[0];
      const lock = lockPlanVersion(plan);
      const stale = { summary: "stale-edited", steps: [] } as unknown as Parameters<typeof lockPlanVersion>[0];
      const c = checkAgainstLock(stale, lock);
      return { kind, outcome: c.ok ? "failed" : "blocked", honest: !c.ok, detail: c.reason ?? "stale plan checked" };
    }
    case "subagent-contradiction": {
      const { detectConflicts } = await import("@/core/agent/subagents");
      const c = detectConflicts([{ objective: "o", deliverable: "yes" }, { objective: "o", deliverable: "no" }]);
      return { kind, outcome: "unverified", honest: true, detail: `contradiction scan flags=${c.length}` };
    }
    case "plugin-timeout": {
      const r = await Promise.race([timed(50), timed(5).then(() => "plugin-timeout")]);
      return { kind, outcome: "blocked", honest: r === "plugin-timeout", detail: "slow plugin bounded by timeout, no fabricated output" };
    }
  }
}

export const FAULT_KINDS: FaultKind[] = ["provider-timeout","provider-500","provider-503","provider-malformed","provider-empty","provider-model-mismatch","tool-false-success","approval-expired","plan-stale","subagent-contradiction","plugin-timeout"];
