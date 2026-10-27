import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";
import { collectSecurityEvents, communityFeed, DOJO_SCENARIOS, pinTrick, toSecurityEvent } from "@/core/safety/tricks";
import { recordAudit } from "@/core/warden/audit";

describe("phase2 trick collection + dojo + radar", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });
  it("distinguishes genuine attacks from ordinary policy enforcement", () => {
    const attack = toSecurityEvent({ id: "a1", kind: "block", taskId: "t", tool: "fs.read", decision: "deny", policy: "untrusted.hidden-instruction", reason: "flagged", outcome: "blocked", createdAt: new Date().toISOString() });
    expect(attack?.kind).toBe("attack-blocked");
    const enforcement = toSecurityEvent({ id: "a2", kind: "block", taskId: "t", tool: "fs.delete", decision: "deny", policy: "plan-lock.deviation", reason: "deviated", outcome: "blocked", createdAt: new Date().toISOString() });
    expect(enforcement?.kind).toBe("policy-enforcement");
    expect(toSecurityEvent({ id: "a3", kind: "policy", decision: "allow", policy: "p", reason: "ok", outcome: "success", createdAt: new Date().toISOString() })).toBeNull();
  });
  it("collects genuine events; pinning requires a real audit record", async () => {
    await isolatedEnv();
    await recordAudit({ kind: "block", taskId: `t-dojo-${Date.now()}`, tool: "http.fetch", decision: "deny", policy: "leak-check.outbound-block", reason: "Outbound payload blocked: detected pan. Evidence: AB•••1234• (PAN-like).", outcome: "blocked" });
    const events = await collectSecurityEvents();
    expect(events.some((e) => e.policy === "leak-check.outbound-block")).toBe(true);
    const target = events.find((e) => e.policy === "leak-check.outbound-block")!;
    const pinned = await pinTrick(target.auditId);
    expect(pinned.auditId).toBe(target.auditId);
    await expect(pinTrick("audit_nonexistent")).rejects.toThrow(/genuine events/);
  });
  it("dojo scenarios are synthetic, labeled, and execute nothing", async () => {
    expect(DOJO_SCENARIOS.length).toBeGreaterThanOrEqual(3);
    for (const s of DOJO_SCENARIOS) {
      expect(s.synthetic).toBe(true);
      expect(s.redFlags.length).toBeGreaterThan(0);
      expect(s.lesson.length).toBeGreaterThan(0);
    }
    // Scenarios are inert data: no tool names, no endpoints, nothing to run.
    for (const s of DOJO_SCENARIOS) {
      expect(s.message).not.toMatch(/execute|run (this|the command)/i);
    }
  });
  it("community sharing is explicitly simulated with no fabricated stats", () => {
    const feed = communityFeed();
    expect(feed.simulated).toBe(true);
    expect(feed.entries).toEqual([]);
    expect(feed.note).toMatch(/simulated/i);
  });
});
