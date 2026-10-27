import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { DictionaryEntry, DictionaryRelation, DictionaryStoreShape } from "./types";

const STORE = () => dataPath("dictionary.json");
const EMPTY: DictionaryStoreShape = { entries: [], relations: [] };

export async function readDictionary(): Promise<DictionaryStoreShape> {
  const raw = await readJsonFile<DictionaryStoreShape>(STORE(), EMPTY);
  return { entries: raw.entries ?? [], relations: raw.relations ?? [] };
}

async function writeDictionary(next: DictionaryStoreShape): Promise<DictionaryStoreShape> {
  return mutateJsonFile<DictionaryStoreShape>(STORE(), EMPTY, () => next);
}

export function normaliseName(value: string): string {
  return value.trim().toLowerCase().replace(/[''`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export async function upsertEntry(input: {
  id?: string;
  type: string;
  name: string;
  aliases?: string[];
  description?: string;
  attributes?: Record<string, string>;
  status?: DictionaryEntry["status"];
  provenance: string;
  accountId?: string;
}): Promise<DictionaryEntry> {
  const now = new Date().toISOString();
  const accountId = input.accountId ?? "local";
  const aliases = Array.from(new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean)));
  let saved: DictionaryEntry | undefined;
  const current = await readDictionary();
  if (input.id) {
    const next = current.entries.map((entry) => {
      if (entry.id !== input.id || entry.accountId !== accountId) return entry;
      saved = {
        ...entry,
        type: input.type,
        name: input.name.trim(),
        aliases: Array.from(new Set([...entry.aliases, ...aliases])),
        description: input.description ?? entry.description,
        attributes: { ...(entry.attributes ?? {}), ...(input.attributes ?? {}) },
        status: input.status ?? entry.status,
        provenance: input.provenance,
        lastSeen: now,
        updatedAt: now,
      };
      return saved;
    });
    await writeDictionary({ ...current, entries: next });
  } else {
    saved = {
      id: createId("dict"),
      type: input.type,
      name: input.name.trim(),
      aliases,
      description: input.description,
      attributes: input.attributes,
      status: input.status ?? "current",
      provenance: input.provenance,
      accountId,
      firstSeen: now,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
    };
    await writeDictionary({ ...current, entries: [saved, ...current.entries] });
  }
  if (!saved) throw new Error("Dictionary entry not found for update.");
  return saved;
}

export interface Resolution {
  entry: DictionaryEntry | null;
  ambiguous: DictionaryEntry[];
  provisional: boolean;
}

/**
 * Resolve a surface form to a canonical entry. Returns the entry only when
 * the match is unambiguous; otherwise returns candidates without merging.
 */
export async function resolveEntry(
  surface: string,
  options?: { accountId?: string; type?: string },
): Promise<Resolution> {
  const accountId = options?.accountId ?? "local";
  const { entries } = await readDictionary();
  const scoped = entries.filter(
    (e) => e.accountId === accountId && (!options?.type || e.type === options.type) && e.status !== "archived",
  );
  const norm = normaliseName(surface);
  if (!norm) return { entry: null, ambiguous: [], provisional: true };
  const exact = scoped.filter((e) => normaliseName(e.name) === norm);
  if (exact.length === 1) return { entry: exact[0], ambiguous: [], provisional: false };
  if (exact.length > 1) return { entry: null, ambiguous: exact, provisional: false };
  const aliasHits = scoped.filter((e) => e.aliases.some((a) => normaliseName(a) === norm));
  if (aliasHits.length === 1) return { entry: aliasHits[0], ambiguous: [], provisional: false };
  if (aliasHits.length > 1) return { entry: null, ambiguous: aliasHits, provisional: false };
  return { entry: null, ambiguous: [], provisional: true };
}

export async function listEntries(accountId = "local"): Promise<DictionaryEntry[]> {
  const { entries } = await readDictionary();
  return entries.filter((e) => e.accountId === accountId);
}

export async function addRelation(input: {
  fromId: string;
  toId: string;
  type: string;
  provenance: string;
  accountId?: string;
}): Promise<DictionaryRelation> {
  const accountId = input.accountId ?? "local";
  const current = await readDictionary();
  const from = current.entries.find((e) => e.id === input.fromId && e.accountId === accountId);
  const to = current.entries.find((e) => e.id === input.toId && e.accountId === accountId);
  if (!from || !to) throw new Error("Both relation endpoints must exist in the same account scope.");
  const existing = current.relations.find(
    (r) => r.fromId === input.fromId && r.toId === input.toId && r.type === input.type && r.accountId === accountId,
  );
  if (existing) return existing;
  const relation: DictionaryRelation = {
    id: createId("rel"),
    fromId: input.fromId,
    toId: input.toId,
    type: input.type,
    provenance: input.provenance,
    accountId,
    createdAt: new Date().toISOString(),
  };
  await writeDictionary({ ...current, relations: [relation, ...current.relations] });
  return relation;
}

export async function relationsFrom(entryId: string, accountId = "local"): Promise<DictionaryRelation[]> {
  const { relations } = await readDictionary();
  return relations.filter((r) => r.accountId === accountId && (r.fromId === entryId || r.toId === entryId));
}

/** Bounded, permission-aware neighbourhood walk. Depth defaults to 2, capped at 4. */
export async function traverse(
  entryId: string,
  options?: { accountId?: string; depth?: number },
): Promise<{ entries: DictionaryEntry[]; relations: DictionaryRelation[] }> {
  const accountId = options?.accountId ?? "local";
  const depth = Math.max(1, Math.min(options?.depth ?? 2, 4));
  const { entries, relations } = await readDictionary();
  const scopedEntries = new Map(entries.filter((e) => e.accountId === accountId).map((e) => [e.id, e]));
  if (!scopedEntries.has(entryId)) return { entries: [], relations: [] };
  const seenEntries = new Set<string>([entryId]);
  const seenRelations = new Set<string>();
  const outRelations: DictionaryRelation[] = [];
  let frontier = [entryId];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const rel of relations) {
      if (rel.accountId !== accountId || seenRelations.has(rel.id)) continue;
      if (rel.fromId && frontier.includes(rel.fromId) && scopedEntries.has(rel.toId)) {
        seenRelations.add(rel.id);
        outRelations.push(rel);
        if (!seenEntries.has(rel.toId)) {
          seenEntries.add(rel.toId);
          next.push(rel.toId);
        }
      } else if (rel.toId && frontier.includes(rel.toId) && scopedEntries.has(rel.fromId)) {
        seenRelations.add(rel.id);
        outRelations.push(rel);
        if (!seenEntries.has(rel.fromId)) {
          seenEntries.add(rel.fromId);
          next.push(rel.fromId);
        }
      }
    }
    frontier = next;
  }
  return {
    entries: [...seenEntries].map((id) => scopedEntries.get(id)!).filter(Boolean),
    relations: outRelations,
  };
}

export async function touchEntry(id: string, accountId = "local"): Promise<void> {
  const current = await readDictionary();
  const now = new Date().toISOString();
  await writeDictionary({
    ...current,
    entries: current.entries.map((e) => (e.id === id && e.accountId === accountId ? { ...e, lastSeen: now, updatedAt: now } : e)),
  });
}
