import { describe, expect, it } from "vitest";
import { latestMessageTime, relativeTime } from "@/lib/relative-time";

describe("relativeTime", () => {
  const now = new Date("2026-10-22T12:00:00Z").getTime();
  it("labels fresh times", () => {
    expect(relativeTime(new Date(now - 20_000).toISOString(), now)).toBe("just now");
  });
  it("labels minutes and hours", () => {
    expect(relativeTime(new Date(now - 5 * 60000).toISOString(), now)).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3600000).toISOString(), now)).toBe("3h ago");
  });
  it("returns null for missing or invalid input", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime("nope", now)).toBeNull();
  });
  it("picks the latest message time", () => {
    expect(latestMessageTime([{ createdAt: "2026-10-22T10:00:00Z" }, {}, { createdAt: "2026-10-22T11:00:00Z" }])).toBe(
      "2026-10-22T11:00:00Z",
    );
    expect(latestMessageTime([{}])).toBeNull();
  });
});
