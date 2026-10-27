import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";
import { addContact, revokeContact, buildAwayReport, canContactApprove, contactUsable } from "@/core/remote/contacts";
import { createBudget, tryConsumeBudget, getBudget } from "@/core/remote/budget";
import { createTaskPass, parkAction } from "@/core/keep/task-pass";
import { saveTask } from "@/core/agent/task-store";

describe("phase3 contacts + budget (isolated)", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });

  it("consent is per-purpose; revocation and expiry fail closed; reports minimized", async () => {
    await isolatedEnv();
    const c = await addContact({ label: "Asha", purposes: ["view_report"], ttlMs: 60_000 });
    expect(contactUsable(c, "view_report")).toBe(true);
    expect(contactUsable(c, "approve_delegated")).toBe(false);
    const pass = await createTaskPass({ task_id: "t-ct-1", mode: "smart" });
    await saveTask({ id: pass.task_id, conversationId: "c1", request: "pay vendor", status: "executing", plan: null, currentStepId: null, pendingApprovalId: null, resultSummary: null, verification: null, error: null, inferenceMode: "heuristic-demo", autonomyMode: null, queuedAt: null, claimedAt: null, claimedBy: null, cancelRequested: false, cancelReason: null, attempts: 0, parentTaskId: null, allowedTools: null, lastHeartbeat: null, outcome: null, usage: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never);
    const report = await buildAwayReport(pass.task_id, c.id) as Record<string, unknown>;
    expect(report.simulated_delivery).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/sk-live|Bearer|password/i);
    expect(report).not.toHaveProperty("memories");
    await revokeContact(c.id);
    const { listContacts } = await import("@/core/remote/contacts");
    const revoked = (await listContacts()).find((x) => x.id === c.id)!;
    expect(contactUsable(revoked, "view_report")).toBe(false);
    await expect(buildAwayReport(pass.task_id, c.id)).rejects.toThrow(/not authorized/i);
  });

  it("delegated approval is narrow; outside scope denied", async () => {
    await isolatedEnv();
    const c = await addContact({ label: "Ravi", purposes: ["approve_delegated"], delegatedActions: ["money.cancel"] });
    const pass = await createTaskPass({ task_id: "t-ct-2", mode: "smart" });
    const okItem = await parkAction({ task_id: pass.task_id, action: "money.cancel", consequence: "c" });
    const badItem = await parkAction({ task_id: pass.task_id, action: "money.send", consequence: "c" });
    expect((await canContactApprove(c.id, okItem.id)).ok).toBe(true);
    expect((await canContactApprove(c.id, badItem.id)).ok).toBe(false);
  });

  it("budget consumes atomically, exhausts, rejects ineligible tools", async () => {
    await isolatedEnv();
    const b = await createBudget({ maxUnits: 2, scope: "away" });
    const r1 = await tryConsumeBudget({ budgetId: b.id, tool: "notes.create", taskId: "t1" });
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(1);
    const bad = await tryConsumeBudget({ budgetId: b.id, tool: "money.send", taskId: "t1" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/not budget-eligible/i);
    expect((await getBudget(b.id))?.remaining).toBe(1);
    expect((await tryConsumeBudget({ budgetId: b.id, tool: "notes.create", taskId: "t1" })).ok).toBe(true);
    const exhausted = await tryConsumeBudget({ budgetId: b.id, tool: "notes.create", taskId: "t1" });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.reason).toMatch(/exhausted/i);
  });
});
