import { describe, expect, it } from "vitest";
import {
  consumeMatchingApproval,
  createApproval,
  decideApproval,
  findUsableApproval,
  listApprovals,
} from "@/core/warden/approval-service";
import { cancelNow, createTask } from "@/core/agent/orchestrator";
import { getTask } from "@/core/agent/task-store";
import { isolatedEnv } from "../../helpers";

describe("orphaned approvals", () => {
  it("a cancelled-task approval cannot be approved", async () => {
    await isolatedEnv();
    const { task } = await createTask("write a note");
    const grant = await createApproval({
      taskId: task.id,
      tool: "notes.create",
      args: { title: "t" },
    });
    const cancelled = await cancelNow(task, "user cancelled");
    expect(cancelled.status).toBe("cancelled");
    await expect(decideApproval(grant.id, "approve")).rejects.toThrow(/cancel/i);
    const stored = (await listApprovals()).find((a) => a.id === grant.id);
    expect(stored?.status).toBe("cancelled");
    expect((await getTask(task.id))?.status).toBe("cancelled");
  });

  it("a voided approval executes nothing", async () => {
    await isolatedEnv();
    const { task } = await createTask("write a note");
    await createApproval({
      taskId: task.id,
      tool: "notes.create",
      args: { title: "t" },
    });
    await cancelNow(task, "user cancelled");
    expect(
      await consumeMatchingApproval({ tool: "notes.create", args: { title: "t" }, taskId: task.id }),
    ).toBeNull();
    expect(
      await findUsableApproval({ tool: "notes.create", args: { title: "t" }, taskId: task.id }),
    ).toBeNull();
    // No leak to other tasks when the lookup is unscoped.
    expect(await consumeMatchingApproval({ tool: "notes.create", args: { title: "t" } })).toBeNull();
    expect((await getTask(task.id))?.status).toBe("cancelled");
  });
});
