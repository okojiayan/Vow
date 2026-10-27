import { describe, expect, it } from "vitest";
import {
  consumeMatchingApproval,
  createApproval,
  decideApproval,
  fingerprintAction,
} from "@/core/warden/approval-service";
import { isolatedEnv } from "../../helpers";

describe("action-specific approvals", () => {
  it("rejects replay and modified arguments", async () => {
    await isolatedEnv();
    const grant = await createApproval({
      taskId: "t1",
      tool: "fs.write",
      args: { path: "n.md", content: "one" },
      target: "n.md",
    });
    await decideApproval(grant.id, "approve");
    const first = await consumeMatchingApproval({
      tool: "fs.write",
      args: { path: "n.md", content: "one" },
      target: "n.md",
    });
    expect(first?.status).toBe("consumed");
    const replay = await consumeMatchingApproval({
      tool: "fs.write",
      args: { path: "n.md", content: "one" },
      target: "n.md",
    });
    expect(replay).toBeNull();
    const original = fingerprintAction("fs.write", { path: "n.md", content: "one" }, "n.md");
    const modified = fingerprintAction("fs.write", { path: "n.md", content: "two" }, "n.md");
    expect(original).not.toBe(modified);
    const mismatched = await consumeMatchingApproval({
      tool: "fs.write",
      args: { path: "n.md", content: "two" },
      target: "n.md",
    });
    expect(mismatched).toBeNull();
  });

  it("binds approval to specific taskId and rejects consumption by another task", async () => {
    await isolatedEnv();
    const grant = await createApproval({
      taskId: "task_owner",
      tool: "fs.write",
      args: { path: "auth.txt", content: "secret" },
      target: "auth.txt",
    });
    await decideApproval(grant.id, "approve");

    // Another task tries to consume task_owner's approval
    const otherTaskAttempt = await consumeMatchingApproval({
      tool: "fs.write",
      args: { path: "auth.txt", content: "secret" },
      target: "auth.txt",
      taskId: "task_impostor",
    });
    expect(otherTaskAttempt).toBeNull();

    // The genuine owner task consumes it successfully
    const ownerAttempt = await consumeMatchingApproval({
      tool: "fs.write",
      args: { path: "auth.txt", content: "secret" },
      target: "auth.txt",
      taskId: "task_owner",
    });
    expect(ownerAttempt?.status).toBe("consumed");
  });
});
