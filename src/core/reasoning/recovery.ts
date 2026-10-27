import type { TaskStateGraph, Subgoal } from "./task-graph";
import { markSubgoal } from "./task-graph";
import type { EffortBudget } from "./effort";
import { budgetExhausted } from "./effort";

export type FailureKind = "tool_error" | "denied" | "verification_failed" | "timeout" | "unknown";
export type Outcome = "completed" | "blocked" | "failed" | "partial" | "unverified";

export const MAX_SUBGOAL_RETRIES = 2;
export const MAX_REPLANS = 3;

export function classifyFailure(error: string): FailureKind {
  const t = error.toLowerCase();
  if (/denied|not permitted|policy|approval/.test(t)) return "denied";
  if (/timeout|timed out|deadline/.test(t)) return "timeout";
  if (/verif/.test(t)) return "verification_failed";
  if (/failed|error|exception/.test(t)) return "tool_error";
  return "unknown";
}

export interface RecoveryDecision { action: "retry" | "replan" | "escalate" | "stop"; reason: string; }

export function decideRecovery(opts: { subgoal: Subgoal; kind: FailureKind; replans: number; budget: EffortBudget; sameSignatureFailures?: number }): RecoveryDecision {
  if (opts.kind === "denied") return { action: "escalate", reason: `Policy denial on "${opts.subgoal.title}"; needs user authorization.` };
  if ((opts.sameSignatureFailures ?? 0) >= 2) {
    return { action: "stop", reason: `Same vetted action failed ${1 + (opts.sameSignatureFailures ?? 0)} times with an identical signature on "${opts.subgoal.title}"; further retries are pointless. Report unresolved.` };
  }
  if (budgetExhausted(opts.budget)) return { action: "stop", reason: "Budget exhausted; stop retrying." };
  if (opts.subgoal.attempts < MAX_SUBGOAL_RETRIES && opts.kind !== "verification_failed") return { action: "retry", reason: `Retry ${opts.subgoal.attempts + 1}/${MAX_SUBGOAL_RETRIES} for "${opts.subgoal.title}".` };
  if (opts.replans < MAX_REPLANS) return { action: "replan", reason: `Replan affected subgoal "${opts.subgoal.title}".` };
  return { action: "escalate", reason: `Repeated failure on "${opts.subgoal.title}"; escalate to user.` };
}

/** Replan re-queues the SAME vetted plan action (same stepId, same tool, same
 *  args). It never invents alternative actions or arguments: anything executed
 *  still passes through executeTool → Warden authorization per attempt. */
export function applyReplan(graph: TaskStateGraph, subgoalId: string, alternativeTitle: string): TaskStateGraph {
  const sg = graph.subgoals.find((s) => s.id === subgoalId);
  if (!sg) return graph;
  const alt: Subgoal = { ...sg, id: `${sg.id}-r${sg.attempts}`, title: alternativeTitle, status: "pending", attempts: 0, dependsOn: [...sg.dependsOn] };
  const idx = graph.subgoals.findIndex((s) => s.id === subgoalId);
  const subgoals = [...graph.subgoals];
  subgoals.splice(idx + 1, 0, alt);
  const skipped = subgoals.map((s) => (s.id === subgoalId ? { ...s, status: "skipped" as const } : s));
  return { ...graph, subgoals: skipped, updatedAt: new Date().toISOString() };
}

export function finalOutcome(graph: TaskStateGraph, verificationPassed: boolean | null): Outcome {
  const acc = graph.acceptance;
  const allOk = acc.length > 0 && acc.every((a) => a.satisfied === true && a.evidenceIds.length > 0);
  const someOk = acc.some((a) => a.satisfied === true && a.evidenceIds.length > 0);
  if (allOk && verificationPassed === true) return "completed";
  if (graph.blockers.some((b) => !b.resolved) && !someOk) return "blocked";
  if (verificationPassed === false && !someOk) return "failed";
  if (someOk) return "partial";
  if (verificationPassed === null || verificationPassed === undefined) return "unverified";
  return "failed";
}

export { markSubgoal };
