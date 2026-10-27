import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";
import { saveTask } from "@/core/agent/task-store";
import { recordReceipt } from "@/core/execution/reversals";
import { buildTaskLabel, explainBlocked, notChecked } from "@/core/warden/task-label";
import { buildUseReceipt } from "@/core/warden/use-receipt";
import { recordAudit } from "@/core/warden/audit";
import type { AgentTask } from "@/core/agent/types";

async function makeTask(partial: Partial<AgentTask> & { id: string; request: string }): Promise<AgentTask> {
  const now = new Date().toISOString();
  return saveTask({
    conversationId: "conv-test",
    status: "completed",
    plan: null,
    currentStepId: null,
    pendingApprovalId: null,
    resultSummary: null,
    verification: null,
    error: null,
    inferenceMode: "heuristic-demo",
    autonomyMode: null,
    queuedAt: null,
    claimedAt: null,
    claimedBy: null,
    cancelRequested: false,
    cancelReason: null,
    attempts: 0,
    parentTaskId: null,
    allowedTools: null,
    lastHeartbeat: null,
    outcome: null,
    usage: undefined,
    createdAt: now,
    updatedAt: now,
    ...partial,
  } as AgentTask);
}

describe("phase2 task label + not checked + use receipt", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });
  it("labels reads/writes from real receipts; undoable only with supported reversals", async () => {
    await isolatedEnv();
    const id = `t-label-${Date.now()}`;
    await makeTask({ id, request: "summarize the sandbox notes", status: "completed" });
    await recordReceipt({ taskId: id, tool: "fs.read", target: "demo/sandbox/a.txt", args: { path: "demo/sandbox/a.txt" }, outcome: "ok", reversible: false });
    await recordReceipt({ taskId: id, tool: "notes.create", target: "notes/x.md", args: { title: "x", body: "y" }, outcome: "ok", reversible: true, reversalKind: "delete-created-file", backupId: "bk-none" });
    const label = await buildTaskLabel(id);
    expect(label.reads).toContain("fs.read");
    expect(label.writes).toContain("notes.create");
    expect(label.plannedVsOccurred.occurred).toBe(2);
    expect(label.undoable).toBe(false);
    // Secret redaction in the stored receipt args.
    await recordReceipt({ taskId: id, tool: "fs.write", target: "demo/sandbox/s.txt", args: { path: "demo/sandbox/s.txt", content: "api_key=sk-live-12345678" }, outcome: "error", reversible: false });
    const { listReceipts } = await import("@/core/execution/reversals");
    const all = await listReceipts(id);
    expect(JSON.stringify(all)).not.toContain("sk-live-12345678");
  });
  it("not checked is non-vacuous: lists real gaps, empty only when truly verified", async () => {
    await isolatedEnv();
    const bad = `t-gaps-${Date.now()}`;
    await makeTask({
      id: bad,
      request: "do things",
      status: "failed",
      plan: { summary: "p", steps: [{ id: "s1", title: "Write file", instruction: "w", action: { tool: "fs.write", args: {}, }, requiresApproval: false, status: "failed", error: "disk full" }], inferenceMode: "heuristic-demo" },
      verification: { passed: false, explanation: "Acceptance not met.", evidence: [] },
    });
    const gaps = await notChecked(bad);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    const good = `t-clean-${Date.now()}`;
    await makeTask({
      id: good,
      request: "read a file",
      status: "completed",
      plan: { summary: "p", steps: [{ id: "s1", title: "Read", instruction: "r", action: { tool: "fs.read", args: {} }, requiresApproval: false, status: "verified" }], inferenceMode: "heuristic-demo" },
      verification: { passed: true, explanation: "All checks passed.", evidence: [] },
    });
    expect(await notChecked(good)).toEqual([]);
  });
  it("use receipt carries provenance, limitations, and authorship disclaimer", async () => {
    await isolatedEnv();
    const id = `t-use-${Date.now()}`;
    await makeTask({ id, request: "draft a summary", status: "completed", verification: { passed: true, explanation: "ok", evidence: [] } });
    await recordReceipt({ taskId: id, tool: "memory.search", args: { query: "q" }, outcome: "ok", reversible: false });
    const receipt = await buildUseReceipt(id);
    expect(receipt.objective).toBe("draft a summary");
    expect(receipt.toolsInvoked).toContain("memory.search");
    expect(receipt.verification.performed).toBe(true);
    expect(receipt.disclaimer).toMatch(/does not prove independent authorship/);
  });
  it("replay explains a real denial and never executes it", async () => {
    await isolatedEnv();
    const id = `t-replay-${Date.now()}`;
    await recordAudit({ kind: "block", taskId: id, tool: "fs.write", decision: "deny", policy: "house-rule.no-auto-delete", reason: "Denied by House Rule.", outcome: "blocked" });
    const replay = await explainBlocked(id, "fs.write");
    expect(replay.blockedBy).toMatch(/house-rule/);
    expect(replay.observedFacts.length).toBeGreaterThan(0);
    expect(replay.hypothetical.some((h) => /hypothetical/i.test(h))).toBe(true);
    expect(replay.toPermit.length).toBeGreaterThan(0);
    const { existsSync } = await import("node:fs");
    expect(existsSync("data/workspace/REPLAY_MUST_NOT_EXIST.txt")).toBe(false);
    await expect(explainBlocked(id, "http.fetch")).rejects.toThrow(/real denials only/);
  });
});
