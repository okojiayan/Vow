/** Local workload runner: real orchestrator + trace, isolated storage, no live services. */
import { isolatedEnv } from "../../helpers";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import type { Scenario } from "./manifest.v1";

export interface TaskEvidence {
  taskId: string;
  status: string;
  ms: number;
  summary: string;
  inferenceMode: string;
  toolCalls: Array<{ tool: string; ok: boolean }>;
  verification: string | null;
  traceKinds: string[];
  error: string | null;
}

export async function runTaskScenario(s: Scenario): Promise<TaskEvidence> {
  await isolatedEnv();
  const t0 = Date.now();
  const { task } = await startAndRun(s.request);
  const ms = Date.now() - t0;
  let toolCalls: TaskEvidence["toolCalls"] = [];
  let traceKinds: string[] = [];
  try {
    const trace = await getTrace(task.id);
    const entries = (trace as { entries?: Array<{ tool?: string; ok?: boolean; kind: string }> }).entries ?? [];
    traceKinds = entries.map((e) => e.kind);
    toolCalls = entries.filter((e) => e.tool).map((e) => ({ tool: e.tool as string, ok: e.ok !== false }));
  } catch { /* trace best-effort */ }
  return {
    taskId: task.id, status: task.status, ms,
    summary: `${task.resultSummary ?? ""} ${task.error ?? ""}`.trim(),
    inferenceMode: (task as { inferenceMode?: string }).inferenceMode ?? "unknown",
    toolCalls, verification: task.verification ? task.verification.explanation ?? JSON.stringify(task.verification).slice(0,200) : null, traceKinds, error: task.error ?? null,
  };
}

export function checkExpectation(s: Scenario, text: string, status: string): string | null {
  if (!s.expectStatus.includes(status as never)) return `status ${status} not in [${s.expectStatus.join(",")}]`;
  for (const n of s.mustContain ?? []) {
    if (!text.toLowerCase().includes(n.toLowerCase())) return `missing required text: ${n}`;
  }
  for (const b of s.mustNotContain ?? []) {
    if (text.toLowerCase().includes(b.toLowerCase())) return `banned text present: ${b}`;
  }
  return null;
}
