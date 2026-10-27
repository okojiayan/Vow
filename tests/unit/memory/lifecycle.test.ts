import { describe, expect, it } from "vitest";
import { submitCandidate } from "@/core/memory/lifecycle";
import { extractCandidate, isTemporaryInstruction, suggestedKind } from "@/core/memory/extract";
import { getMemory } from "@/core/memory/store-ops";
import { isolatedEnv } from "../../helpers";

const user = { type: "user" as const, ref: "test" };

describe("memory lifecycle", () => {
  it("explicit remember persists and confirms only after write", async () => {
    await isolatedEnv();
    const extraction = extractCandidate("Remember this: the Aurora project deadline is 30 November.");
    expect(extraction?.explicit).toBe(true);
    const outcome = await submitCandidate({
      content: extraction!.content,
      kind: "semantic",
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
      idempotencyKey: "test-explicit-1",
    });
    expect(outcome.stored).toBe(true);
    if (!outcome.stored) return;
    expect(outcome.record.id).toBeTruthy();
    const reread = await getMemory(outcome.record.id);
    expect(reread?.content).toContain("Aurora");
  });

  it("temporary instruction is not stored as a durable preference", async () => {
    await isolatedEnv();
    expect(isTemporaryInstruction("Use dark mode just for now")).toBe(true);
    const extraction = extractCandidate("Remember this for now: use dark mode just for this session");
    expect(extraction?.temporary).toBe(true);
    const outcome = await submitCandidate({
      content: extraction!.content,
      kind: suggestedKind(extraction!),
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
    });
    expect(outcome.stored).toBe(true);
    if (!outcome.stored) return;
    expect(outcome.record.kind).toBe("working");
    expect(outcome.record.kind).not.toBe("preference");
  });

  it("non-explicit chatter produces no candidate", async () => {
    await isolatedEnv();
    expect(extractCandidate("Compute 12 + 30 step by step")).toBeNull();
  });

  it("task outcome stores with a source link", async () => {
    await isolatedEnv();
    const outcome = await submitCandidate({
      content: "Completed: Compute 12 + 30. 12 + 30 = 42",
      kind: "observation",
      conversationId: "convo_1",
      source: { type: "system", ref: "orchestrator" },
      provenance: "task-completion",
      idempotencyKey: "task:task_1:completion",
      verified: true,
    });
    expect(outcome.stored).toBe(true);
    if (!outcome.stored) return;
    expect(outcome.record.provenance).toBe("task-completion");
    expect(outcome.record.verificationStatus).toBe("verified");
  });

  it("rejects invalid, long, and secret candidates safely", async () => {
    await isolatedEnv();
    const empty = await submitCandidate({ content: "   ", kind: "observation", source: user, provenance: "t" });
    expect(empty.stored).toBe(false);
    const long = await submitCandidate({ content: "x".repeat(5000), kind: "observation", source: user, provenance: "t" });
    expect(long.stored).toBe(false);
    if (!long.stored) expect(long.reason).toBe("too_long");
    const secret = await submitCandidate({
      content: "My api_key: sk-live-abcdefgh12345678",
      kind: "observation",
      source: user,
      provenance: "t",
    });
    expect(secret.stored).toBe(false);
    if (!secret.stored) expect(secret.reason).toBe("secret");
  });

  it("retry with the same idempotency key does not duplicate", async () => {
    await isolatedEnv();
    const input = {
      content: "The Aurora repo lives at github.com/example/aurora.",
      kind: "semantic" as const,
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
      idempotencyKey: "retry-key-1",
    };
    const first = await submitCandidate(input);
    const second = await submitCandidate(input);
    expect(first.stored && second.stored).toBe(true);
    if (first.stored && second.stored) {
      expect(second.record.id).toBe(first.record.id);
      expect(second.deduped).toBe(true);
    }
  });

  it("identical content in the same scope dedupes without a key", async () => {
    await isolatedEnv();
    const input = {
      content: "Standup is at 9:30 every weekday.",
      kind: "semantic" as const,
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
    };
    const first = await submitCandidate(input);
    const second = await submitCandidate(input);
    if (first.stored && second.stored) expect(second.record.id).toBe(first.record.id);
  });
});
