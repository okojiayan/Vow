import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planTask } from "@/core/agent/planner";
import {
  deliberateHeuristicDiagnosis,
  diagnoseMeterlessFailure,
  unknownFallbackDiagnosis,
} from "@/core/agent/fallback-diagnosis";
import { runReasoningCycle } from "@/core/reasoning/runner";
import { clearLedger } from "@/core/reasoning/ledger";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { updateSettings } from "@/core/settings";
import { resetEnvCache } from "@/lib/env";
import { isolatedEnv } from "../../helpers";
import type { AgentTask } from "@/core/agent/types";
import type { MeterlessResult } from "@/integrations/meterless/types";

vi.mock("@/integrations/meterless/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/integrations/meterless/client")>();
  return { ...orig, completeChat: vi.fn() };
});

import { completeChat } from "@/integrations/meterless/client";

const mockedCompleteChat = vi.mocked(completeChat);

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

function failResult(code: MeterlessResult & { ok: false }): MeterlessResult {
  return code;
}

function runnerTask(id: string): AgentTask {
  const now = new Date().toISOString();
  return {
    id, conversationId: "c", request: "Explain the safe method", status: "executing",
    plan: {
      summary: "s",
      steps: [
        { id: "s1", title: "Explain the safe method", instruction: "Answer directly.", analysis: true, expectGrounding: "none", status: "pending", requiresApproval: false },
      ],
      inferenceMode: "heuristic-demo",
    },
    currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null,
    inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null,
    cancelRequested: false, cancelReason: null, attempts: 0, lastHeartbeat: null, createdAt: now, updatedAt: now,
  };
}

