import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";

describe("phase2 cooling period", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });
  it("stages a delay after approval, blocks before expiry, never auto-executes", async () => {
    await isolatedEnv();
    const { registerBuiltinTools } = await import("@/core/execution/builtin-tools");
    const { executeTool } = await import("@/core/execution/executor");
    const { decideApproval } = await import("@/core/warden/approval-service");
    registerBuiltinTools();
    const taskId = `t-cool-${Date.now()}`;
    const args = { path: "demo/sandbox/cooling-probe.txt" };
    const first = await executeTool({ taskId, tool: "fs.delete", args, target: "demo/sandbox/cooling-probe.txt", mode: "autonomous" });
    expect(first.status).toBe("needs_approval");
    await decideApproval(first.approvalId!, "approve");
    const second = await executeTool({ taskId, tool: "fs.delete", args, target: "demo/sandbox/cooling-probe.txt", mode: "autonomous" });
    expect(second.status).toBe("needs_approval");
    expect(second.policy).toBe("cooling.pending");
    // Timer expiry alone changes nothing: still gated, still no execution.
    const third = await executeTool({ taskId, tool: "fs.delete", args, target: "demo/sandbox/cooling-probe.txt", mode: "autonomous" });
    expect(third.status).toBe("needs_approval");
    const { existsSync } = await import("node:fs");
    expect(existsSync("data/workspace/demo/sandbox/cooling-probe.txt")).toBe(false);
    // Cleanup: cancel the staged cooling.
    const { listCooling, cancelCooling } = await import("@/core/warden/cooling");
    const pending = (await listCooling(taskId)).find((r) => r.status === "waiting");
    expect(pending).toBeDefined();
    await cancelCooling(pending!.id);
    expect((await listCooling(taskId)).find((r) => r.id === pending!.id)?.status).toBe("cancelled");
  });
  it("injectable clock drives ready state; mode cannot bypass", async () => {
    const { startCooling, coolingStatus, cancelCooling } = await import("@/core/warden/cooling");
    const rec = await startCooling({ taskId: "t-clock", tool: "fs.delete", args: { path: "x" }, reason: "test", delayMs: 60_000, now: 1_000_000 });
    expect((await coolingStatus("t-clock", "fs.delete", { path: "x" }, undefined, 1_000_001)).status).toBe("waiting");
    expect((await coolingStatus("t-clock", "fs.delete", { path: "x" }, undefined, 1_000_000 + 60_001)).status).toBe("ready");
    await cancelCooling(rec.id);
  });
});

describe("phase2 time machine + forget", () => {
  const ACCT = "test-forget-acct";
  const TOKEN = "zephyrquill";
  it("versions, refuses silent overwrite, forced revert is recorded", async () => {
    await isolatedEnv();
    const { submitCandidate } = await import("@/core/memory/lifecycle");
    const { history, revertToVersion } = await import("@/core/memory/time-machine");
    const created = await submitCandidate({ content: `The ${TOKEN} notebook lives on the oak shelf.`, kind: "semantic", source: { type: "user", ref: "test" }, provenance: "user-explicit:test", accountId: ACCT });
    expect(created.stored).toBe(true);
    if (!created.stored) throw new Error("seed failed");
    const id = created.record.id;
    // Second version via upsert path (same record update).
    const { upsertMemory } = await import("@/core/memory/source-store");
    const current = (await import("@/core/memory/store-ops").then((m) => m.getMemory(id, ACCT)))!;
    await upsertMemory({ ...current, id, content: `The ${TOKEN} notebook moved to the maple drawer.` });
    const h = await history(id, ACCT);
    expect(h.versions.length).toBeGreaterThanOrEqual(2);
    expect(h.currentContent).toMatch(/maple/);
    // Reverting to v1 while v2 is newer requires explicit force.
    const refused = await revertToVersion(id, 1, { accountId: ACCT });
    expect(refused.ok).toBe(false);
    const forcedNoReason = await revertToVersion(id, 1, { accountId: ACCT, force: true });
    expect(forcedNoReason.ok).toBe(false);
    const forced = await revertToVersion(id, 1, { accountId: ACCT, force: true, reason: "test revert" });
    expect(forced.ok).toBe(true);
    const h2 = await history(id, ACCT);
    expect(h2.currentContent).toMatch(/oak shelf/);
    expect(h2.versions.length).toBeGreaterThan(h.versions.length);
  });
  it("forget redacts everywhere and cannot be restored", async () => {
    const { submitCandidate } = await import("@/core/memory/lifecycle");
    const { retrieveRelevant } = await import("@/core/memory/retriever");
    const { forgetMemory, history, revertToVersion } = await import("@/core/memory/time-machine");
    const { listMemories } = await import("@/core/memory/source-store");
    const SECRET = `quixotic-${Date.now()}-ledger`;
    const created = await submitCandidate({ content: `My vault phrase is ${SECRET} do not share.`, kind: "semantic", entities: ["vault"], keywords: ["vault", "phrase"], source: { type: "user", ref: "test" }, provenance: "user-explicit:test", accountId: ACCT });
    if (!created.stored) throw new Error("seed failed");
    const id = created.record.id;
    const before = retrieveRelevant(await listMemories().then((all) => all.filter((r) => (r.accountId ?? "local") === ACCT)), `vault phrase ${SECRET}`);
    expect(before.map((r) => r.id)).toContain(id);
    const out = await forgetMemory(id, { accountId: ACCT, by: "test" });
    expect(out.ok).toBe(true);
    const after = await listMemories();
    const gone = after.find((r) => r.id === id)!;
    expect(gone.content).not.toContain(SECRET);
    expect(gone.keywords).toEqual([]);
    expect(gone.entities).toEqual([]);
    expect(gone.entityLinks ?? []).toEqual([]);
    expect(gone.versions.every((v) => !v.content.includes(SECRET))).toBe(true);
    const resurface = retrieveRelevant(after.filter((r) => (r.accountId ?? "local") === ACCT), `vault phrase ${SECRET}`);
    expect(resurface.map((r) => r.id)).not.toContain(id);
    expect((await history(id, ACCT)).currentContent).not.toContain(SECRET);
    expect((await revertToVersion(id, 1, { accountId: ACCT, force: true, reason: "x" })).ok).toBe(false);
  });
});
