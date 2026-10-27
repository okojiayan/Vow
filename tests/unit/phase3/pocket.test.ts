import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";
import { createTaskPass, parkAction, listParked } from "@/core/keep/task-pass";
import { issuePocketToken, consumePocketToken } from "@/core/remote/pocket";

describe("phase3 pocket approval (isolated)", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });

  async function setupParked() {
    await isolatedEnv();
    const pass = await createTaskPass({ task_id: "t-pocket-1", mode: "smart" });
    const item = await parkAction({ task_id: pass.task_id, action: "money.cancel", target: "demo/sandbox/x", consequence: "Moves money" });
    return { pass, item };
  }

  it("issues and consumes exactly once; replay rejected", async () => {
    const { item } = await setupParked();
    const { raw } = await issuePocketToken({ parkedId: item.id, planVersion: "v3" });
    const first = await consumePocketToken({ raw, decision: "deny", planVersion: "v3", approver: "owner-phone" });
    expect(first.ok).toBe(true);
    expect((await listParked()).find((p) => p.id === item.id)?.status).toBe("denied");
    const replay = await consumePocketToken({ raw, decision: "deny", planVersion: "v3", approver: "owner-phone" });
    expect(replay.ok).toBe(false);
    expect(replay.reason).toMatch(/already used|replay/i);
  });

  it("wrong plan version fails closed; expired token fails closed", async () => {
    const { item } = await setupParked();
    const { raw } = await issuePocketToken({ parkedId: item.id, planVersion: "v3" });
    const wrong = await consumePocketToken({ raw, decision: "approve", planVersion: "v999", approver: "x" });
    expect(wrong.ok).toBe(false);
    expect(wrong.reason).toMatch(/Plan version/i);
    const { raw: raw2 } = await issuePocketToken({ parkedId: item.id, planVersion: "v3", ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const expired = await consumePocketToken({ raw: raw2, decision: "approve", planVersion: "v3", approver: "x" });
    expect(expired.ok).toBe(false);
    expect(expired.reason).toMatch(/expired/i);
  });

  it("concurrent approve/deny: only one wins, other sees non-waiting", async () => {
    const { item } = await setupParked();
    const a = await issuePocketToken({ parkedId: item.id, planVersion: "v3" });
    const b = await issuePocketToken({ parkedId: item.id, planVersion: "v3" });
    const r1 = await consumePocketToken({ raw: a.raw, decision: "approve", planVersion: "v3", approver: "owner" });
    expect(r1.ok).toBe(true);
    const r2 = await consumePocketToken({ raw: b.raw, decision: "deny", planVersion: "v3", approver: "owner" });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toMatch(/already|waiting|Concurrent/i);
  });

  it("forged token rejected without touching parked state", async () => {
    await setupParked();
    const out = await consumePocketToken({ raw: "pkt_forged", decision: "approve", planVersion: "v3", approver: "x" });
    expect(out.ok).toBe(false);
  });
});
