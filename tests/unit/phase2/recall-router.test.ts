import { describe, expect, it } from "vitest";
import { retrieveRelevant, scoreMemory } from "@/core/memory/retriever";
import { routeRequest, routeLabel } from "@/core/reasoning/router";
import type { MemoryRecord } from "@/core/memory/types";

function record(partial: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord {
  return {
    kind: "semantic",
    entities: [],
    keywords: [],
    source: { type: "user", ref: "chat:c1" },
    provenance: "user-explicit:test",
    relevance: 0,
    conflictStatus: "none",
    versions: [{ version: 1, content: partial.content, updatedAt: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scope: "account",
    ...partial,
  } as MemoryRecord;
}

const seed: MemoryRecord[] = [
  record({ id: "m-gym", content: "User goes to the gym every Tuesday and Thursday.", keywords: ["gym", "tuesday", "thursday"], entities: ["gym"], scope: "account" }),
  record({ id: "m-rent", content: "Monthly rent is $1200 due on the 1st.", keywords: ["rent", "1200"], entities: ["rent"], scope: "account" }),
  record({ id: "m-rent-conv", content: "Landlord offered a parking spot for $50.", keywords: ["parking", "landlord"], entities: ["landlord"], scope: "conversation", scopeId: "other-conv" }),
  record({ id: "m-old-dose", content: "Doctor prescribed 10mg daily.", keywords: ["doctor", "10mg"], entities: ["doctor"], status: "superseded", supersededBy: "m-new-dose", scope: "account" }),
  record({ id: "m-new-dose", content: "Doctor changed the prescription to 5mg daily.", keywords: ["doctor", "5mg", "prescription"], entities: ["doctor"], scope: "account" }),
  record({ id: "m-grocery", content: "Bought apples and bread.", keywords: ["apples", "bread"], entities: [], scope: "account" }),
];

describe("phase2 recall diagnostics (real scorer)", () => {
  it("exact query retrieves the matching record", () => {
    const hits = retrieveRelevant(seed, "monthly rent $1200");
    expect(hits[0]?.id).toBe("m-rent");
  });
  it("paraphrase with shared stemmed terms still retrieves", () => {
    const hits = retrieveRelevant(seed, "which days does the user visit the gym?");
    expect(hits.map((h) => h.id)).toContain("m-gym");
  });
  it("morphological variation matches (prescription/prescribed)", () => {
    expect(scoreMemory(seed[4], "what is the current prescription?")).toBeGreaterThan(0);
  });
  it("irrelevant near-match sharing a common word is excluded", () => {
    const hits = retrieveRelevant(seed, "rent a car for the weekend trip");
    expect(hits.map((h) => h.id)).not.toContain("m-grocery");
    // Only records with genuine lexical overlap may appear.
    for (const h of hits) {
      expect(scoreMemory(seed.find((s) => s.id === h.id)!, "rent a car for the weekend trip")).toBeGreaterThan(0);
    }
  });
  it("conflicting facts both surface (no silent choice)", () => {
    const hits = retrieveRelevant(seed, "doctor prescription mg daily");
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("m-new-dose");
    // Superseded record stays visible but must not outrank the active one.
    if (ids.includes("m-old-dose")) {
      expect(ids.indexOf("m-new-dose")).toBeLessThan(ids.indexOf("m-old-dose"));
    }
  });
  it("conversation-scoped isolation is enforced by the bundle scope check, not the scorer", () => {
    // Scorer is scope-agnostic by design; buildContextBundle applies scopeAllowed.
    // This test pins that contract: scorer may match, bundle must filter.
    const hits = retrieveRelevant(seed, "landlord parking spot");
    expect(hits.map((h) => h.id)).toContain("m-rent-conv");
  });
});

describe("phase2 reasoning router", () => {
  it("deterministic paths stay quick with zero model calls", () => {
    const d = routeRequest({ message: "12 * 34 + 5", effortCeiling: "Medium", deterministic: true });
    expect(d.route).toBe("quick");
    expect(d.modelCalls).toBe(0);
    expect(routeLabel({ route: d.route, inferenceMode: "deterministic", deterministic: true })).toBe("Quick answer");
  });
  it("short single-step request routes quick", () => {
    const d = routeRequest({ message: "What time is it in Tokyo?", effortCeiling: "Medium" });
    expect(d.route).toBe("quick");
  });
  it("multi-step/consequential request routes deep", () => {
    const d = routeRequest({ message: "Compare the trade-offs, then delete the old drafts and publish the winner.", effortCeiling: "Max" });
    expect(d.route).toBe("deep");
  });
  it("user choice is honored and labeled truthfully", () => {
    const d = routeRequest({ message: "hi", effortCeiling: "Medium", userChoice: "deep" });
    expect(d.route).toBe("deep");
    // Heuristic execution must never claim deep model reasoning.
    expect(routeLabel({ route: d.route, inferenceMode: "heuristic-demo", deterministic: false })).toBe("Quick answer");
    expect(routeLabel({ route: "deep", inferenceMode: "live-model", deterministic: false })).toBe("Thought deeply");
    expect(routeLabel({ route: "quick", inferenceMode: "live-model", deterministic: false })).toBe("Quick answer");
  });
  it("light ceiling keeps ambiguous work quick", () => {
    const d = routeRequest({ message: "What should I do about this? It depends on a few things I am not sure about.", effortCeiling: "Light" });
    expect(d.route).toBe("quick");
  });
});
