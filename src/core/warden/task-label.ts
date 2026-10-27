import { getTask } from "@/core/agent/task-store";
import { listReceipts, isReversibleTool } from "@/core/execution/reversals";
import { listAudit } from "./audit";

export interface TaskLabel {
  taskId: string;
  objective: string;
  status: string;
  reads: string[];
  writes: string[];
  network: string[];
  approvals: { required: number; granted: number };
  reversible: Array<{ tool: string; target?: string; supported: boolean }>;
  verificationPerformed: boolean;
  verificationPassed: boolean | null;
  plannedVsOccurred: { planned: number; occurred: number; unplanned: string[] };
  undoable: boolean;
}

export interface NotCheckedItem {
  item: string;
  reason: string;
}

const READ_TOOLS = new Set(["fs.list", "fs.read", "memory.search", "calc.evaluate", "run_sql"]);
const WRITE_TOOLS = new Set(["fs.write", "notes.create", "memory.store", "subagent.spawn", "skill.invoke"]);

export async function buildTaskLabel(taskId: string): Promise<TaskLabel> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task.");
  const receipts = await listReceipts(taskId);
  const occurred = receipts.filter((r) => r.outcome === "ok");
  const reads = [...new Set(occurred.filter((r) => READ_TOOLS.has(r.tool)).map((r) => r.tool))];
  const writes = [...new Set(occurred.filter((r) => WRITE_TOOLS.has(r.tool)).map((r) => r.tool))];
  const network = [...new Set(occurred.filter((r) => r.tool === "http.fetch").map((r) => r.target ?? "http.fetch"))];
  const plannedTools = (task.plan?.steps ?? []).filter((s) => s.action).map((s) => (s.action as { tool: string }).tool);
  const occurredTools = occurred.map((r) => r.tool);
  const unplanned = [...new Set(occurredTools.filter((t) => !plannedTools.includes(t)))];
  const approvalsRequired = (task.plan?.steps ?? []).filter((s) => s.requiresApproval).length;
  const audits = await listAudit(200);
  const granted = audits.filter((a) => a.taskId === taskId && a.kind === "approval" && (a.decision === "approved" || a.decision === "consumed")).length;
  const reversible = occurred.map((r) => ({ tool: r.tool, target: r.target, supported: r.reversible && isReversibleTool(r.tool) }));
  const undoable = occurred.length > 0 && occurred.every((r) => r.reversible && isReversibleTool(r.tool));
  return {
    taskId,
    objective: task.request,
    status: task.status,
    reads,
    writes,
    network,
    approvals: { required: approvalsRequired, granted },
    reversible,
    verificationPerformed: task.verification != null,
    verificationPassed: task.verification?.passed ?? null,
    plannedVsOccurred: { planned: plannedTools.length, occurred: occurredTools.length, unplanned },
    undoable,
  };
}

/** Non-vacuous by construction: every unverified gap is listed with its
 *  reason. Empty is valid only when verification actually ran and passed. */
export async function notChecked(taskId: string): Promise<NotCheckedItem[]> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task.");
  const items: NotCheckedItem[] = [];
  if (!task.verification) {
    items.push({ item: "Outcome verification", reason: task.status === "completed" ? "Task completed without a recorded verification pass — treat the result as unverified." : `No verification record; task is ${task.status}.` });
  } else if (task.verification.passed === false) {
    items.push({ item: "Acceptance criteria", reason: task.verification.explanation });
  }
  for (const step of task.plan?.steps ?? []) {
    if (step.status === "failed") items.push({ item: step.title, reason: step.error ?? "Step failed." });
    if (step.status === "blocked") items.push({ item: step.title, reason: step.error ?? "Blocked by Warden." });
    if (step.status === "running" || step.status === "pending") items.push({ item: step.title, reason: "Step never reached a terminal state in this run." });
  }
  const receipts = await listReceipts(taskId);
  for (const r of receipts) {
    if (r.outcome === "error") items.push({ item: `${r.tool} execution`, reason: "Tool reported an error; its effects are unverified." });
  }
  if (task.outcome && task.outcome.verificationPassed === false) {
    items.push({ item: "Structured outcome", reason: task.outcome.reason });
  }
  return items;
}

export interface BlockReplay {
  attempted: string;
  blockedBy: string;
  observedFacts: string[];
  hypothetical: string[];
  toPermit: string[];
}

export async function explainBlocked(taskId: string, tool: string): Promise<BlockReplay> {
  const audits = await listAudit(200);
  const events = audits.filter((a) => a.taskId === taskId && a.tool === tool && (a.outcome === "blocked" || a.decision === "deny" || a.decision === "require_approval"));
  if (events.length === 0) throw new Error(`No blocked or approval-gated record for ${tool} on this task. Replay explains real denials only.`);
  const latest = events[0];
  const task = await getTask(taskId);
  const scopeEvidence = task?.plan ? `Plan holds ${(task.plan.steps ?? []).length} step(s); locked version ${task.planLock?.version ?? "none"}.` : "No plan recorded.";
  return {
    attempted: `${tool}${latest.fingerprint ? "" : ""} was requested and not executed.`,
    blockedBy: `${latest.policy}: ${latest.reason}`,
    observedFacts: [
      `Decision recorded at ${latest.createdAt} with outcome ${latest.outcome ?? latest.decision}.`,
      scopeEvidence,
      "The action did not execute: no tool handler ran for this attempt.",
    ],
    hypothetical: [
      "Had it executed, file/network effects would have depended on live state that was never read — this part is hypothetical, not observed.",
      "No precise blast radius is claimed: the evidence needed to quantify it was never collected.",
    ],
    toPermit: [
      "Obtain the required approval for the exact action, or narrow the scope to an allowed target.",
      "If policy blocks the category outright (e.g. destructive tools), no approval path exists by design.",
    ],
  };
}
