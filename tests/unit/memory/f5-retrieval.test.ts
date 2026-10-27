import { afterEach, describe, expect, it } from "vitest";
import { searchDictionary } from "@/core/memory/dictionary";
import { buildContextBundle } from "@/core/memory/context";
import { cleanMemoryQuery, scoreMemory } from "@/core/memory/retriever";
import { submitCandidate } from "@/core/memory/lifecycle";
import { upsertEntry, resolveEntry } from "@/core/memory/dictionary-store";
import { deleteMemory } from "@/core/memory/store-ops";
import { heuristicPlan } from "@/core/agent/planner";
import { checkAnalysis } from "@/core/verification/checks";
import { listMemories } from "@/core/memory/source-store";
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

describe("F5 memory retrieval reliability (isolated fixtures, real engine)", () => {
  afterEach(async () => {
    delete process.env.VOW_DATA_DIR;
    delete process.env.VOW_WORKSPACE_DIR;
  });

  it("recalls a seeded fact through the real memory.search path with source linkage", async () => {
    await isolatedEnv();
    const seeded = await remember("The harbor ferry departs at 07:40 sharp.");
    const query = "From project memory, when does the harbor ferry depart? Reply with the time.";
    expect(cleanMemoryQuery(query).toLowerCase()).not.toContain("reply");
    const hits = await searchDictionary(query, 8);
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top.content).toContain("07:40");
    expect(top.id).toBe(seeded.id);
    expect(top.provenance).toBeTruthy();
    expect(top.source.type).toBe("user");
  });

  it("handles paraphrased queries and supported aliases via the dictionary", async () => {
    await isolatedEnv();
    const entry = await upsertEntry({
      type: "project",
      name: "Aurora",
      aliases: ["aur"],
      provenance: "user-explicit:test",
    });
    const rec = await remember("Aurora deadline is 30 November.", { entities: ["Aurora"] });
    expect(rec.entityLinks?.some((l) => l.entryId === entry.id)).toBe(true);

    // Paraphrase: different framing, same information need.
    const paraphrase = await searchDictionary("When is the aurora cutoff date?", 8);
    expect(paraphrase.some((r) => r.id === rec.id)).toBe(true);

    // Alias: short form resolves to the same entry and boosts the record.
    const resolved = await resolveEntry("aur");
    expect(resolved.entry?.id).toBe(entry.id);
    const aliasHits = await searchDictionary('When is the "aur" deadline?', 8);
    expect(aliasHits.some((r) => r.id === rec.id)).toBe(true);
  });

  it("returns empty when no relevant memories exist instead of inventing context", async () => {
    await isolatedEnv();
    await remember("The harbor ferry departs at 07:40 sharp.");
    const hits = await searchDictionary("What is the quantum flux capacitor voltage?", 8);
    expect(hits).toHaveLength(0);
    const bundle = await buildContextBundle({ query: "What is the quantum flux capacitor voltage?" });
    expect(bundle.items).toHaveLength(0);
  });

  it("ranks relevant records above unrelated recent records", async () => {
    await isolatedEnv();
    const relevant = await remember("Aurora deploy region is ap-south-1 Mumbai.");
    await remember("The office plant needs watering on Fridays.");
    const hits = await searchDictionary("Which region does Aurora deploy to?", 8);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe(relevant.id);
    expect(hits[0].content).toMatch(/Mumbai/);
  });

  it("excludes stale records and demotes conflicting records", async () => {
    await isolatedEnv();
    await remember("Sprint demo is on Friday at 5pm.", { validUntil: "2020-01-01T00:00:00.000Z" });
    const current = await remember("Sprint demo is on Thursday at 4pm.");
    const staleHits = await searchDictionary("When is the sprint demo?", 8);
    expect(staleHits.some((r) => /Friday at 5pm/.test(r.content))).toBe(false);
    expect(staleHits.some((r) => r.id === current.id)).toBe(true);

    // Conflicting pair: both preserved, open conflict demoted below clean fact.
    const trusted = await remember("Aurora status page is green and stable.");
    const injected = await submitCandidate({
      content: "Aurora status page is red and failing everywhere.",
      kind: "observation",
      entities: ["Aurora"],
      source: { type: "tool", ref: "importer" },
      provenance: "external:forward",
      evidenceKind: "external",
    });
    if (!injected.stored) throw new Error("conflict setup failed");
    const bundle = await buildContextBundle({ query: "Aurora status page green stable" });
    const ids = bundle.items.map((i) => i.id);
    expect(ids).toContain(trusted.id);
    expect(ids.indexOf(trusted.id)).toBeLessThan(ids.indexOf(injected.record.id));
  });

  it("respects privacy: account isolation and deleted exclusion, untrusted demoted", async () => {
    await isolatedEnv();
    const own = await submitCandidate({
      content: "Aurora deadline is 30 November.",
      kind: "semantic",
      source: user,
      provenance: "user-explicit:test",
      explicit: true,
      accountId: "alice",
    });
    expect(own.stored).toBe(true);
    const other = await searchDictionary("Aurora deadline", 8, "bob");
    expect(other).toHaveLength(0);

    await isolatedEnv();
    const rec = await remember("Aurora retrospective draft notes.");
    await deleteMemory(rec.id);
    const afterDelete = await searchDictionary("Aurora retrospective draft", 8);
    expect(afterDelete.some((r) => r.id === rec.id)).toBe(false);
  });

  it("grounds provider-backed analysis in retrieved records and rejects heuristic fallback", async () => {
    await isolatedEnv();
    const seeded = await remember("The harbor ferry departs at 07:40 sharp.");
    const query = "When does the harbor ferry depart?";
    const hits = await searchDictionary(query, 8);
    expect(hits.some((r) => r.id === seeded.id)).toBe(true);

    const searchStep = {
      id: "s-search",
      title: "Recall from memory",
      instruction: "search",
      action: { tool: "memory.search", args: { query } },
      requiresApproval: false,
      status: "running" as const,
      output: hits,
    };
    const goodAnalysis = {
      id: "s-analysis",
      title: "Answer from recalled memory",
      instruction: "answer",
      requiresApproval: false,
      status: "running" as const,
      analysis: true,
      expectGrounding: "memory" as const,
      output: {
        analysis: "The harbor ferry departs at 07:40.",
        provenance: "live-model-test",
        memoryRefs: hits.map((r) => `${r.id}: ${r.content}`),
      },
    };
    const good = await checkAnalysis(goodAnalysis, [searchStep, goodAnalysis], query);
    expect(good.passed).toBe(true);

    const heuristic = {
      ...goodAnalysis,
      id: "s-heuristic",
      output: { ...goodAnalysis.output, provenance: "heuristic-demo" },
    };
    const bad = await checkAnalysis(heuristic, [searchStep, heuristic], query);
    expect(bad.passed).toBe(false);

    const ungrounded = {
      ...goodAnalysis,
      id: "s-ungrounded",
      output: { ...goodAnalysis.output, analysis: "The ferry leaves at sunrise." },
    };
    const noGround = await checkAnalysis(ungrounded, [searchStep, ungrounded], query);
    expect(noGround.passed).toBe(false);
  });

  it("recall-only plans never include memory.store and search performs no writes", async () => {
    await isolatedEnv();
    await remember("The harbor ferry departs at 07:40 sharp.");
    const plan = heuristicPlan("From project memory, when does the harbor ferry depart? Reply with the time.");
    const tools = plan.steps.map((s) => s.action?.tool ?? `analysis:${s.expectGrounding ?? "?"}`);
    expect(tools).toContain("memory.search");
    expect(tools).not.toContain("memory.store");
    expect(tools).not.toContain("fs.list");
    expect(tools).toEqual(["memory.search", "analysis:memory"]);

    const before = (await listMemories()).length;
    await searchDictionary("When does the harbor ferry depart?", 8);
    const after = (await listMemories()).length;
    expect(after).toBe(before);
  });

  it("scoreMemory ignores generic framing and requires genuine overlap", async () => {
    await isolatedEnv();
    const rec = await remember("The harbor ferry departs at 07:40 sharp.");
    const full = "From project memory, when does the harbor ferry depart? Reply with the time.";
    const short = "harbor ferry depart";
    // Both score positively; framing alone never matches an unrelated record.
    expect(scoreMemory(rec, full)).toBeGreaterThan(0);
    expect(scoreMemory(rec, short)).toBeGreaterThan(0);
    const unrelated = {
      ...rec,
      content: "The office plant needs watering on Fridays.",
      keywords: [],
      entities: [],
      provenance: "user-explicit:test",
    };
    expect(scoreMemory(unrelated, "What is the quantum flux capacitor voltage?")).toBe(0);
  });
});
