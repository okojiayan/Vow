import { describe, expect, it } from "vitest";
import { buildContextBundle } from "@/core/memory/context";
import { submitCandidate } from "@/core/memory/lifecycle";
import { isolatedEnv } from "../../helpers";

const user = { type: "user" as const, ref: "test" };

// Benchmark/fixture seeds use durable kinds ("semantic") but must stay inside
// their isolated conversation namespace. Without an explicit conversation
// scope, durable kinds default to account visibility and leak into every
// task's planning bundle.
describe("memory scope isolation", () => {
  it("explicit conversation scope keeps durable seeds out of other conversations", async () => {
    await isolatedEnv();
    const seeded = await submitCandidate({
      content: "The Kestrel test window is Saturday 02:00-04:00 UTC.",
      kind: "semantic",
      entities: ["Kestrel-100"],
      keywords: ["kestrel-100", "scope-check"],
      conversationId: "conv-a",
      scope: "conversation",
      scopeId: "conv-a",
      source: user,
      provenance: "user-explicit:scope-test",
      idempotencyKey: "scope-test-001",
    });
    expect(seeded.stored).toBe(true);

    const same = await buildContextBundle({ query: "Kestrel test window", conversationId: "conv-a" });
    expect(same.items.some((i) => i.content.includes("02:00"))).toBe(true);

    const other = await buildContextBundle({ query: "Kestrel test window", conversationId: "conv-b" });
    expect(other.items.some((i) => i.content.includes("02:00"))).toBe(false);
  });

  it("durable kinds without explicit scope stay account-visible (documented default)", async () => {
    await isolatedEnv();
    const seeded = await submitCandidate({
      content: "The harbor test ferry departs at 07:40 sharp.",
      kind: "semantic",
      conversationId: "conv-a",
      source: user,
      provenance: "user-explicit:scope-test",
      idempotencyKey: "scope-test-002",
    });
    expect(seeded.stored).toBe(true);
    const other = await buildContextBundle({ query: "harbor test ferry departs", conversationId: "conv-unrelated" });
    expect(other.items.some((i) => i.content.includes("07:40"))).toBe(true);
  });
});
