import { afterEach, describe, expect, it } from "vitest";
import { isolatedEnv } from "../../helpers";
import { resetEnvCache } from "@/lib/env";
import { proposeRule, stageRule, confirmRule, deactivateRule, evaluateRules, activeRules } from "@/core/warden/house-rules";
import { scanPayload, outboundVerdict } from "@/core/warden/leak-check";

describe("phase2 house rules", () => {
  afterEach(async () => { delete process.env.VOW_DATA_DIR; delete process.env.VOW_WORKSPACE_DIR; resetEnvCache(); });
  it("parses only supported categories; refuses the rest honestly", () => {
    expect(proposeRule("Do not delete files automatically").supported).toBe(true);
    expect(proposeRule("Ask before modifying files outside the current project").supported).toBe(true);
    expect(proposeRule("Never send personal information without confirmation").supported).toBe(true);
    expect(proposeRule("Ask before any network access").supported).toBe(true);
    const unsupported = proposeRule("Always be cheerful and use emojis");
    expect(unsupported.supported).toBe(false);
    expect(unsupported.reason).toMatch(/Supported/);
    const ambiguous = proposeRule("Ask before any network access and never delete files automatically");
    expect(ambiguous.supported).toBe(false);
    expect(ambiguous.reason).toMatch(/Ambiguous/);
  });
  it("requires confirmation before activation; deactivation works", async () => {
    const p = proposeRule("Do not delete files automatically");
    expect(p.supported).toBe(true);
    const staged = await stageRule(p.rule!);
    expect((await activeRules()).some((r) => r.id === staged.id)).toBe(false);
    await confirmRule(staged.id);
    expect((await activeRules()).some((r) => r.id === staged.id)).toBe(true);
    await deactivateRule(staged.id);
    expect((await activeRules()).some((r) => r.id === staged.id)).toBe(false);
  });
  it("rules only restrict: no-auto-delete denies at the boundary", async () => {
    const p = proposeRule("Do not delete files automatically");
    const staged = await stageRule(p.rule!);
    await confirmRule(staged.id);
    try {
      const verdict = await evaluateRules({ tool: "fs.delete", target: "demo/sandbox/x.txt" });
      expect(verdict.effect).toBe("deny");
      // Unknown-category rules can never be constructed: effect has no "allow" path.
      const ok = await evaluateRules({ tool: "fs.read", target: "demo/sandbox/a.txt" });
      expect(ok.effect).toBe("allow");
    } finally {
      await deactivateRule(staged.id);
    }
  });
  it("enforced inside executeTool after approval (real boundary)", async () => {
    await isolatedEnv();
    const { executeTool } = await import("@/core/execution/executor");
    const { decideApproval } = await import("@/core/warden/approval-service");
    const p = proposeRule("Do not delete files automatically");
    const staged = await stageRule(p.rule!);
    await confirmRule(staged.id);
    try {
      const taskId = `t-house-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const first = await executeTool({ taskId, tool: "fs.delete", args: { path: "demo/sandbox/never-created.txt" }, target: "demo/sandbox/never-created.txt", mode: "autonomous" });
      expect(first.status).toBe("needs_approval");
      await decideApproval(first.approvalId!, "approve");
      const second = await executeTool({ taskId, tool: "fs.delete", args: { path: "demo/sandbox/never-created.txt" }, target: "demo/sandbox/never-created.txt", mode: "autonomous" });
      expect(second.status).toBe("denied");
      expect(second.policy).toMatch(/house-rule\.no-auto-delete/);
    } finally {
      await deactivateRule(staged.id);
    }
  });
});

describe("phase2 leak check", () => {
  it("detects PAN, Aadhaar, IFSC, credentials; masks values", () => {
    const pan = scanPayload("My PAN is ABCDE1234F please verify");
    expect(pan.some((f) => f.kind === "pan")).toBe(true);
    expect(JSON.stringify(pan)).not.toContain("ABCDE1234F");
    const aadhaar = scanPayload("aadhaar 1234 5678 9012");
    expect(aadhaar.some((f) => f.kind === "aadhaar")).toBe(true);
    const ifsc = scanPayload("IFSC HDFC0001234");
    expect(ifsc.some((f) => f.kind === "ifsc")).toBe(true);
    const cred = scanPayload("api_key = sk-live-abcdef123456");
    expect(cred.some((f) => f.kind === "credential")).toBe(true);
  });
  it("avoids obvious false positives and malformed inputs", () => {
    expect(scanPayload("order 12345 shipped")).toEqual([]);
    expect(scanPayload("rent is $1200 due on the 1st")).toEqual([]);
    expect(scanPayload("PAN ABCDE123 (too short)")).toEqual([]);
    expect(scanPayload("call me at 5550101")).toEqual([]);
  });
  it("blocks outbound payloads, never echoes raw values", () => {
    const findings = scanPayload("send PAN ABCDE1234F to verification");
    const v = outboundVerdict("http.fetch", findings);
    expect(v.action).toBe("block");
    expect(v.reason).not.toContain("ABCDE1234F");
    const local = outboundVerdict("fs.write", scanPayload("note: PAN ABCDE1234F on file"));
    expect(local.action).toBe("allow");
  });
  it("cannot be bypassed by turbo at the real boundary", async () => {
    await isolatedEnv();
    const { executeTool } = await import("@/core/execution/executor");
    const { decideApproval } = await import("@/core/warden/approval-service");
    const taskId = `t-leak-${Date.now()}`;
    const first = await executeTool({ taskId, tool: "http.fetch", args: { url: "https://example.com/verify", body: "PAN ABCDE1234F" }, mode: "autonomous" });
    expect(first.status).toBe("needs_approval");
    await decideApproval(first.approvalId!, "approve");
    const second = await executeTool({ taskId, tool: "http.fetch", args: { url: "https://example.com/verify", body: "PAN ABCDE1234F" }, mode: "autonomous" });
    expect(second.status).toBe("denied");
    expect(second.policy).toBe("leak-check.outbound-block");
    expect(second.error).not.toContain("ABCDE1234F");
  });
});
