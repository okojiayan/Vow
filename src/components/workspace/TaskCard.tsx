"use client";

import { FolderOpen } from "lucide-react";
import { humanResult, humanTitle } from "@/lib/humanize";

interface PlanStep {
  id: string;
  title: string;
  instruction: string;
  status: string;
  requiresApproval: boolean;
  action?: { tool: string };
}

interface CardTask {
  id: string;
  request: string;
  status: string;
  inferenceMode: string;
  attempts: number;
  resultSummary: string | null;
  verification: { passed: boolean | null; explanation: string } | null;
  plan: { summary: string; steps: PlanStep[] } | null;
}

/** In-conversation status card: what VOW is doing, with a path to detail. */
export function TaskCard({
  task,
  onViewActivity,
  onCancel,
  active,
}: {
  task: CardTask;
  onViewActivity: () => void;
  onCancel: () => void;
  active: boolean;
}) {
  const done = task.plan?.steps.filter((s) => ["verified", "done", "completed"].includes(s.status)).length ?? 0;
  const total = task.plan?.steps.length ?? 0;
  const result = humanResult(task.resultSummary);
  const sub =
    total > 0
      ? `${done} of ${total} steps ${task.status === "completed" ? "complete" : "done"}${result ? ` · ${result}` : ""}`
      : (result ?? task.status.replace(/_/g, " "));
  return (
    <article className="flow-card" aria-label={`Task ${task.status.replace(/_/g, " ")}`}>
      <div className="flow-head">
        <span className="flow-icon" aria-hidden="true"><FolderOpen size={20} /></span>
        <div className="min-w-0">
          <p className="flow-title">{humanTitle(task.plan?.summary ?? null, task.request)}</p>
          <p className="flow-sub">{sub}</p>
        </div>
      </div>
      {total > 0 ? (
        <div className="mt-3">
          <div className="progress-track" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label="Task progress">
            <div className="progress-fill" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>
        </div>
      ) : null}
      <div className="flow-actions">
        <button type="button" onClick={onViewActivity} className="btn-ghost2" aria-haspopup="dialog">
          View activity
        </button>
        {active ? (
          <button type="button" onClick={onCancel} className="btn-ghost2 deny">
            Cancel task
          </button>
        ) : null}
      </div>
    </article>
  );
}
