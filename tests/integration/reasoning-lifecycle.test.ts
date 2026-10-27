import { describe, expect, it } from "vitest";
import { continueTask, startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { decideApproval } from "@/core/warden/approval-service";
import { updateSettings } from "@/core/settings";
import { getLedger } from "@/core/reasoning/ledger";
import { isolatedEnv } from "../helpers";

describe("reasoning-driven application lifecycle", () => {
  it("controller visibly drives a successful task", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute 21 * 2 + 8");
    expect(task.status).toBe("completed");
    const trace = await getTrace(task.id);
    const ops = trace.events.filter((e) => e.title.startsWith("Controller →")).map((e) => e.title);
    expect(ops).toContain("Controller → execute_tool");
    expect(ops).toContain("Controller → verify");
    expect(trace.events.some((e) => e.kind === "verification" && e.title === "Verified")).toBe(true);
    expect(getLedger(task.id).length).toBeGreaterThan(0);
  });

  it("Light ceiling still completes cheap work within budget", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute 7 + 6", undefined, { effortCeiling: "Light" });
    expect(task.status).toBe("completed");
    const trace = await getTrace(task.id);
    const toolCalls = trace.events.filter((e) => e.kind === "tool_call" && e.title.startsWith("Tool ok:"));
    expect(toolCalls.length).toBeLessThanOrEqual(2);
  });

  it("doomed tool retries are bounded and end honestly unverified with root cause", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Query Pikachu abilities from pokeapi.pikachu_abilities_table", undefined, { effortCeiling: "Light" });
    expect(task.status).toBe("failed");
    expect(task.error ?? "").toMatch(/unverified/i);
    expect(task.error ?? "").toMatch(/Zetaris API key is not configured/i);
    const trace = await getTrace(task.id);
    const toolCalls = trace.events.filter((e) => e.kind === "tool_call" && e.title.startsWith("Tool ok:"));
    expect(toolCalls.length).toBeLessThanOrEqual(2);
    expect(task.status).not.toBe("completed");
  });

  it("approval pause and resume still pass through Warden", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "supervised" });
    const first = await startAndRun("Create a note titled gated with body needs approval");
    expect(first.task.status).toBe("awaiting_approval");
    expect(first.task.pendingApprovalId).toBeTruthy();
    await decideApproval(first.task.pendingApprovalId!, "approve");
    const resumed = await continueTask(first.task.id);
    expect(["completed", "executing", "failed"]).toContain(resumed.status);
    const trace = await getTrace(first.task.id);
    expect(trace.events.some((e) => e.kind === "policy_decision")).toBe(true);
  });
});

describe("structured terminal outcomes on the real path", () => {
  it("completed task carries a machine-readable outcome in record and trace", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute 3 * 3 + 1");
    expect(task.status).toBe("completed");
    expect(task.outcome?.outcome).toBe("completed");
    expect(task.outcome?.acceptanceSatisfied).toBeGreaterThan(0);
    const trace = await getTrace(task.id);
    const outcomeEvents = trace.events.filter((e) => e.data && typeof e.data === "object" && "outcome" in (e.data as Record<string, unknown>));
    expect(outcomeEvents.length).toBeGreaterThan(0);
  });
  it("unverified task reports failed status with unverified outcome, not success", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Query Pikachu abilities from pokeapi.pikachu_abilities_table", undefined, { effortCeiling: "Light" });
    expect(task.status).toBe("failed");
    expect(task.outcome?.outcome).toBe("unverified");
  });
});
