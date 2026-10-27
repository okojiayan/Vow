import { afterEach, describe, expect, it } from "vitest";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { submitCandidate } from "@/core/memory/lifecycle";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../helpers";

// Isolated M01-style fixture: scratch conversation, unique seeded fact, full
// task lifecycle. Offline-safe: without a model key the analysis step is a
// heuristic fallback, which verification must honestly reject (no provider).
describe("memory-recall lifecycle (isolated fixture)", () => {
  afterEach(async () => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
  });

  it("issues memory.search, retrieves the seeded fact, never stores junk", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const fact = "The harbor ferry departs at 07:40 sharp.";
    const seeded = await submitCandidate({
      content: fact,
      kind: "semantic",
      conversationId: "fixture-convo-recall",
      source: { type: "user", ref: "fixture-seed" },
      provenance: "user-explicit:fixture",
      idempotencyKey: "fixture-recall-001",
    });
    expect(seeded.stored).toBe(true);

    const { task } = await startAndRun(
      "From project memory, when does the harbor ferry depart? Reply with the time.",
      "fixture-convo-recall",
    );
    const tools = (task.plan?.steps ?? []).map((s) => s.action?.tool ?? "analysis");
    // No unrelated filesystem listing or observation storing.
    expect(tools).not.toContain("fs.list");
    expect(tools).toContain("memory.search");
    const trace = await getTrace(task.id);
    const memCall = trace.events.find(
      (e) => e.kind === "tool_call" && e.title === "Tool memory.search",
    );
    expect(memCall).toBeTruthy();
    // Seeded record actually returned through the tool boundary.
    const memStep = task.plan?.steps.find((s) => s.action?.tool === "memory.search");
    const output = (memStep?.output as Array<{ content?: string }> | undefined) ?? [];
    expect(output.some((r) => (r.content ?? "").includes("07:40"))).toBe(true);
    // Offline heuristic analysis must not verify as grounded memory answer.
    expect(task.status).toBe("failed");
    expect(task.error ?? "").toMatch(/heuristic|ground|unverified/i);
  });
});
