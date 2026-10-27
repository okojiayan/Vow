import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import type { AgentTask, PlanStep } from "@/core/agent/types";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

function mkStep(id: string, file: string): PlanStep {
  return {
    id,
    title: `Read ${file}`,
    instruction: `Read ${file}`,
    action: { tool: "fs.read", args: { path: file }, target: file },
    requiresApproval: false,
    status: "pending",
  } as PlanStep;
}

describe("structured trace correlation (real stores, no network)", () => {
  const originalFetch = globalThis.fetch;
  let dataDir = "";
  // Production binds the tool workspace directory once at tool registration
  // (process lifetime), so all tests in this module share one workspace dir
  // while every test still gets an isolated data dir (all stores resolve it
  // lazily per call). This accommodates the production design; it does not
  // weaken what is asserted.
  let sharedWorkspaceDir = "";
  let fetchCalls = 0;

  beforeAll(() => {
    sharedWorkspaceDir = mkdtempSync(join(tmpdir(), "vow-tcorr-ws-"));
    writeFileSync(join(sharedWorkspaceDir, "alpha.txt"), "alpha content\\n", "utf8");
    writeFileSync(join(sharedWorkspaceDir, "beta.txt"), "beta content\\n", "utf8");
  });

  afterAll(() => {
    if (sharedWorkspaceDir) {
      try {
        rmSync(sharedWorkspaceDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of test-owned temp dirs only.
      }
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = 0;
    dataDir = mkdtempSync(join(tmpdir(), "vow-tcorr-data-"));
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "",
      METERLESS_TIMEOUT_MS: "1000",
      VOW_DATA_DIR: dataDir,
      VOW_WORKSPACE_DIR: sharedWorkspaceDir,
      ZETARIS_API_KEY: "",
    });
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network disabled in trace-correlation tests");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setEnv({
      METERLESS_API_KEY: undefined,
      METERLESS_TIMEOUT_MS: undefined,
      VOW_DATA_DIR: undefined,
      VOW_WORKSPACE_DIR: undefined,
      ZETARIS_API_KEY: undefined,
    });
    vi.restoreAllMocks();
    if (dataDir) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of test-owned temp dirs only.
      }
    }
  });

  it("1. dispatch events carry the structured step reference", async () => {
    const { startAndRun } = await import("@/core/agent/orchestrator");
    const { getTrace } = await import("@/core/traces/trace-store");

    const { task } = await startAndRun("Read alpha.txt");
    const stepId = task.plan?.steps.find((s) => s.action?.tool === "fs.read")?.id;
    expect(stepId).toBeTruthy();
    const trace = await getTrace(task.id);
    const dispatches = trace.events.filter(
      (e) =>
        e.kind === "tool_call" &&
        (e.data as { args?: unknown } | undefined)?.args !== undefined,
    );
    expect(dispatches.length).toBeGreaterThan(0);
    for (const d of dispatches) {
      const data = d.data as { tool: string; stepId?: string; args?: { path?: string } };
      expect(data.tool).toBe("fs.read");
      expect(data.stepId).toBe(stepId);
      expect(data.args?.path).toBe("alpha.txt");
    }
    expect(fetchCalls).toBe(0);
  }, 120000);

  it("2-4. receipt, outcome event, and verification resolve to one execution structurally", async () => {
    const { startAndRun } = await import("@/core/agent/orchestrator");
    const { getTrace } = await import("@/core/traces/trace-store");
    const { listReceipts } = await import("@/core/execution/reversals");
    const { getTask } = await import("@/core/agent/task-store");

    const { task } = await startAndRun("Read alpha.txt");
    const stepId = task.plan?.steps.find((s) => s.action?.tool === "fs.read")?.id;
    const persisted = await getTask(task.id);
    const trace = await getTrace(task.id);
    const receipts = await listReceipts(task.id);

    // Receipt linked to the exact step, no free-text parsing.
    const okReceipts = receipts.filter((r) => r.outcome === "ok");
    expect(okReceipts.length).toBeGreaterThan(0);
    expect(okReceipts.every((r) => r.taskId === task.id && r.stepId === stepId)).toBe(true);

    // Outcome event references the evidence id structurally.
    const outcomes = trace.events.filter(
      (e) =>
        e.kind === "tool_call" &&
        (e.data as { evidenceId?: unknown } | undefined)?.evidenceId !== undefined,
    );
    expect(outcomes.length).toBeGreaterThan(0);
    const evidenceIds = outcomes.map(
      (e) => (e.data as { evidenceId: string; stepId?: string; tool: string }).evidenceId,
    );
    expect(evidenceIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(
      outcomes.every(
        (e) =>
          (e.data as { stepId?: string }).stepId === stepId &&
          (e.data as { tool?: string }).tool === "fs.read",
      ),
    ).toBe(true);

    // The same evidence id appears in the persisted outcome; the verification
    // record carries the executed output. Nothing was matched via detail text.
    for (const id of evidenceIds) {
      expect(persisted?.outcome?.evidenceIds).toContain(id);
    }
    expect(JSON.stringify(persisted?.verification?.evidence)).toContain("alpha content");
    expect(fetchCalls).toBe(0);
  }, 120000);

  it("5. two steps in one task cannot be cross-linked", async () => {
    const { createTask, runTask } = await import("@/core/agent/orchestrator");
    const { getTrace } = await import("@/core/traces/trace-store");
    const { listReceipts } = await import("@/core/execution/reversals");
    const { saveTask } = await import("@/core/agent/task-store");

    const created = await createTask("Read alpha.txt and beta.txt");
    const steps = [mkStep("step_alpha", "alpha.txt"), mkStep("step_beta", "beta.txt")];
    await saveTask({
      ...created.task,
      status: "executing",
      inferenceMode: "heuristic-demo",
      plan: { summary: "read two files", steps, inferenceMode: "heuristic-demo" as const },
    });
    const finished = await runTask(created.task.id);
    expect(["completed", "failed", "blocked"]).toContain(finished.status);

    const trace = await getTrace(created.task.id);
    const dispatches = trace.events.filter(
      (e) =>
        e.kind === "tool_call" &&
        (e.data as { args?: unknown } | undefined)?.args !== undefined,
    );
    const byStep = new Map<string, string>();
    for (const d of dispatches) {
      const data = d.data as { stepId?: string; args?: { path?: string } };
      expect(data.stepId).toBeTruthy();
      byStep.set(data.stepId!, data.args?.path as string);
    }
    // Each step's dispatch references its own file, never the sibling's.
    expect(byStep.get("step_alpha")).toBe("alpha.txt");
    expect(byStep.get("step_beta")).toBe("beta.txt");

    const receipts = (await listReceipts(created.task.id)).filter((r) => r.outcome === "ok");
    expect(receipts.length).toBe(2);
    const pathByStep = new Map(receipts.map((r) => [r.stepId, (r.argsRedacted as { path?: string }).path]));
    expect(pathByStep.get("step_alpha")).toBe("alpha.txt");
    expect(pathByStep.get("step_beta")).toBe("beta.txt");
    expect(fetchCalls).toBe(0);
  }, 120000);

  it("6-7. legacy events and missing optional ids stay readable", async () => {
    const { appendTrace, getTrace } = await import("@/core/traces/trace-store");
    const { recordReceipt, listReceipts } = await import("@/core/execution/reversals");
    const { summarizeActivity } = await import("@/lib/activity-summary");
    const { taskCardState, formatOutcome } = await import("@/lib/task-display");

    // Legacy shape: no structured link fields at all.
    await appendTrace("task_legacy", { kind: "tool_call", title: "Tool fs.read", detail: "Evidence ev_old." });
    await appendTrace("task_legacy", { kind: "completed", title: "Completed", detail: "done" });
    const legacy = await getTrace("task_legacy");
    expect(legacy.events).toHaveLength(2);
    expect(legacy.events[0].id).toBeTruthy();

    // Receipt without stepId and event with undefined data must not crash readers.
    const receipt = await recordReceipt({
      taskId: "task_legacy",
      tool: "fs.read",
      args: { path: "alpha.txt" },
      outcome: "ok",
      reversible: false,
    });
    expect(receipt.stepId).toBeUndefined();
    expect((await listReceipts("task_legacy")).some((r) => r.id === receipt.id)).toBe(true);
    const summary = summarizeActivity(legacy.events, [], "completed");
    expect(summary.toolCalls).toBe(1);
    expect(taskCardState("completed", { outcome: "completed" })).toBe("completed");
    expect(formatOutcome({ outcome: "completed", reason: "ok" })).toMatch(/completed/i);
    expect(fetchCalls).toBe(0);
  });
});
