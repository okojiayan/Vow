import { describe, expect, it } from "vitest";
import { summarizeActivity } from "@/lib/activity-summary";

const ev = (kind: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, title: kind, detail: "", createdAt: "" }));

describe("summarizeActivity", () => {
  it("reports empty state honestly", () => {
    const s = summarizeActivity([], [], null);
    expect(s.headline).toBe("No activity yet");
    expect(s.toolCalls).toBe(0);
  });
  it("counts tool calls and verification", () => {
    const s = summarizeActivity([...ev("plan_ready", 1), ...ev("tool_call", 3), ...ev("verification", 1)], [], "completed");
    expect(s.toolCalls).toBe(3);
    expect(s.headline).toContain("Run completed");
    expect(s.headline).toContain("3 tool calls");
    expect(s.subline).toBe("verified");
  });
  it("surfaces denials and in-progress status", () => {
    const s = summarizeActivity(ev("tool_call", 1), [{ decision: "deny" }], "executing");
    expect(s.headline).toContain("Working");
    expect(s.subline).toContain("1 denied");
  });
});
