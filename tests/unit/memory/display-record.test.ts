import { describe, expect, it } from "vitest";
import { formatRecordSource, toDisplayRecord } from "@/lib/memory-display";

describe("memory display normalization (page must never render raw API objects)", () => {
  it("renders structured source objects as text", () => {
    expect(formatRecordSource({ type: "system", ref: "warden" })).toBe("system:warden");
  });

  it("keeps plain string sources", () => {
    expect(formatRecordSource("Chat #12")).toBe("Chat #12");
  });

  it("falls back for missing or malformed sources", () => {
    expect(formatRecordSource(undefined)).toBe("Conversation");
    expect(formatRecordSource(null)).toBe("Conversation");
    expect(formatRecordSource({ type: "system" })).toBe("Conversation");
  });

  it("maps kind to category and source object to text", () => {
    const rec = toDisplayRecord({
      id: "mem_1",
      content: "Blocked shell.exec",
      kind: "failure",
      source: { type: "system", ref: "warden" },
      updatedAt: "2026-10-24T12:22:18.603Z",
      keywords: ["blocked", "warden"],
    });
    expect(rec.category).toBe("failure");
    expect(rec.source).toBe("system:warden");
    expect(rec.tags).toEqual(["blocked", "warden"]);
    expect(typeof rec.content).toBe("string");
  });

  it("never emits object values for React children", () => {
    const rec = toDisplayRecord({
      content: { nested: ["x"] },
      source: { type: 1, ref: null },
    } as unknown as Record<string, unknown>);
    for (const v of [rec.content, rec.category, rec.source, rec.createdAt]) {
      expect(typeof v).toBe("string");
    }
    expect(rec.source).toBe("Conversation");
  });
});
