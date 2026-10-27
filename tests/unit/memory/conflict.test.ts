import { describe, expect, it } from "vitest";
import { looksContradictory, markConflicts } from "@/core/memory/conflict-resolver";
import { consolidate } from "@/core/memory/consolidator";
import type { MemoryRecord } from "@/core/memory/types";

function rec(partial: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord {
  const now = new Date().toISOString();
  return {
    kind: "observation",
    entities: ["deploy"],
    keywords: [],
    source: { type: "system", ref: "test" },
    provenance: "test",
    conflictStatus: "none",
    versions: [{ version: 1, content: partial.content, updatedAt: now }],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("memory conflicts", () => {
  it("detects contradictory success vs failure", () => {
    expect(looksContradictory("deploy succeeded for billing", "deploy failed for billing")).toBe(true);
  });

  it("marks both records instead of erasing the failure", () => {
    const a = rec({ id: "a", content: "deploy succeeded for billing" });
    const b = rec({ id: "b", content: "deploy failed for billing" });
    const merged = markConflicts([a], b);
    const failure = merged.find((item) => item.id === "a");
    const incoming = merged.find((item) => item.id === "b");
    expect(failure?.conflictStatus).toBe("open");
    expect(incoming?.conflictStatus).toBe("open");
    expect(failure?.content).toContain("succeeded");
  });

  it("does not drop failure records during consolidation", async () => {
    const records = [
      rec({ id: "s", content: "task completed", kind: "observation", entities: ["task"] }),
      rec({ id: "f", content: "task failed", kind: "failure", entities: ["task"] }),
    ];
    const kept = await consolidate(records);
    expect(kept.some((item) => item.kind === "failure")).toBe(true);
  });
});
