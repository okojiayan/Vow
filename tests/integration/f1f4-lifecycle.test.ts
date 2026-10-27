import { afterEach, describe, expect, it, vi } from "vitest";
import { heuristicPlan } from "@/core/agent/planner";
import { verifySteps } from "@/core/verification/verifier";
import { startAndRun } from "@/core/agent/orchestrator";
import { updateSettings } from "@/core/settings";
import { resetEnvCache } from "@/lib/env";
import { isolatedEnv } from "../helpers";
import type { PlanStep } from "@/core/agent/types";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: "t", instruction: "i", requiresApproval: false, status: "running", ...partial };
}

// F1+F4 targeted lifecycle: general fixtures (not benchmark IDs), isolated env,
// no production memory. Offline (no Meterless key) heuristic analysis must fail
// honestly, never verify as success. Mocked live-model analysis must verify.
describe("F1+F4 direct-answer and store lifecycle (isolated)", () => {
  afterEach(() => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
    delete process.env.METERLESS_API_KEY;
    vi.restoreAllMocks();
  });

  it("direct informational question plans analysis-only, no fs/memory mutations", async () => {
    const prompts = [
      "What is the principle of least privilege? Reply briefly.",
      "What is the capital of France? Reply briefly.",
      "Reply with valid JSON containing exactly the keys name and score, where score is 42.",
      "Is it safe to run a command that deletes everything from the filesystem root? Explain briefly.",
    ];
    for (const p of prompts) {
      const tools = heuristicPlan(p).steps.map((s) => (s.action ? s.action.tool : `analysis:${s.expectGrounding ?? "?"}`));
      expect(tools).toEqual(["analysis:none"]);
    }
  });

  it("discount word problem now routes to deterministic calc (general pattern)", async () => {
    const tools = heuristicPlan(
      "A $240 item is discounted 15%. What is the sale price? Reply with the number.",
    ).steps.map((s) => (s.action ? s.action.tool : `analysis:${s.expectGrounding ?? "?"}`));
    expect(tools).toEqual(["calc.evaluate"]);
  });

  it("M01-style recall plans memory.search + grounded analysis, never store-echo", async () => {
    const plan = heuristicPlan("From project memory, what is the Kestrel weekend deploy window?");
    const tools = plan.steps.map((s) => (s.action ? s.action.tool : `analysis:${s.expectGrounding ?? "?"}`));
    expect(tools).toEqual(["memory.search", "analysis:memory"]);
    expect(tools).not.toContain("fs.list");
    expect(tools).not.toContain("memory.store");
  });

  it("explicit store still plans memory.store", async () => {
    const plan = heuristicPlan("Remember that the harbor ferry departs at 07:40.");
    expect(plan.steps.map((s) => s.action?.tool)).toEqual(["memory.store"]);
  });

  it("offline direct-answer does not become a false success", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    resetEnvCache();
    const { task } = await startAndRun("What is the principle of least privilege? Reply briefly.");
    const tools = (task.plan?.steps ?? []).map((s) => s.action?.tool ?? "analysis");
    expect(tools).not.toContain("fs.list");
    expect(tools).not.toContain("memory.store");
    // Offline heuristic fallback must not verify; honest failure, not completed.
    expect(task.status).not.toBe("completed");
    expect(task.verification?.passed).not.toBe(true);
  });

  it("offline explicit store verifies as a genuine remember request", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Remember that the harbor ferry departs at 07:40.");
    expect(task.plan?.steps.map((s) => s.action?.tool)).toEqual(["memory.store"]);
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
  });

  it("irrelevant-output-only plan never verifies (old false-success shape)", async () => {
    const v = await verifySteps(
      [
        step({ id: "a", action: { tool: "fs.list", args: { path: "." } }, output: [{ name: "README.md" }] }),
        step({ id: "b", action: { tool: "memory.store", args: {} }, output: { record: { id: "m1" } } }),
      ],
      "What is the sale price after discount?",
    );
    expect(v.passed).toBe(false);
  });

  it("mocked live-model direct answer verifies without tools", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    process.env.METERLESS_API_KEY = "test-live-key";
    process.env.METERLESS_BASE_URL = "http://127.0.0.1:8088/v1";
    resetEnvCache();
    const originalFetch = globalThis.fetch;
    // Planning call returns invalid JSON -> intent guard falls back to demo analysis;
    // investigate call returns provider-backed answer.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          model: "nvidia/nemotron-3-ultra-550b-a55b",
          choices: [{ message: { content: "Least privilege means only the minimum necessary access." } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    try {
      const { task } = await startAndRun("What is the principle of least privilege? Reply briefly.");
      expect(calls).toBeGreaterThan(0);
      expect(task.status).toBe("completed");
      expect(task.verification?.passed).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("genuine tool task still executes calc through Warden", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute 21 * 2 + 8");
    expect(task.plan?.steps.some((s) => s.action?.tool === "calc.evaluate")).toBe(true);
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
  });

  it("failed required operation stays honest, never false-success", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Query Pikachu abilities from pokeapi.pikachu_abilities_table", undefined, { effortCeiling: "Light" });
    expect(task.status).not.toBe("completed");
    expect(task.verification?.passed).not.toBe(true);
  });
});
