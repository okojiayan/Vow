import { describe, expect, it } from "vitest";
import { continueTask, createTask, startAndRun } from "@/core/agent/orchestrator";
import { enqueueTask } from "@/core/agent/queue";
import { getTask } from "@/core/agent/task-store";
import { decideApproval } from "@/core/warden/approval-service";
import { updateSettings } from "@/core/settings";
import { getLedger } from "@/core/reasoning/ledger";
import { isolatedEnv } from "../helpers";

describe("effort ceiling persistence", () => {
  it("persists a valid ceiling and defaults invalid input to Medium", async () => {
    await isolatedEnv();
    const high = await createTask("q", undefined, "High");
    expect((await getTask(high.task.id))?.effortCeiling).toBe("High");
    const bad = await createTask("q", undefined, "Ultra");
    expect((await getTask(bad.task.id))?.effortCeiling).toBe("Medium");
  });
  it("enqueue threads the ceiling into the stored task", async () => {
    await isolatedEnv();
    const { task } = await enqueueTask("q", undefined, "autonomous", "Max");
    expect((await getTask(task.id))?.effortCeiling).toBe("Max");
  });
  it("ceiling survives approval continuation and governs the run", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "supervised" });
    const { task } = await startAndRun("Create a note titled gated with body needs approval", undefined, { effortCeiling: "Max" });
    expect(task.status).toBe("awaiting_approval");
    expect((await getTask(task.id))?.effortCeiling).toBe("Max");
    await decideApproval(task.pendingApprovalId!, "approve");
    const resumed = await continueTask(task.id);
    expect((await getTask(resumed.id))?.effortCeiling).toBe("Max");
    expect(getLedger(task.id).some((e) => e.title === "Reasoning started" && /Ceiling Max/.test(e.detail ?? ""))).toBe(true);
  });
});