describe("provider fallback diagnosis (Phase 2U, no network)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "test-key",
      METERLESS_MODEL: "test-model",
      METERLESS_TIMEOUT_MS: "1000",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setEnv({ METERLESS_API_KEY: "", METERLESS_TIMEOUT_MS: undefined });
  });

  it("1. planner timeout records a structured timeout diagnosis and keeps fail-closed behavior", async () => {
    mockedCompleteChat.mockResolvedValue(failResult({ ok: false, code: "timeout", error: "Meterless timed out after 1000ms." }));
    const { plan, modelError, fallback } = await planTask("What is the safest way to list directory contents?", "none");
    expect(plan.inferenceMode).toBe("heuristic-demo");
    expect(modelError).toContain("timed out");
    expect(fallback?.stage).toBe("planner");
    expect(fallback?.reason).toBe("timeout");
    expect(fallback?.responded).toBe(false);
    expect(typeof fallback?.elapsedMs).toBe("number");
    expect(fallback?.httpStatus).toBeUndefined();
    expect(fallback?.modelExpected).toBe("test-model");
  });

  it("2. planner HTTP 503 records http_error with status and responded=true", async () => {
    mockedCompleteChat.mockResolvedValue(
      failResult({ ok: false, code: "unavailable", httpStatus: 503, error: "Meterless returned HTTP 503. Body: engine_not_running" }),
    );
    const { fallback } = await planTask("What is the safest way to list directory contents?", "none");
    expect(fallback?.stage).toBe("planner");
    expect(fallback?.reason).toBe("http_error");
    expect(fallback?.httpStatus).toBe(503);
    expect(fallback?.responded).toBe(true);
  });

  it("3. planner network failure records network_error with responded=false", async () => {
    mockedCompleteChat.mockResolvedValue(
      failResult({ ok: false, code: "unavailable", error: "Meterless is unavailable: fetch failed" }),
    );
    const { fallback } = await planTask("What is the safest way to list directory contents?", "none");
    expect(fallback?.reason).toBe("network_error");
    expect(fallback?.responded).toBe(false);
    expect(fallback?.httpStatus).toBeUndefined();
  });

  it("4. planner empty-200 records empty_response with responded=true", async () => {
    mockedCompleteChat.mockResolvedValue(
      failResult({ ok: false, code: "invalid_response", error: "Meterless returned HTTP 200 but no assistant text." }),
    );
    const { fallback } = await planTask("What is the safest way to list directory contents?", "none");
    expect(fallback?.reason).toBe("empty_response");
    expect(fallback?.responded).toBe(true);
  });

  it("5. deliberate direct-answer route is distinguished from provider failure", async () => {
    mockedCompleteChat.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        summary: "model plan",
        steps: [{ title: "List", instruction: "list", tool: "fs.list", args: { path: "." }, target: null }],
      }),
      model: "test-model",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      raw: { choices: [] },
    });
    const advisory = "What is the safest way to list directory contents?";
    const { plan, modelError, usage, fallback } = await planTask(advisory, "none");
    // Provider succeeded, yet the planner deliberately overrode the tool plan.
    expect(modelError).toBeUndefined();
    expect(usage?.prompt_tokens).toBe(10);
    expect(plan.inferenceMode).toBe("heuristic-demo");
    expect(plan.steps.some((s) => s.action)).toBe(false);
    expect(fallback?.stage).toBe("planner");
    expect(fallback?.reason).toBe("deliberate_heuristic_route");
    expect(fallback?.responded).toBe(true);
  });

  it("6. genuine live-model plans carry no fallback diagnosis", async () => {
    mockedCompleteChat.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        summary: "recall plan",
        steps: [{ title: "Recall", instruction: "recall", tool: "memory.search", args: { query: "x" }, target: null }],
      }),
      model: "test-model",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      raw: { choices: [] },
    });
    const { plan, modelError, fallback } = await planTask("From project memory, what is the weekend deploy window?", "none");
    expect(plan.inferenceMode).toBe("live-model");
    expect(modelError).toBeUndefined();
    expect(fallback).toBeUndefined();
  });

  it("7. diagnosis never copies credentials, headers, bodies, or prompts", () => {
    const d = diagnoseMeterlessFailure(
      { code: "unavailable", httpStatus: 503 },
      "planner",
      { elapsedMs: 12, modelExpected: "test-model" },
    );
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("Body:");
    expect(serialized).not.toContain("engine_not_running");
    expect(d.modelReturned).toBeUndefined();
    expect((d.detail ?? "").length).toBeLessThanOrEqual(241);
    // Even a hostile failure object cannot leak through: only code/status are read.
    const hostile = diagnoseMeterlessFailure(
      { code: "timeout", httpStatus: 500 } as unknown as { code: "timeout"; httpStatus?: number },
      "investigation",
    );
    expect(JSON.stringify(hostile)).not.toContain("Bearer");
  });

  it("8. unknown diagnosis is explicit and never success", () => {
    const d = unknownFallbackDiagnosis("investigation");
    expect(d).toMatchObject({ stage: "investigation", reason: "unknown", responded: false });
    expect(typeof d.detail).toBe("string");
    const deliberate = deliberateHeuristicDiagnosis("planner", "direct-answer intent route");
    expect(deliberate.reason).toBe("deliberate_heuristic_route");
    expect(deliberate.responded).toBe(true);
  });

  it("9. investigation fallback is traced and returned, not swallowed", async () => {
    clearLedger("fb-1");
    const seen: { kind: string; data?: unknown }[] = [];
    const failure = diagnoseMeterlessFailure({ code: "timeout" }, "investigation", { elapsedMs: 120000 });
    const r = await runReasoningCycle({
      task: runnerTask("fb-1"),
      acceptance: ["Explain the safe method"],
      ceiling: "Medium",
      model: { complete: async () => ({ text: "Heuristic analysis for: x", provenance: "heuristic-demo", fallback: failure }) },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: false, error: "No planned step", provenance: "test" }) },
      maxCycles: 3,
      onTrace: async (kind, title, _detail, data) => {
        seen.push({ kind: `${kind}:${title}`, data });
      },
    });
    expect(r.fallbacks).toHaveLength(1);
    expect(r.fallbacks[0]).toMatchObject({ stage: "investigation", reason: "timeout" });
    const evidence = seen.find((e) => e.kind === "model_response:investigate evidence");
    expect(evidence).toBeDefined();
    expect((evidence?.data as { fallback?: { reason?: string } } | undefined)?.fallback?.reason).toBe("timeout");
    expect(r.outcome).not.toBe("completed");
  });

  it("10. unexplained heuristic provenance is recorded as unknown, provider answers stay clean", async () => {
    clearLedger("fb-2");
    const seen: unknown[] = [];
    const r = await runReasoningCycle({
      task: runnerTask("fb-2"),
      acceptance: ["Explain the safe method"],
      ceiling: "Medium",
      model: { complete: async () => ({ text: "Heuristic analysis for: x", provenance: "heuristic-demo" }) },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: false, error: "No planned step", provenance: "test" }) },
      maxCycles: 3,
      onTrace: async (_k, _t, _d, data) => {
        seen.push(data);
      },
    });
    expect(r.fallbacks.length).toBeGreaterThan(0);
    expect(r.fallbacks[0]?.reason).toBe("unknown");

    clearLedger("fb-3");
    const seenOk: unknown[] = [];
    const rOk = await runReasoningCycle({
      task: runnerTask("fb-3"),
      acceptance: ["Explain the safe method"],
      ceiling: "Medium",
      model: { complete: async () => ({ text: "Use fs.list read-only.", provenance: "test-model:v1" }) },
      memory: { search: async () => [] },
      tools: { exec: async () => ({ ok: false, error: "No planned step", provenance: "test" }) },
      maxCycles: 3,
      onTrace: async (_k, _t, _d, data) => {
        seenOk.push(data);
      },
    });
    expect(rOk.fallbacks).toHaveLength(0);
    expect(seenOk.some((d) => (d as { fallback?: unknown } | undefined)?.fallback !== undefined)).toBe(false);
  });

  it("11. startAndRun persists planner and investigation diagnoses on the failed task", async () => {
    await isolatedEnv();
    setEnv({ METERLESS_API_KEY: "test-key", METERLESS_MODEL: "test-model" });
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    mockedCompleteChat.mockResolvedValue(
      failResult({ ok: false, code: "timeout", error: "Meterless timed out after 1000ms." }),
    );
    const { task } = await startAndRun("What is the safest way to list directory contents?");
    expect(task.status).toBe("failed");
    expect(task.verification?.passed).toBe(false);
    expect(task.resultSummary).not.toBe(".");
    expect(task.resultSummary).not.toBe("");
    const fallbacks = task.providerFallbacks ?? [];
    expect(fallbacks.some((f) => f.stage === "planner" && f.reason === "timeout")).toBe(true);
    expect(fallbacks.some((f) => f.stage === "investigation" && f.reason === "timeout")).toBe(true);
    for (const f of fallbacks) {
      expect(JSON.stringify(f)).not.toContain("test-key");
    }
    const trace = await getTrace(task.id);
    const planEvent = trace.events.find((e) => e.title === "Heuristic demo plan");
    expect((planEvent?.data as { fallback?: { reason?: string } } | undefined)?.fallback?.reason).toBe("timeout");
    const evidenceEvent = trace.events.find((e) => e.kind === "model_response");
    expect((evidenceEvent?.data as { fallback?: { stage?: string } } | undefined)?.fallback?.stage).toBe("investigation");
  });
});
