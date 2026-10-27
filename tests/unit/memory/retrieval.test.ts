import { describe, expect, it } from "vitest";
import { buildContextBundle } from "@/core/memory/context";
import { submitCandidate } from "@/core/memory/lifecycle";
import { upsertEntry } from "@/core/memory/dictionary-store";
import { isolatedEnv } from "../../helpers";

const user = { type: "user" as const, ref: "test" };

async function remember(content: string, extra: Record<string, unknown> = {}) {
  const outcome = await submitCandidate({
    content,
    kind: "semantic",
    source: user,
    provenance: "user-explicit:test",
    explicit: true,
    ...extra,
  } as Parameters<typeof submitCandidate>[0]);
  if (!outcome.stored) throw new Error(`setup failed: ${JSON.stringify(outcome)}`);
  return outcome.record;
}

describe("scoped retrieval", () => {
  it("applies project scope filters", async () => {
    await isolatedEnv();
    await remember("Aurora uses Postgres for the primary store.", { projectId: "aurora", scope: "project", scopeId: "aurora" });
    await remember("Beacon uses SQLite for the primary store.", { projectId: "beacon", scope: "project", scopeId: "beacon" });
    const bundle = await buildContextBundle({ query: "primary store database", projectId: "aurora" });
    expect(bundle.items.length).toBeGreaterThan(0);
    expect(bundle.items.every((i) => !/Beacon/.test(i.content))).toBe(true);
  });

  it("current relevant fact outranks unrelated recent content", async () => {
    await isolatedEnv();
    await remember("Aurora deploy region is ap-south-1 Mumbai.");
    await remember("The office plant needs watering on Fridays.");
    const bundle = await buildContextBundle({ query: "Which region does Aurora deploy to?" });
    expect(bundle.items[0]?.content).toMatch(/Mumbai/);
  });

  it("expired and superseded facts are not reported as current", async () => {
    await isolatedEnv();
    await remember("Sprint demo is on Friday at 5pm.", { validUntil: "2020-01-01T00:00:00.000Z" });
    await remember("Sprint demo is on Thursday at 4pm.");
    const bundle = await buildContextBundle({ query: "When is the sprint demo?" });
    expect(bundle.items.some((i) => /Friday at 5pm/.test(i.content))).toBe(false);
    expect(bundle.items.some((i) => /Thursday/.test(i.content))).toBe(true);
  });

  it("plural and singular forms match the same fact", async () => {
    await isolatedEnv();
    await remember("The weekend deploy window is Saturday 02:00-04:00 UTC.");
    const bundle = await buildContextBundle({ query: "What are the weekend deploy windows?" });
    expect(bundle.items.some((i) => /02:00/.test(i.content))).toBe(true);
  });

  it("structured dictionary lookup works and carries source metadata", async () => {
    await isolatedEnv();
    const entry = await upsertEntry({ type: "project", name: "Aurora", aliases: ["aur"], provenance: "t" });
    const rec = await remember("Aurora deadline is 30 November.", { entities: ["Aurora"] });
    expect(rec.entityLinks?.some((l) => l.entryId === entry.id)).toBe(true);
    const bundle = await buildContextBundle({ query: "When is the aur deadline?" });
    expect(bundle.items.length).toBeGreaterThan(0);
    const top = bundle.items[0];
    expect(top.provenance).toBeTruthy();
    expect(top.verificationStatus).toBeTruthy();
    expect(top.status).toBeTruthy();
  });

  it("result bundles respect the size budget", async () => {
    await isolatedEnv();
    for (let i = 0; i < 10; i++) {
      await remember(`Aurora fact number ${i}: the deploy region is ap-south-1 Mumbai zone ${i}.`);
    }
    const bundle = await buildContextBundle({ query: "Aurora deploy region Mumbai", budgetChars: 500 });
    expect(bundle.charsUsed).toBeLessThanOrEqual(500);
    expect(bundle.partial).toBe(true);
  });
});
