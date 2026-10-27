import { describe, expect, it } from "vitest";
import { humanEvent, humanResult, humanTitle, humanVerification } from "@/lib/humanize";

describe("humanize", () => {
  it("turns calc output into arithmetic", () => {
    expect(humanResult('Evaluate expression: ({"expression":"12 + 30","result":42})')).toBe("12 + 30 = 42");
  });
  it("prefers the user request over machine plan labels", () => {
    expect(humanTitle("Heuristic demo plan for: Compute 12 + 30 step by step", "Compute 12 + 30 step by step")).toBe(
      "Compute 12 + 30 step by step",
    );
  });
  it("translates timeline events", () => {
    expect(humanEvent("warden", "Warden: needs_approval", "Action-specific approval is required")).toEqual({
      title: "Waiting for your approval",
      detail: "Paused here. Nothing runs until you approve the exact action.",
    });
    expect(humanEvent("tool", "Tool calc.evaluate", "12 + 30")).toEqual({ title: "Calculated", detail: "12 + 30" });
  });
  it("names dataset queries without raw tool ids", () => {
    expect(humanEvent("tool", "run_sql", "2 rows").title).toBe("Ran a dataset query");
    expect(humanEvent("tool", "Tool run_sql", "2 rows").title).not.toContain("run_sql");
  });
  it("routes controller prompts to input, not raw labels", () => {
    expect(humanEvent("controller", "Controller \u2192 ask_user", "").title).toBe("Waiting for your input");
  });
  it("never labels unverified outcomes as verified", () => {
    expect(humanEvent("reasoning", "Reasoning outcome: unverified", "").title).toBe("Needs review");
  });
  it("keeps unknown strings honest", () => {
    expect(humanResult("Something entirely new happened")).toBe("Something entirely new happened");
  });
  it("phrases verification plainly", () => {
    expect(humanVerification(true, "All inspectable checks passed against actual outputs.")).toBe(
      "Verified — Checked against the actual result.",
    );
  });
});

describe("humanMessage", () => {
  it("never truncates long messages", async () => {
    const { humanMessage } = await import("@/lib/humanize");
    const long = "Please review this carefully. ".repeat(30);
    expect(humanMessage(long)).toBe(long);
  });
});
