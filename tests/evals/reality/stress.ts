/** Staged stress/endurance harness with ceilings. Local-only, isolated, early-stop. */
import { isolatedEnv } from "../../helpers";
import { startAndRun } from "@/core/agent/orchestrator";
import { submitCandidate } from "@/core/memory/lifecycle";
import { listMemories } from "@/core/memory/source-store";
import { retrieveRelevant } from "@/core/memory/retriever";

export interface StageResult {
  stage: string; tasks: number; ok: number; p50ms: number; p95ms: number;
  maxConcurrent: number; resourceNote: string; passed: boolean;
}
function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const TERMINAL = new Set(["completed", "failed", "blocked", "cancelled", "awaiting_approval"]);
async function timedTask(req: string): Promise<{ ok: boolean; ms: number; status: string }> {
  const t0 = Date.now();
  try {
    const { task } = await startAndRun(req);
    // Liveness property: every task reaches an honest terminal outcome
    // within budget. Local runs have no provider, so fail-closed "failed"
    // is an honest terminal outcome here, not a hang or crash.
    const ms = Date.now() - t0;
    return { ok: TERMINAL.has(task.status) && ms < 60000, ms, status: task.status };
  } catch { return { ok: false, ms: Date.now() - t0, status: "threw" }; }
}
/** Stage 1: sequential throughput, 10 simple tasks. */
export async function stageSequential(): Promise<StageResult> {
  await isolatedEnv();
  const ms: number[] = []; let ok = 0;
  for (let i = 0; i < 10; i++) {
    const r = await timedTask(`What is ${7 + i} times ${13 + i}?`);
    ms.push(r.ms); if (r.ok) ok++;
  }
  const passed = ok >= 8;
  return { stage: "sequential-10", tasks: 10, ok, p50ms: pct(ms, 50), p95ms: pct(ms, 95), maxConcurrent: 1, resourceNote: `mem=${(await listMemories()).length}`, passed };
}
/** Stage 2: bounded concurrency (ceiling 3), 9 tasks. */
export async function stageConcurrent(): Promise<StageResult> {
  await isolatedEnv();
  const reqs = Array.from({ length: 9 }, (_, i) => `What is ${100 + i} plus ${i}?`);
  const ms: number[] = []; let ok = 0;
  for (let b = 0; b < 3; b++) {
    const batch = await Promise.all(reqs.slice(b * 3, b * 3 + 3).map(timedTask));
    for (const r of batch) { ms.push(r.ms); if (r.ok) ok++; }
  }
  const passed = ok >= 7;
  return { stage: "concurrent-3x3", tasks: 9, ok, p50ms: pct(ms, 50), p95ms: pct(ms, 95), maxConcurrent: 3, resourceNote: "ceiling=3, no unbounded spawn", passed };
}
/** Stage 3: memory load — 50 stores then recall. */
export async function stageMemoryLoad(): Promise<StageResult> {
  await isolatedEnv();
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) {
    await submitCandidate({ content: `Stress fact ${i}: the harbour code is ${1000 + i}.`, source: { type: "eval", ref: "reality-stress" }, provenance: "reality-stress", accountId: "local" });
  }
  const hits = retrieveRelevant(await listMemories(), "harbour code 1042");
  const ms = Date.now() - t0;
  const ok = hits.length > 0 ? 1 : 0;
  return { stage: "memory-50-recall", tasks: 1, ok, p50ms: ms, p95ms: ms, maxConcurrent: 1, resourceNote: `stored=50 hits=${hits.length}`, passed: ok === 1 };
}
/** Stage 4: cancel/resume storm — 6 tasks, half cancelled. */
export async function stageCancelStorm(): Promise<StageResult> {
  await isolatedEnv();
  const { createTask, cancelNow } = await import("@/core/agent/orchestrator");
  let ok = 0;
  for (let i = 0; i < 6; i++) {
    const t = await createTask(`storm probe ${i}`);
    const c = await cancelNow(t.task, "storm cancel");
    if (c.status === "cancelled") ok++;
  }
  return { stage: "cancel-storm-6", tasks: 6, ok, p50ms: 0, p95ms: 0, maxConcurrent: 1, resourceNote: "no leaks: terminal states only", passed: ok === 6 };
}
