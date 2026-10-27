import { getTask } from "@/core/agent/task-store";
import { listReceipts } from "@/core/execution/reversals";
import { listApprovals } from "./approval-service";
import { listAudit } from "./audit";
import { notChecked } from "./task-label";

export interface AiUseReceipt {
  taskId: string;
  objective: string;
  outcome: string;
  contributions: { model: string[]; deterministic: string[]; heuristic: string[] };
  toolsInvoked: string[];
  verification: { performed: boolean; passed: boolean | null; explanation: string };
  userApprovedChanges: string[];
  limitations: string[];
  disclaimer: string;
}

export async function buildUseReceipt(taskId: string): Promise<AiUseReceipt> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task.");
  const receipts = await listReceipts(taskId);
  const toolsInvoked = [...new Set(receipts.filter((r) => r.outcome === "ok").map((r) => r.tool))];
  const approvals = (await listApprovals()).filter((a) => a.taskId === taskId && (a.status === "approved" || a.status === "consumed"));
  const gaps = await notChecked(taskId);
  const mode = task.reasoningRoute;
  const contributions = {
    model: mode && !mode.deterministic && task.inferenceMode === "live-model" ? [`Provider-backed analysis (${task.inferenceMode})`] : [],
    deterministic: mode?.deterministic || task.inferenceMode === "deterministic" ? ["Deterministic computation (no model inference for the result)"] : [],
    heuristic: task.inferenceMode === "heuristic-demo" ? ["Heuristic demo plan (local fallback, not provider inference)"] : [],
  };
  return {
    taskId,
    objective: task.request,
    outcome: task.status,
    contributions,
    toolsInvoked,
    verification: {
      performed: task.verification != null,
      passed: task.verification?.passed ?? null,
      explanation: task.verification?.explanation ?? "No verification record.",
    },
    userApprovedChanges: approvals.map((a) => `${a.tool}${a.target ? ` → ${a.target}` : ""}`),
    limitations: gaps.map((g) => `${g.item}: ${g.reason}`),
    disclaimer: "This receipt documents VOW's participation in the task. It does not prove independent authorship or academic integrity.",
  };
}

export async function refusalLedger(taskId?: string, limit = 50) {
  const audits = await listAudit(200);
  return audits
    .filter((a) => (!taskId || a.taskId === taskId) && (a.outcome === "blocked" || a.kind === "block"))
    .slice(0, limit);
}
