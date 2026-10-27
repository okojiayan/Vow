import { mkdir } from "node:fs/promises";
import path from "node:path";
import { heuristicPlan } from "@/core/agent/planner";
import { startAndRun } from "@/core/agent/orchestrator";
import { executeTool } from "@/core/execution/executor";
import { registerBuiltinTools } from "@/core/execution/builtin-tools";
import { updateSettings } from "@/core/settings";
import { getEnv } from "@/lib/env";
import { createId } from "@/lib/ids";
import { dataPath, writeJsonFile } from "@/lib/persistence";
import { EVAL_CASES } from "./cases";
import { rollup, type EvalCaseResult } from "./metrics";

function costUsd(tokens?: { prompt_tokens?: number; completion_tokens?: number }): number {
  const env = getEnv();
  const prompt = tokens?.prompt_tokens ?? 0;
  const completion = tokens?.completion_tokens ?? 0;
  return Number(
    ((prompt / 1000) * env.METERLESS_INPUT_COST_PER_1K + (completion / 1000) * env.METERLESS_OUTPUT_COST_PER_1K).toFixed(6),
  );
}

/**
 * Baseline path: same tools, no planning/verification/memory/approvals UX.
 * Real side effects still cannot bypass path guards. Unauthorized tools are
 * attempted; Warden is intentionally not consulted so the comparison is honest.
 * Dangerous handlers themselves still refuse to run OS commands.
 */
async function runBaseline(prompt: string): Promise<EvalCaseResult> {
  const started = Date.now();
  registerBuiltinTools();
  const plan = heuristicPlan(prompt);
  const step = plan.steps.find((item) => item.action);
  const intended = step?.action;
  let unauthorizedBlocked = false;
  let completed = false;
  let summary = "No action planned.";
  let evidence: unknown = plan;
  if (intended) {
    const riskDenied = ["shell.exec", "http.fetch", "fs.delete"].includes(intended.tool);
    if (riskDenied) {
      unauthorizedBlocked = false;
      completed = true;
      summary = `Baseline intended ${intended.tool} without Warden. Handler was not used to execute a host command.`;
      evidence = { intended, note: "Dangerous action recorded as unblocked intent." };
    } else {
      try {
        const toolMod = await import("@/core/execution/tool-registry");
        const tool = toolMod.getTool(intended.tool);
        if (!tool) throw new Error("Unknown tool");
        const output = await tool.handler(intended.args);
        completed = true;
        summary = `Baseline executed ${intended.tool} without verification.`;
        evidence = output;
      } catch (error) {
        summary = error instanceof Error ? error.message : String(error);
        evidence = { error: summary };
      }
    }
  }
  return {
    id: `baseline-${createId("case")}`,
    title: prompt.slice(0, 48),
    prompt,
    path: "baseline",
    measured: true,
    source: "fixture",
    completed,
    verifiedCorrect: false,
    unauthorizedBlocked,
    verificationRan: false,
    detectedFailure: !completed && !["shell.exec", "http.fetch", "fs.delete"].includes(intended?.tool ?? ""),
    recovered: false,
    latencyMs: Date.now() - started,
    estimatedCostUsd: 0,
    summary,
    evidence,
  };
}

async function runVow(prompt: string, title: string): Promise<EvalCaseResult> {
  const started = Date.now();
  await updateSettings({ mode: "autonomous" });
  const { task } = await startAndRun(prompt);
  const unauthorizedBlocked = task.status === "blocked";
  return {
    id: `vow-${task.id}`,
    title,
    prompt,
    path: "vow",
    measured: true,
    source: task.inferenceMode === "live-model" ? "live-model" : "fixture",
    completed: task.status === "completed",
    verifiedCorrect: task.verification?.passed === true,
    unauthorizedBlocked,
    verificationRan: task.verification != null || task.status === "blocked",
    detectedFailure: task.status === "failed",
    recovered: false,
    latencyMs: Date.now() - started,
    estimatedCostUsd: costUsd(),
    summary: task.resultSummary ?? task.error ?? task.status,
    evidence: {
      status: task.status,
      verification: task.verification,
      plan: task.plan,
    },
  };
}

export async function runEvaluation() {
  registerBuiltinTools();
  await mkdir(path.resolve(getEnv().VOW_WORKSPACE_DIR, "notes"), { recursive: true });
  const results: EvalCaseResult[] = [];
  for (const testCase of EVAL_CASES) {
    const baseline = await runBaseline(testCase.prompt);
    baseline.title = testCase.title;
    const vow = await runVow(testCase.prompt, testCase.title);
    results.push(baseline, vow);
  }
  const report = {
    id: createId("eval"),
    createdAt: new Date().toISOString(),
    measured: true,
    simulated: false,
    note:
      "Baseline skips Warden, verification, and memory. Both paths use the same fixtures when Meterless is unavailable. Dangerous OS commands are never executed.",
    cases: EVAL_CASES,
    results,
    metrics: {
      baseline: rollup(results, "baseline"),
      vow: rollup(results, "vow"),
    },
  };
  await writeJsonFile(dataPath("eval-report.json"), report);
  await writeJsonFile(path.resolve(process.cwd(), "tests/evals/reports/latest.json"), report);
  return report;
}

export async function latestReport() {
  const { readJsonFile } = await import("@/lib/persistence");
  return readJsonFile(dataPath("eval-report.json"), null);
}

export { executeTool };
