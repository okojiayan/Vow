import { describe, expect, it } from "vitest";
import {
  addRelation,
  relationsFrom,
  resolveEntry,
  traverse,
  upsertEntry,
} from "@/core/memory/dictionary-store";
import { isolatedEnv } from "../../helpers";

describe("memory dictionary", () => {
  it("canonical name and alias resolve to the same entry", async () => {
    await isolatedEnv();
    const entry = await upsertEntry({
      type: "project",
      name: "Aurora",
      aliases: ["aur"],
      provenance: "user-explicit:test",
    });
    expect((await resolveEntry("Aurora")).entry?.id).toBe(entry.id);
    expect((await resolveEntry("aur")).entry?.id).toBe(entry.id);
    expect((await resolveEntry("AURORA")).entry?.id).toBe(entry.id);
  });

  it("ambiguous aliases do not silently merge", async () => {
    await isolatedEnv();
    const a = await upsertEntry({ type: "event", name: "Aurora Hackathon 2024", aliases: ["aurora"], provenance: "t" });
    const b = await upsertEntry({ type: "event", name: "Aurora Hackathon 2025", aliases: ["aurora"], provenance: "t" });
    const result = await resolveEntry("aurora");
    expect(result.entry).toBeNull();
    expect(result.ambiguous.map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("typed relationships query and traverse within a bounded depth", async () => {
    await isolatedEnv();
    const people = await upsertEntry({ type: "person", name: "Maya Rao", provenance: "t" });
    const e24 = await upsertEntry({ type: "event", name: "Aurora Hackathon 2024", provenance: "t" });
    const proj = await upsertEntry({ type: "project", name: "Aurora", provenance: "t" });
    const deep = await upsertEntry({ type: "document", name: "Approval email", provenance: "t" });
    const deeper = await upsertEntry({ type: "concept", name: "Budget", provenance: "t" });
    await addRelation({ fromId: people.id, toId: e24.id, type: "PARTICIPATES_IN", provenance: "t" });
    await addRelation({ fromId: proj.id, toId: e24.id, type: "HAS_EVENT", provenance: "t" });
    await addRelation({ fromId: deep.id, toId: e24.id, type: "REFERS_TO", provenance: "t" });
    await addRelation({ fromId: deeper.id, toId: deep.id, type: "REFERS_TO", provenance: "t" });

    const direct = await relationsFrom(e24.id);
    expect(direct.length).toBe(3);
    const one = await traverse(people.id, { depth: 1 });
    expect(one.entries.map((e) => e.id).sort()).toEqual([people.id, e24.id].sort());
    const two = await traverse(people.id, { depth: 2 });
    const ids = two.entries.map((e) => e.id);
    expect(ids).toContain(proj.id);
    expect(ids).toContain(deep.id);
    expect(ids).not.toContain(deeper.id);
  });

  it("updates preserve aliases, relations, and provenance links", async () => {
    await isolatedEnv();
    const entry = await upsertEntry({ type: "project", name: "Aurora", aliases: ["aur"], provenance: "v1" });
    const other = await upsertEntry({ type: "person", name: "Maya Rao", provenance: "v1" });
    await addRelation({ fromId: other.id, toId: entry.id, type: "PARTICIPATES_IN", provenance: "rel-v1" });
    const updated = await upsertEntry({ id: entry.id, type: "project", name: "Aurora", aliases: ["aurora-proj"], provenance: "v2" });
    expect(updated.aliases).toContain("aur");
    expect(updated.aliases).toContain("aurora-proj");
    const rels = await relationsFrom(entry.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].provenance).toBe("rel-v1");
  });

  it("similar but distinct entities remain separate", async () => {
    await isolatedEnv();
    const a = await upsertEntry({ type: "event", name: "Aurora Hackathon", provenance: "t" });
    const b = await upsertEntry({ type: "event", name: "Aurora Workshop", provenance: "t" });
    expect(a.id).not.toBe(b.id);
    expect((await resolveEntry("Aurora Hackathon")).entry?.id).toBe(a.id);
    expect((await resolveEntry("Aurora Workshop")).entry?.id).toBe(b.id);
    expect((await resolveEntry("Aurora")).entry).toBeNull();
  });
});
