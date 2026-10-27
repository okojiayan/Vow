import { afterEach, describe, expect, it } from "vitest";
import { createTask, runTask } from "@/core/agent/orchestrator";
import { saveTask } from "@/core/agent/task-store";
import { delegate } from "@/core/agent/subagents";
import { executeTool } from "@/core/execution/executor";
import {
  buildEvidenceReceipt,
  parseEvidenceReceipt,
  verifyReceiptConsistency,
} from "@/core/verification/evidence-receipt";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../helpers";

async function setup() {
  await isolatedEnv();
  await updateSettings({ mode: "autonomous" });
}

afterEach(async () => {
  delete process.env.VOW_DATA_DIR;
  delete process.env.VOW_WORKSPACE_DIR;
});

describe("evidence receipt (source-backed)", () => {
  it("builds a valid receipt from a real completed task", async () => {
    await setup();
    const { task } = await createTask("Compute 6 * 7. Reply with the result.");
    const finished = await runTask(task.id);
    expect(finished.status).toBe("completed");
    const receipt = await buildEvidenceReceipt(task.id);
    const parsed = parseEvidenceReceipt(receipt);
    expect(parsed.ok).toBe(true);
    expect(receipt.taskId).toBe(task.id);
    expect(receipt.status).toBe("completed");
    expect(receipt.structuredOutcome?.outcome).toBe("completed");
    expect(receipt.verification?.passed).toBe(true);
    expect(receipt.toolCalls.some((t) => t.tool === "calc.evaluate")).toBe(true);
    expect(receipt.sandbox.osIsolation).toBe(false);
    expect(receipt.contradictions).toHaveLength(0);
    const consistency = verifyReceiptConsistency(receipt);
    expect(consistency.consistent).toBe(true);
    // Deterministic: rebuilding from the same records matches (except timestamp).
    const again = await buildEvidenceReceipt(task.id);
    expect({ ...again, generatedAt: "x" }).toEqual({ ...receipt, generatedAt: "x" });
  });

  it("links child tasks and preserves honest failure states", async () => {
    await setup();
    const { task: parent } = await createTask("receipt parent");
    const { result } = await delegate(parent, {
      role: "lister",
      objective: "List files in the workspace.",
      allowedTools: ["calc.evaluate"],
    });
    expect(["blocked", "failed"]).toContain(result.status);
    const receipt = await buildEvidenceReceipt(parent.id);
    expect(parseEvidenceReceipt(receipt).ok).toBe(true);
    expect(receipt.children.length).toBeGreaterThanOrEqual(1);
    expect(receipt.children[0].accepted).toBe(true); // truthful failure is acceptable
    expect(receipt.structuredOutcome).toBeNull();
    expect(receipt.missingEvidence.length).toBeGreaterThan(0);
    expect(receipt.status).not.toBe("completed");
  });

  it("records denials and never exposes secrets", async () => {
    await setup();
    const { task: parent } = await createTask("denial parent");
    const denied = await executeTool({
      taskId: parent.id, tool: "shell.exec", args: { cmd: "id", api_key: "live-secret-value" }, mode: "autonomous",
    });
    expect(denied.status).toBe("denied");
    const receipt = await buildEvidenceReceipt(parent.id);
    expect(receipt.warden.denies).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(receipt)).not.toContain("live-secret-value");
  });

  it("rejects malformed receipts and flags contradictory or tampered ones", async () => {
    await setup();
    expect(parseEvidenceReceipt({ version: "9.9.9" }).ok).toBe(false);
    expect(parseEvidenceReceipt(null).ok).toBe(false);

    const { task } = await createTask("Compute 1 + 1. Reply with the result.");
    await runTask(task.id);
    const receipt = await buildEvidenceReceipt(task.id);
    // Tamper: claim verified success with all execution removed.
    const tampered = { ...receipt, children: [], skills: [], toolCalls: [] };
    const check = verifyReceiptConsistency(tampered);
    expect(check.consistent).toBe(false);
    expect(check.problems.join(" ")).toMatch(/no recorded tool/);
    // Contradiction: completed outcome stapled onto failing verification.
    const contradictory = {
      ...receipt,
      verification: { passed: false, explanation: "failed", evidenceCount: 0 },
    };
    const check2 = verifyReceiptConsistency(contradictory);
    expect(check2.consistent).toBe(false);
  });

  it("flags a completed status stapled onto failing verification in the builder", async () => {
    await setup();
    const { task } = await createTask("Compute 1 + 1. Reply with the result.");
    const finished = await runTask(task.id);
    const tampered = await saveTask({
      ...finished,
      verification: { passed: false, explanation: "tampered", evidence: [] },
    });
    expect(tampered.status).toBe("completed");
    const receipt = await buildEvidenceReceipt(task.id);
    expect(receipt.contradictions.length).toBeGreaterThan(0);
    expect(verifyReceiptConsistency(receipt).consistent).toBe(false);
  });

  it("throws for unknown tasks instead of inventing provenance", async () => {
    await setup();
    await expect(buildEvidenceReceipt("task-missing")).rejects.toThrow(/Unknown task/);
  });
});
