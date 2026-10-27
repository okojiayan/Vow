import { describe, expect, it } from "vitest";
import { startAndRun } from "@/core/agent/orchestrator";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../helpers";

describe("task lifecycle", () => {
  it("completes a safe calc task with verification", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute 21 * 2 + 8");
    expect(task.status).toBe("completed");
    expect(task.verification?.passed).toBe(true);
    expect(task.plan?.steps.some((step) => step.action?.tool === "calc.evaluate")).toBe(true);
  });

  it("blocks unauthorized shell execution", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Run a shell command to cat /etc/passwd");
    expect(task.status).toBe("blocked");
    expect(task.error ?? "").toMatch(/denied|Warden/i);
  });

  it("pauses writes for approval in supervised mode", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "supervised" });
    const { task } = await startAndRun("Create a note titled gated with body needs approval");
    expect(task.status).toBe("awaiting_approval");
    expect(task.pendingApprovalId).toBeTruthy();
  });

  it("routes Pikachu ability requests to restricted SQL without fabricating rows", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Query Pikachu abilities from pokeapi.pikachu_abilities_table");
    expect(task.plan?.inferenceMode).toBe("deterministic");
    expect(task.plan?.steps.some((step) => step.action?.tool === "run_sql")).toBe(true);
    expect(task.status).toBe("failed");
    expect(task.error ?? "").toMatch(/Zetaris API key is not configured/i);
    expect(JSON.stringify(task.plan?.steps[0]?.output ?? {})).not.toMatch(/lightning-rod/);
  });
});
