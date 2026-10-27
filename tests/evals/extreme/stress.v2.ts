/** v2 staged concurrency + endurance + memory growth. Local-only, ceilings fixed. */
import { isolatedEnv } from "../../helpers";
import { startAndRun } from "@/core/agent/orchestrator";
import { submitCandidate } from "@/core/memory/lifecycle";
import { listMemories } from "@/core/memory/source-store";
import { retrieveRelevant } from "@/core/memory/retriever";

export interface V2Stage { stage: string; tasks: number; ok: number; p50ms: number; p95ms: number; maxConcurrent: number; note: string; passed: boolean }
const pct = (xs: number[], p: number): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function calcTask(a: number, b: number): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  try {
    const { task } = await startAndRun(`What is ${a} times ${b}? Reply with the number.`);
    const v = a * b;
    const ok = task.status === "completed" && new RegExp(`(^|[^0-9])${v}([^0-9]|$)`).test(`${task.resultSummary ?? ""}`);
    return { ok, ms: Date.now() - t0 };
  } catch { return { ok: false, ms: Date.now() - t0 }; }
}

/** Staged concurrency N in one shared isolated env (shared stores = contention). */
export async function stageConcurrency(n: number): Promise<V2Stage> {
  await isolatedEnv();
  const ms: number[] = []; let ok = 0;
  const jobs = Array.from({ length: n * 3 }, (_, i) => ({ a: 3 + (i % 17), b: 5 + ((i * 7) % 13) }));
  for (let i = 0; i < jobs.length; i += n) {
    const batch = await Promise.all(jobs.slice(i, i + n).map((j) => calcTask(j.a, j.b)));
    for (const r of batch) { ms.push(r.ms); if (r.ok) ok++; }
  }
  return { stage: `concurrency-${n}`, tasks: jobs.length, ok, p50ms: pct(ms, 50), p95ms: pct(ms, 95), maxConcurrent: n, note: `shared env, exact-value verified`, passed: ok === jobs.length };
}

/** Sustained sequential load: 40 deterministic tasks. */
export async function stageEndurance(): Promise<V2Stage> {
  await isolatedEnv();
  const ms: number[] = []; let ok = 0;
  for (let i = 0; i < 40; i++) {
    const r = await calcTask(11 + (i % 9), 13 + (i % 7));
    ms.push(r.ms); if (r.ok) ok++;
  }
  const first = pct(ms.slice(0, 20), 50); const second = pct(ms.slice(20), 50);
  return { stage: "endurance-40", tasks: 40, ok, p50ms: pct(ms, 50), p95ms: pct(ms, 95), maxConcurrent: 1, note: `median drift first-half=${first}ms second-half=${second}ms`, passed: ok === 40 };
}

/** Memory growth: 300 stores then recall precision + latency. */
export async function stageMemoryGrowth(): Promise<V2Stage> {
  await isolatedEnv();
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    await submitCandidate({ content: `XT2 growth fact ${i}: the store code is ${5000 + i}.`, source: { type: "eval", ref: "xt2-growth" }, provenance: "xt2-growth", accountId: "local" });
  }
  const q0 = Date.now();
  const hits = retrieveRelevant(await listMemories(), "xt2 growth store code 5142");
  const qms = Date.now() - q0;
  const found = hits.slice(0, 5).some((h) => h.content.includes("5142"));
  return { stage: "memory-growth-300", tasks: 301, ok: found ? 301 : 300, p50ms: qms, p95ms: Date.now() - t0, maxConcurrent: 1, note: `recall@5 ${found ? "hit" : "MISS"} in ${qms}ms; store ${Date.now() - t0}ms`, passed: found };
}
