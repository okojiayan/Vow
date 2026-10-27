import type { TaskStateGraph } from "./task-graph";
import { acceptanceSatisfied, readySubgoals } from "./task-graph";
import type { EffortBudget } from "./effort";
import { budgetExhausted } from "./effort";

export type Operation =
  | "retrieve_memory" | "investigate" | "plan" | "test_hypothesis"
  | "execute_tool" | "verify" | "delegate" | "ask_user"
  | "finish_complete" | "finish_blocked" | "finish_failed" | "finish_partial" | "finish_unverified";

export interface ControllerInput {
  graph: TaskStateGraph;
  budget: EffortBudget;
  needsApproval?: boolean;
  approvalDenied?: boolean;
  toolFailed?: boolean;
  verificationPassed?: boolean | null;
  hasEvidence?: boolean;
  userHelpAvailable?: boolean;
}

export function decideNext(input: ControllerInput): { op: Operation; reason: string; subgoalId?: string } {
  const { graph, budget } = input;
  if (input.approvalDenied) return { op: "finish_blocked", reason: "Approval denied; cannot proceed without authorization." };
  if (budgetExhausted(budget)) {
    return input.hasEvidence ? { op: "finish_partial", reason: "Effort/tool budget exhausted with partial evidence." } : { op: "finish_unverified", reason: "Budget exhausted before verification." };
  }
  const failed = graph.subgoals.filter((s) => s.status === "failed");
  if (failed.length > 0 && input.toolFailed) {
    const sg = failed[0];
    if (sg.attempts >= 2) return { op: "finish_failed", reason: `Subgoal "${sg.title}" failed after bounded retries.`, subgoalId: sg.id };
    return { op: "test_hypothesis", reason: `Retrying failed subgoal with adjusted approach.`, subgoalId: sg.id };
  }
  if (graph.blockers.some((b) => !b.resolved)) {
    return input.userHelpAvailable ? { op: "ask_user", reason: "Unresolved blocker requires user input." } : { op: "finish_blocked", reason: "Unresolved blocker with no user channel." };
  }
  if (input.needsApproval) return { op: "ask_user", reason: "Consequential action requires explicit authorization." };
  if (graph.subgoals.length === 0) return { op: "plan", reason: "No subgoals yet; decomposition required." };
  const ready = readySubgoals(graph);
  const readyTool = ready.find((s) => s.kind !== "analysis");
  if (readyTool) {
    return { op: "execute_tool", reason: `Next ready subgoal: ${readyTool.title}.`, subgoalId: readyTool.id };
  }
  const readyAnalysis = ready.find((s) => s.kind === "analysis");
  if (readyAnalysis) {
    return { op: "investigate", reason: `Analysis required for "${readyAnalysis.title}" over gathered tool evidence.`, subgoalId: readyAnalysis.id };
  }
  const running = graph.subgoals.some((s) => s.status === "running");
  if (running) return { op: "verify", reason: "Work executed; verification against acceptance conditions required." };
  const succeeded = graph.subgoals.some((s) => s.status === "succeeded");
  if (succeeded && (input.verificationPassed === null || input.verificationPassed === undefined)) {
    return { op: "verify", reason: "Tool evidence gathered; verification against acceptance conditions required." };
  }
  if (acceptanceSatisfied(graph)) return { op: "finish_complete", reason: "All acceptance conditions satisfied with evidence." };
  const pending = graph.subgoals.some((s) => s.status === "pending");
  if (pending) return { op: "investigate", reason: "Subgoals waiting on dependencies; gather evidence first." };
  if (input.verificationPassed === true) return { op: "finish_complete", reason: "Verification passed on executed evidence." };
  if (input.verificationPassed === false) return input.hasEvidence ? { op: "finish_partial", reason: "Verification failed but partial evidence exists." } : { op: "finish_failed", reason: "Verification failed without evidence." };
  return { op: "retrieve_memory", reason: "No ready work; consult memory for relevant context." };
}
