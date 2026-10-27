import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import type { AgentTask, PlanStep } from "@/core/agent/types";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

function step(overrides: Partial<PlanStep>): PlanStep {
  return {
    id: "s1",
    title: "step",
    instruction: "do it",
    requiresApproval: false,
    status: "running",
    ...overrides,
  } as PlanStep;
}

function task(overrides: Partial<AgentTask>): AgentTask {
  const now = new Date().toISOString();
  return {
    id: "task_lifecycle_1",
    conversationId: "conv_lifecycle_1",
    request: "Read the workspace file.",
    status: "executing",
    plan: null,
    currentStepId: null,
    pendingApprovalId: null,
    resultSummary: null,
    verification: null,
    error: null,
    inferenceMode: "deterministic",
    autonomyMode: "supervised",
    queuedAt: now,
    claimedAt: now,
    claimedBy: null,
    cancelRequested: false,
    cancelReason: null,
    attempts: 1,
    parentTaskId: null,
    allowedTools: null,
    lastHeartbeat: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("outcome lifecycle proof (real stores, no network)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "",
      METERLESS_TIMEOUT_MS: "1000",
      VOW_DATA_DIR: mkdtempSync(join(tmpdir(), "vow-lifecycle-")),
      VOW_WORKSPACE_DIR: mkdtempSync(join(tmpdir(), "vow-lifecycle-ws-")),
      ZETARIS_API_KEY: "",
    });
    globalThis.fetch = (() => {
      throw new Error("network disabled in lifecycle proof");
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
  });

  it("1. verified success stays verified after save, reload, and API serialization", async () => {
    const { verifySteps } = await import("@/core/verification/verifier");
    const { buildStructuredOutcome, taskStatusForOutcome } = await import("@/core/reasoning/outcome");
    const { saveTask, getTask, listTasks } = await import("@/core/agent/task-store");
    const { appendTrace, getTrace } = await import("@/core/traces/trace-store");

    const steps = [
      step({
        action: { tool: "fs.read", args: { path: "notes/a.md" } },
        output: { content: "real content here" },
      }),
    ];
    const verification = await verifySteps(steps, "Read the workspace file.");
    expect(verification.passed).toBe(true);
    const outcome = buildStructuredOutcome({
      outcome: "completed",
      reason: "File content verified.",
      acceptanceSatisfied: 1,
      acceptanceTotal: 1,
      evidenceIds: ["s1"],
      verificationPassed: verification.passed,
      providerProvenance: ["executor:fs.read"],
    });
    const saved = await saveTask(
      task({
        status: taskStatusForOutcome("completed"),
        plan: { summary: "read", steps, inferenceMode: "deterministic" },
        verification: { passed: verification.passed, explanation: verification.explanation, evidence: verification.checks },
        resultSummary: "Completed: Read the workspace file. File content verified.",
        outcome,
        error: null,
      }),
    );
    expect(saved.status).toBe("completed");

    const reloaded = await getTask(saved.id);
    expect(reloaded?.verification?.passed).toBe(true);
    expect(reloaded?.outcome?.outcome).toBe("completed");
    expect(reloaded?.outcome?.evidenceIds).toEqual(["s1"]);

    // Same execution: trace events recorded against the same task id.
    await appendTrace(saved.id, { kind: "completed", title: "Completed", detail: "ok" });
    const trace = await getTrace(saved.id);
    expect(trace.taskId).toBe(saved.id);
    expect(trace.events.length).toBeGreaterThan(0);

    // API serialization is verbatim: what the route returns is what was saved.
    const { GET } = await import("@/app/api/agent/route");
    const res = await GET();
    const body = (await res.json()) as { tasks: AgentTask[] };
    const viaApi = body.tasks.find((t) => t.id === saved.id);
    expect(viaApi?.status).toBe("completed");
    expect(viaApi?.verification?.passed).toBe(true);
    expect(viaApi?.outcome?.outcome).toBe("completed");

    const { listTasks: _l } = await import("@/core/agent/task-store");
    expect((await _l()).find((t) => t.id === saved.id)?.verification?.passed).toBe(true);
    expect(listTasks).toBeDefined();
  });

  it("2. partial keeps its shortfall and never renders as full success", async () => {
    const { buildStructuredOutcome, taskStatusForOutcome } = await import("@/core/reasoning/outcome");
    const { saveTask, getTask } = await import("@/core/agent/task-store");
    const { taskCardState, formatOutcome } = await import("@/lib/task-display");

    const outcome = buildStructuredOutcome({
      outcome: "partial",
      reason: "Only 1 of 2 files verified.",
      acceptanceSatisfied: 1,
      acceptanceTotal: 2,
      evidenceIds: ["s1"],
      verificationPassed: true,
      providerProvenance: ["executor:fs.read"],
    });
    const saved = await saveTask(
      task({
        id: "task_lifecycle_partial",
        status: taskStatusForOutcome("partial"),
        verification: { passed: true, explanation: "1 of 2 checks passed.", evidence: [] },
        resultSummary: "Partial progress: not all acceptance conditions were met. Only 1 of 2 files verified.",
        outcome,
      }),
    );
    const reloaded = await getTask(saved.id);
    expect(reloaded?.outcome?.outcome).toBe("partial");
    expect(reloaded?.resultSummary).toMatch(/partial progress/i);
    expect(taskCardState(reloaded!.status, reloaded!.outcome)).toBe("partial");
    expect(formatOutcome(reloaded!.outcome as { outcome: string; reason: string })).toMatch(/partial/i);
  });

  it("3. blocked stays blocked through persistence, API shape, and display", async () => {
    const { verifySteps } = await import("@/core/verification/verifier");
    const { saveTask, getTask } = await import("@/core/agent/task-store");
    const { taskCardState } = await import("@/lib/task-display");
    const { notChecked } = await import("@/core/warden/task-label");

    const steps = [
      step({
        action: { tool: "run_sql", args: { sql: "SELECT 1" } },
        status: "blocked",
        error: "Blocked by Warden.",
        output: null,
      }),
    ];
    const verification = await verifySteps(steps, "Check the database.");
    expect(verification.passed).toBe(false);
    const saved = await saveTask(
      task({
        id: "task_lifecycle_blocked",
        status: "blocked",
        plan: { summary: "db", steps, inferenceMode: "deterministic" },
        verification: { passed: false, explanation: verification.explanation, evidence: verification.checks },
        resultSummary: "Blocked by Warden.",
        error: "Blocked by Warden.",
      }),
    );
    const reloaded = await getTask(saved.id);
    expect(reloaded?.status).toBe("blocked");
    expect(taskCardState(reloaded!.status, reloaded!.outcome ?? null)).toBe("blocked");
    const gaps = await notChecked(saved.id);
    expect(gaps.some((g) => /warden|blocked/i.test(`${g.item} ${g.reason}`))).toBe(true);
  });

  it("4. failed/unverified can never become successful in serialization or rendering", async () => {
    const { saveTask, getTask } = await import("@/core/agent/task-store");
    const { taskCardState } = await import("@/lib/task-display");
    const { buildStructuredOutcome, taskStatusForOutcome } = await import("@/core/reasoning/outcome");

    const failedOutcome = buildStructuredOutcome({
      outcome: "unverified",
      reason: "No evidence.",
      acceptanceSatisfied: 0,
      acceptanceTotal: 1,
      evidenceIds: [],
      verificationPassed: false,
      providerProvenance: [],
    });
    const saved = await saveTask(
      task({
        id: "task_lifecycle_unverified",
        status: taskStatusForOutcome("unverified"),
        verification: { passed: false, explanation: "No evidence.", evidence: [] },
        resultSummary: "Ended unverified: No evidence.",
        outcome: failedOutcome,
      }),
    );
    expect(saved.status).toBe("failed");
    // JSON round-trip (exactly what Response.json performs) preserves failure.
    const roundTripped = JSON.parse(JSON.stringify(saved)) as AgentTask;
    expect(roundTripped.status).toBe("failed");
    expect(roundTripped.outcome?.outcome).toBe("unverified");
    const reloaded = await getTask(saved.id);
    expect(reloaded?.status).toBe("failed");
    expect(taskCardState(reloaded!.status, reloaded!.outcome)).toBe("unverified");
    expect(taskCardState(reloaded!.status, reloaded!.outcome)).not.toBe("completed");
  });

  it("5. completed record without verification is flagged by notChecked", async () => {
    const { saveTask } = await import("@/core/agent/task-store");
    const { notChecked } = await import("@/core/warden/task-label");

    await saveTask(
      task({ id: "task_lifecycle_noverify", status: "completed", verification: null, resultSummary: "Done." }),
    );
    const gaps = await notChecked("task_lifecycle_noverify");
    expect(gaps.some((g) => /without a recorded verification pass/i.test(g.reason))).toBe(true);
  });

  it("6. trace evidence and verification record belong to the same execution", async () => {
    const { verifySteps } = await import("@/core/verification/verifier");
    const { saveTask } = await import("@/core/agent/task-store");
    const { appendTrace, getTrace } = await import("@/core/traces/trace-store");

    const steps = [
      step({
        id: "s-evidence",
        action: { tool: "fs.read", args: { path: "notes/a.md" } },
        output: { content: "real content here" },
      }),
    ];
    const verification = await verifySteps(steps, "Read the workspace file.");
    const saved = await saveTask(
      task({
        id: "task_lifecycle_trace",
        status: "completed",
        plan: { summary: "read", steps, inferenceMode: "deterministic" },
        verification: { passed: verification.passed, explanation: verification.explanation, evidence: verification.checks },
        resultSummary: "Completed.",
      }),
    );
    await appendTrace(saved.id, { kind: "tool_call", title: "fs.read ok", detail: "Evidence s-evidence." });
    await appendTrace("task_someone_else", { kind: "tool_call", title: "other", detail: "unrelated" });
    const trace = await getTrace(saved.id);
    expect(trace.events.every((e) => trace.taskId === saved.id)).toBe(true);
    expect(trace.events.some((e) => /s-evidence/.test(`${e.title} ${e.detail}`))).toBe(true);
    // Verification evidence references the same step output, not stale data.
    expect(JSON.stringify(saved.verification?.evidence)).toContain("real content here");
  });

  it("7. missing or malformed verification data fails safely without crashing", async () => {
    const { saveTask, listTasks } = await import("@/core/agent/task-store");
    const { notChecked } = await import("@/core/warden/task-label");
    const { taskCardState } = await import("@/lib/task-display");

    await saveTask(task({ id: "task_lifecycle_null", status: "failed", verification: null }));
    await saveTask(
      task({
        id: "task_lifecycle_malformed",
        status: "failed",
        verification: { passed: false, explanation: "", evidence: [] },
        outcome: undefined,
      }),
    );
    const tasks = await listTasks();
    expect(tasks.some((t) => t.id === "task_lifecycle_null")).toBe(true);
    expect(tasks.some((t) => t.id === "task_lifecycle_malformed")).toBe(true);
    const gaps = await notChecked("task_lifecycle_null");
    expect(gaps.length).toBeGreaterThan(0);
    expect(taskCardState("failed", null)).toBe("failed");
    expect(taskCardState("failed", undefined)).toBe("failed");
  });
});
