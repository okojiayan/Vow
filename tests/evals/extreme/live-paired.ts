/** Extreme v2 bounded live paired comparison (<=12 comparable cases).
 * Sequential Mode A (Nemotron alone) + Mode B (full VOW) on the same case IDs.
 * Early-stop after 2 consecutive infra failures. No mocks: real provider or BLOCKED.
 * Does NOT run on import. Call runLivePaired() explicitly with LIVE_EXTREME=1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LivePairedCase { id: string; prompt: string; expectedValue?: number; }
export const LIVE_PAIRED_CASES: LivePairedCase[] = [
  { id: "XT2-A001", prompt: "What is 100 minus 37? Reply with the number.", expectedValue: 63 },
  { id: "XT2-A002", prompt: "What is 20 plus 22? Reply with the number.", expectedValue: 42 },
  { id: "XT2-A003", prompt: "Compute 12 times 12 then add 8. Reply with the number.", expectedValue: 152 },
  { id: "XT2-A005", prompt: "What is 1000 minus 1 minus 1? Reply with the number.", expectedValue: 998 },
  { id: "XT2-A008", prompt: "What is 7 multiplied by 6? Reply with the number.", expectedValue: 42 },
  { id: "XT2-A009", prompt: "What is 100 divided by 4? Reply with the number.", expectedValue: 25 },
  { id: "XT2-A011", prompt: "What is 9 squared? Reply with the number.", expectedValue: 81 },
  { id: "XT2-A012", prompt: "What is 2 to the power 8? Reply with the number.", expectedValue: 256 },
  { id: "XT2-A016", prompt: "What is (8 + 7) * 6? Reply with the number.", expectedValue: 90 },
  { id: "XT2-A017", prompt: "What is 0.5 times 40? Reply with the number.", expectedValue: 20 },
  { id: "XT2-A018", prompt: "What is 144 divided by 12? Reply with the number.", expectedValue: 12 },
  { id: "XT2-A082", prompt: "What is 5 times 5? Reply with the number.", expectedValue: 25 },
];

export interface LivePairedResult {
  caseId: string; mode: "A"|"B"; ok: boolean; pass: boolean;
  text: string; model: string | null; wallMs: number;
  error: string | null; infra: boolean;
}

function isInfra(text: string | null): boolean {
  if (!text) return false;
  return /http 50[23]|timed?\s?out|timeout|abort|econn|enotfound|socket hang up|network|fetch failed|empty model|service unavailable/i.test(text);
}

export async function runLivePaired(outdir: string, opts?: { maxCases?: number; infraStop?: number }): Promise<{ results: LivePairedResult[]; stoppedEarly: boolean; reason: string }> {
  const { completeChat } = await import("@/integrations/meterless/client");
  const { startAndRun } = await import("@/core/agent/orchestrator");
  const maxCases = Math.min(opts?.maxCases ?? 12, LIVE_PAIRED_CASES.length);
  const infraStop = opts?.infraStop ?? 2;
  const targets = LIVE_PAIRED_CASES.slice(0, maxCases);
  const results: LivePairedResult[] = [];
  let consecutiveInfra = 0;
  let stoppedEarly = false;
  let reason = "completed all targets";
  mkdirSync(outdir, { recursive: true });
  for (const c of targets) {
    if (consecutiveInfra >= infraStop) { stoppedEarly = true; reason = `early-stop after ${consecutiveInfra} consecutive infra failures`; break; }
    // Mode A
    const t0 = Date.now();
    try {
      const r = await completeChat([{ role: "user", content: c.prompt }]);
      const wallMs = Date.now() - t0;
      if (!r.ok) {
        const infra = isInfra(r.error);
        results.push({ caseId: c.id, mode: "A", ok: false, pass: false, text: "", model: null, wallMs, error: r.error, infra });
        consecutiveInfra = infra ? consecutiveInfra + 1 : 0;
        if (consecutiveInfra >= infraStop) { stoppedEarly = true; reason = `early-stop after ${consecutiveInfra} consecutive infra failures at A ${c.id}`; break; }
        continue;
      }
      const pass = c.expectedValue === undefined ? true : new RegExp(`(^|[^0-9])${c.expectedValue}([^0-9]|$)`).test(r.text);
      results.push({ caseId: c.id, mode: "A", ok: true, pass, text: r.text.slice(0, 1000), model: r.model ?? null, wallMs, error: null, infra: false });
      consecutiveInfra = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const infra = isInfra(msg);
      results.push({ caseId: c.id, mode: "A", ok: false, pass: false, text: "", model: null, wallMs: Date.now() - t0, error: msg.slice(0, 500), infra });
      consecutiveInfra = infra ? consecutiveInfra + 1 : 0;
      if (consecutiveInfra >= infraStop) { stoppedEarly = true; reason = `early-stop after ${consecutiveInfra} consecutive infra failures at A ${c.id}`; break; }
      continue;
    }
    // Mode B
    const t1 = Date.now();
    try {
      const { task } = await startAndRun(c.prompt);
      const wallMs = Date.now() - t1;
      const text = `${task.resultSummary ?? ""} ${task.error ?? ""}`;
      const pass = task.status === "completed" && (c.expectedValue === undefined || new RegExp(`(^|[^0-9])${c.expectedValue}([^0-9]|$)`).test(text));
      const infra = isInfra(task.error ?? "") && task.status !== "completed";
      results.push({ caseId: c.id, mode: "B", ok: task.status === "completed", pass, text: text.slice(0, 1000), model: (task as unknown as { inferenceMode?: string }).inferenceMode ?? null, wallMs, error: task.error ?? null, infra });
      consecutiveInfra = infra ? consecutiveInfra + 1 : 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const infra = isInfra(msg);
      results.push({ caseId: c.id, mode: "B", ok: false, pass: false, text: "", model: null, wallMs: Date.now() - t1, error: msg.slice(0, 500), infra });
      consecutiveInfra = infra ? consecutiveInfra + 1 : 0;
    }
  }
  writeFileSync(join(outdir, "live-paired.json"), JSON.stringify({ cases: targets.map((t) => t.id), results, stoppedEarly, reason, at: new Date().toISOString() }, null, 2));
  return { results, stoppedEarly, reason };
}
