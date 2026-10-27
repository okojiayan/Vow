import { describe, expect, it } from "vitest";
import { buildStructuredOutcome, taskStatusForOutcome } from "@/core/reasoning/outcome";
import { canTransition } from "@/core/agent/state-machine";
import type { TerminalOutcome } from "@/core/agent/types";

const ALL: TerminalOutcome[] = ["completed", "partial", "blocked", "failed", "cancelled", "unverified"];

describe("terminal outcome semantics", () => {
  it("maps every outcome to a legal task status", () => {
    for (const o of ALL) {
      const status = taskStatusForOutcome(o);
      expect(["completed", "failed", "blocked", "cancelled"]).toContain(status);
      expect(canTransition("verifying", status) || canTransition("executing", status)).toBe(true);
    }
  });
  it("never claims success without verification", () => {
    expect(taskStatusForOutcome("unverified")).toBe("failed");
    expect(taskStatusForOutcome("completed")).toBe("completed");
    expect(taskStatusForOutcome("cancelled")).toBe("cancelled");
  });
  it("builds a structured outcome callers can read without parsing strings", () => {
    const s = buildStructuredOutcome({ outcome: "partial", reason: "r", acceptanceSatisfied: 1, acceptanceTotal: 2, evidenceIds: ["ev1"], verificationPassed: true, providerProvenance: ["executor:x"] });
    expect(s.outcome).toBe("partial");
    expect(s.decidedAt).toBeTruthy();
  });
});
