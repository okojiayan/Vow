import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";

// Cross-system integration: security-sensitive interactions across
// Warden/executor, approvals, budget, receipts/rewind, memory forget, and
// verification. All isolated; no live sponsor calls.
describe("release-candidate cross-system (isolated)", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });

  it("unauthorized shell.exec is denied in autonomous mode (no bypass)", async () => {
    await isolatedEnv();
    const { executeTool } = await import("@/core/execution/executor");
    const out = await executeTool({ taskId: "t-x-1", tool: "shell.exec", args: { cmd: "rm -rf /" }, mode: "autonomous" });
    expect(out.status).toBe("denied");
  });

  it("expired approval cannot be consumed", async () => {
    await isolatedEnv();
    const { createApproval, consumeMatchingApproval } = await import("@/core/warden/approval-service");
    const grant = await createApproval({ taskId: "t-x-2", tool: "fs.write", args: { path: "a.txt" }, target: "a.txt" });
    // Force expiry by rewriting the store record.
    const { dataPath, mutateJsonFile } = await import("@/lib/persistence");
    const { getEnv } = await import("@/lib/env");
    const store = dataPath(getEnv().VOW_DATA_DIR, "approvals.json");
    void store;
    await mutateJsonFile<unknown[]>(dataPath("approvals.json"), [], (cur) =>
      (cur as Array<Record<string, unknown>>).map((r) => (r.id === grant.id ? { ...r, expiresAt: new Date(Date.now() - 1000).toISOString() } : r)),
    );
    const consumed = await consumeMatchingApproval({ taskId: "t-x-2", tool: "fs.write", args: { path: "a.txt" }, target: "a.txt" });
    expect(consumed).toBeNull();
  });

  it("concurrent budget consumers cannot overspend", async () => {
    await isolatedEnv();
    const { createBudget, tryConsumeBudget, getBudget } = await import("@/core/remote/budget");
    const b = await createBudget({ maxUnits: 2, scope: "away" });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => tryConsumeBudget({ budgetId: b.id, tool: "notes.create", taskId: `t-x-3-${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect((await getBudget(b.id))?.remaining).toBe(0);
  });

  it("interrupted rewind: non-reversible receipt cannot be undone; preview skips it", async () => {
    await isolatedEnv();
    const { recordReceipt, undoReceipt, previewRewind } = await import("@/core/execution/reversals");
    const taskId = `t-x-4-${Date.now()}`;
    const rc = await recordReceipt({ taskId, tool: "shell.exec", args: { cmd: "x" }, outcome: "ok", reversible: false });
    expect((await undoReceipt(rc.id)).ok).toBe(false);
    const preview = await previewRewind(taskId, new Date(0).toISOString());
    expect(preview.skipped.some((s) => s.receiptId === rc.id)).toBe(true);
  });

  it("forgotten memory is unretrievable and unrestorable", async () => {
    await isolatedEnv();
    const { submitCandidate } = await import("@/core/memory/lifecycle");
    const { forgetMemory, history } = await import("@/core/memory/time-machine");
    const { retrieveRelevant } = await import("@/core/memory/retriever");
    const created = await submitCandidate({ content: "Cross-system canary zephyrquill-9.", kind: "semantic", source: { type: "user", ref: "t" }, provenance: "user-explicit:test", accountId: "local" });
    expect(created.stored).toBe(true);
    const id = created.stored ? created.record.id : "";
    const forgot = await forgetMemory(id, { accountId: "local" });
    expect(forgot.ok).toBe(true);
    const { listMemories } = await import("@/core/memory/source-store");
    const remaining = (await listMemories()).filter((m) => m.id === id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("deleted");
    expect(JSON.stringify(remaining[0])).not.toContain("zephyrquill-9");
    expect(retrieveRelevant(remaining as never, "zephyrquill-9")).toHaveLength(0);
    const h = await history(id, "local");
    expect(h.status).toMatch(/deleted|forgotten|not-found/i);
  });

  it("misleading tool-only success claim does not verify", async () => {
    await isolatedEnv();
    const { verifySteps } = await import("@/core/verification/verifier");
    const v = await verifySteps(
      [
        { id: "a", action: { tool: "fs.list", args: { path: "." } }, output: [{ name: "README.md" }] },
        { id: "b", action: { tool: "memory.store", args: {} }, output: { record: { id: "m1" } } },
      ] as never,
      "What is the sale price after discount?",
    );
    expect(v.passed).toBe(false);
  });
});
