import { describe, expect, it } from "vitest";
import { updateSettings } from "@/core/settings";
import { listApprovals, decideApproval } from "@/core/warden/approval-service";
import { getTask, saveTask } from "@/core/agent/task-store";
import { enqueueTask, claimNextTask, requestCancellation, recoverStaleTasks, requeueInterrupted } from "@/core/agent/queue";
import { drainQueue } from "@/core/agent/worker";
import { continueTask } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { isolatedEnv } from "../../helpers";

describe("Warden Away Mode", () => {
  it("enqueues without running to completion in the request", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await enqueueTask("Compute 21 * 2 + 8", undefined, "autonomous");
    expect(task.status).toBe("queued");
    expect(task.queuedAt).toBeTruthy();
    expect(task.attempts).toBe(0);
    const trace = await getTrace(task.id);
    expect(trace.events.some((e) => e.kind === "task_queued")).toBe(true);
  });

  it("worker claims exclusively and completes an authorized task", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await enqueueTask("Compute 21 * 2 + 8", undefined, "autonomous");
    const processed = await drainQueue(5, "test-worker-1");
    expect(processed).toContain(task.id);
    const done = await getTask(task.id);
    expect(done?.status).toBe("completed");
    expect(done?.verification?.passed).toBe(true);
    const trace = await getTrace(task.id);
    const kinds = trace.events.map((e) => e.kind);
    expect(kinds).toContain("task_queued");
    expect(kinds).toContain("task_claimed");
    expect(kinds).toContain("policy_decision");
    expect(kinds).toContain("completed");
    // Second drain must not duplicate work.
    const again = await drainQueue(5, "test-worker-1");
    expect(again).not.toContain(task.id);
    const stable = await getTask(task.id);
    expect(stable?.status).toBe("completed");
  });

  it("blocks unauthorized actions before invocation in autonomous mode", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await enqueueTask("Run a shell command to cat /etc/passwd", undefined, "autonomous");
    await drainQueue(5, "test-worker-1");
    const done = await getTask(task.id);
    expect(done?.status).toBe("blocked");
    expect(done?.error ?? "").toMatch(/denied|Warden/i);
    const trace = await getTrace(task.id);
    expect(trace.events.some((e) => e.kind === "policy_decision" || e.kind === "blocked")).toBe(true);
  });

  it("pauses for approval and resumes only after valid approval", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "supervised" });
    const { task } = await enqueueTask("Create a note titled gated with body needs approval", undefined, "supervised");
    await drainQueue(5, "test-worker-1");
    const paused = await getTask(task.id);
    expect(paused?.status).toBe("awaiting_approval");
    expect(paused?.pendingApprovalId).toBeTruthy();
    // Worker must not proceed while paused.
    const idle = await drainQueue(5, "test-worker-1");
    expect(idle).not.toContain(task.id);

    const approvals = await listApprovals();
    const pending = approvals.find((a) => a.taskId === task.id && a.status === "pending");
    expect(pending).toBeTruthy();
    await decideApproval(pending!.id, "approve");
    const resumed = await continueTask(task.id);
    expect(["completed", "failed", "executing", "verifying"]).toContain(resumed.status);
    const final = await getTask(task.id);
    expect(final?.status).toBe("completed");
  });

  it("cancellation stops queued work and prevents retries", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await enqueueTask("Compute 21 * 2 + 8", undefined, "autonomous");
    await requestCancellation(task.id, "User cancelled.");
    const cancelled = await getTask(task.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelRequested).toBe(true);
    const processed = await drainQueue(5, "test-worker-1");
    expect(processed).not.toContain(task.id);
    const stable = await getTask(task.id);
    expect(stable?.status).toBe("cancelled");
  });

  it("recovers interrupted work conservatively without blind duplication", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await enqueueTask("Compute 21 * 2 + 8", undefined, "autonomous");
    // Simulate a crash mid-execution: claimed but never finished.
    const claimed = await claimNextTask("crashed-worker");
    expect(claimed?.id).toBe(task.id);
    const mid = await getTask(task.id);
    // Force into executing to emulate a crash during runRemainingSteps.
    await saveTask({ ...mid!, status: "executing", lastHeartbeat: new Date(0).toISOString() });
    const recovered = await recoverStaleTasks();
    expect(recovered.some((t) => t.id === task.id)).toBe(true);
    const parked = await getTask(task.id);
    expect(parked?.status).toBe("interrupted");
    await requeueInterrupted(task.id);
    await drainQueue(5, "recovery-worker");
    const done = await getTask(task.id);
    expect(done?.status).toBe("completed");
    expect(done?.verification?.passed).toBe(true);
  });

  it("prevents two workers from claiming the same job", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await enqueueTask("Compute 21 * 2 + 8", undefined, "autonomous");
    const first = await claimNextTask("worker-a");
    expect(first?.id).toBe(task.id);
    const second = await claimNextTask("worker-b");
    expect(second).toBeNull();
  });
});

describe("stale approval rejection", () => {
  it("rejects expired approvals before execution", async () => {
    const { createApproval, findUsableApproval, consumeMatchingApproval } = await import(
      "@/core/warden/approval-service"
    );
    const { readFile, writeFile } = await import("node:fs/promises");
    const { default: path } = await import("node:path");
    await isolatedEnv();
    const grant = await createApproval({
      taskId: "t-exp",
      tool: "fs.write",
      args: { path: "x.md", content: "x" },
      target: "x.md",
    });
    // Force expiry by backdating the stored record (TTL is 15 min in production).
    const store = path.resolve(process.env.VOW_DATA_DIR as string, "approvals.json");
    const raw = JSON.parse(await readFile(store, "utf8"));
    await writeFile(store, JSON.stringify(raw.map((a: { id: string }) => (a.id === grant.id ? { ...a, expiresAt: new Date(Date.now() - 1000).toISOString() } : a))));
    expect(await findUsableApproval({ tool: "fs.write", args: { path: "x.md", content: "x" }, target: "x.md", taskId: "t-exp" })).toBeNull();
    expect(await consumeMatchingApproval({ tool: "fs.write", args: { path: "x.md", content: "x" }, target: "x.md", taskId: "t-exp" })).toBeNull();
  });
});

describe("worker tick endpoint guard", () => {
  it("rate-limits anonymous bursts and enforces the worker token when set", async () => {
    const { checkTickAccess, resetTickRateLimit } = await import("@/core/agent/worker-guard");
    resetTickRateLimit();
    const base = { authorizationHeader: null as string | null, workerToken: "", rateLimitPerMinute: 3, now: 1_000_000 };
    expect(checkTickAccess(base).status).toBe(200);
    expect(checkTickAccess(base).status).toBe(200);
    expect(checkTickAccess(base).status).toBe(200);
    expect(checkTickAccess(base)).toMatchObject({ authorized: false, status: 429 });

    const authed = { authorizationHeader: "Bearer s3cret", workerToken: "s3cret", rateLimitPerMinute: 3, now: 2_000_000 };
    expect(checkTickAccess(authed)).toMatchObject({ authorized: true, status: 200 });
    const wrong = { ...authed, authorizationHeader: "Bearer wrong" };
    expect(checkTickAccess(wrong)).toMatchObject({ authorized: false, status: 401 });
    const missing = { ...authed, authorizationHeader: null };
    expect(checkTickAccess(missing)).toMatchObject({ authorized: false, status: 401 });
  });
});
