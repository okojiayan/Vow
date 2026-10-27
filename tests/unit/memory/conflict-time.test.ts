import { describe, expect, it } from "vitest";
import { buildContextBundle } from "@/core/memory/context";
import { submitCandidate } from "@/core/memory/lifecycle";
import { correctMemory, getMemory } from "@/core/memory/store-ops";
import { isolatedEnv } from "../../helpers";

const user = { type: "user" as const, ref: "test" };

describe("conflict and time semantics", () => {
  it("conflicting sources are preserved, not overwritten", async () => {
    await isolatedEnv();
    const a = await submitCandidate({
      content: "The Aurora deploy succeeded for billing in staging.",
      kind: "observation",
      entities: ["aurora-deploy"],
      source: { type: "tool", ref: "ci" },
      provenance: "tool:ci",
    });
    const b = await submitCandidate({
      content: "The Aurora deploy failed for billing in staging and was never green.",
      kind: "observation",
      entities: ["aurora-deploy"],
      source: { type: "tool", ref: "monitor" },
      provenance: "tool:monitor",
    });
    expect(a.stored && b.stored).toBe(true);
    if (!a.stored || !b.stored) return;
    const rereadA = await getMemory(a.record.id);
    const rereadB = await getMemory(b.record.id);
    expect(rereadA?.content).toContain("succeeded");
    expect(rereadB?.content).toContain("failed");
    expect(rereadA?.conflictStatus).toBe("open");
    expect(rereadB?.conflictStatus).toBe("open");
  });

  it("direct correction supersedes and preserves history", async () => {
    await isolatedEnv();
    const first = await submitCandidate({
      content: "Aurora deadline is 30 November.",
      kind: "semantic",
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
    });
    expect(first.stored).toBe(true);
    if (!first.stored) return;
    const corrected = await correctMemory(first.record.id, "Aurora deadline is 15 December.");
    expect(corrected.content).toContain("15 December");
    expect(corrected.supersedes).toContain(first.record.id);
    const old = await getMemory(first.record.id);
    expect(old?.status).toBe("superseded");
    expect(old?.versions.length).toBeGreaterThanOrEqual(1);
    const bundle = await buildContextBundle({ query: "When is the Aurora deadline?" });
    expect(bundle.items[0]?.content).toContain("15 December");
    expect(bundle.items.some((i) => /30 November/.test(i.content))).toBe(false);
  });

  it("different time-scoped facts are not false conflicts", async () => {
    await isolatedEnv();
    const a = await submitCandidate({
      content: "The deploy window is Friday evening and never moves.",
      kind: "semantic",
      entities: ["deploy-window"],
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2024-06-01T00:00:00.000Z",
    });
    const b = await submitCandidate({
      content: "The deploy window is not Friday evening anymore.",
      kind: "semantic",
      entities: ["deploy-window"],
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2025-06-01T00:00:00.000Z",
    });
    expect(a.stored && b.stored).toBe(true);
    if (!a.stored || !b.stored) return;
    const rereadA = await getMemory(a.record.id);
    const rereadB = await getMemory(b.record.id);
    expect(rereadA?.conflictStatus).toBe("none");
    expect(rereadB?.conflictStatus).toBe("none");
  });

  it("inference never becomes a verified fact silently", async () => {
    await isolatedEnv();
    const outcome = await submitCandidate({
      content: "The user probably prefers dark mode.",
      kind: "inference",
      source: { type: "model", ref: "extractor" },
      provenance: "model:extractor",
    });
    expect(outcome.stored).toBe(true);
    if (!outcome.stored) return;
    expect(outcome.record.verificationStatus).toBe("unverified");
    expect(outcome.record.status).toBe("candidate");
  });
});
