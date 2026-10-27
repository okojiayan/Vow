import { listMemories } from "./source-store";
import { isVisible, ownerOf, touchAccessed } from "./store-ops";
import { cleanMemoryQuery, scoreMemory } from "./retriever";
import { rankBoost } from "./context";
import { suggestEntityNames } from "./extract";
import { listEntries, relationsFrom, resolveEntry, traverse } from "./dictionary-store";
import type { MemoryRecord } from "./types";

function scopeAllowedForTool(record: MemoryRecord): boolean {
  // Tool-path search carries no project/conversation/task context, so only
  // account-visible durable knowledge is eligible. Conversation/task-scoped
  // records require explicit context via buildContextBundle.
  const scope = record.scope ?? "account";
  return scope === "account";
}

/**
 * Tool-path dictionary search. Shares the Memory Engine ranking rules with
 * buildContextBundle (relevance, trust, freshness, conflict, privacy,
 * alias/entity boost) while preserving the MemoryRecord[] return shape the
 * memory.search tool and verification rely on. General-purpose: no
 * benchmark, entity, or fixture terms are referenced.
 */
export async function searchDictionary(
  query: string,
  limit = 12,
  accountId = "local",
  options?: { includeHistory?: boolean; now?: string },
): Promise<MemoryRecord[]> {
  const cleaned = cleanMemoryQuery(query);
  const effectiveQuery = cleaned.length > 0 ? cleaned : query;
  const includeHistory = options?.includeHistory ?? false;
  const nowIso = options?.now ?? new Date().toISOString();
  const safeLimit = Math.max(1, Math.min(limit, 25));

  const all = await listMemories();

  // Alias/entity boost via the dictionary: resolve suggested names, boost
  // records mentioning the canonical name/aliases or linked to the entry,
  // plus one-hop related entries.
  const names = suggestEntityNames(effectiveQuery);
  const boostedIds = new Set<string>();
  for (const name of names.slice(0, 6)) {
    try {
      const resolution = await resolveEntry(name, { accountId });
      const entry = resolution.entry;
      if (!entry) continue;
      for (const record of all) {
        if (ownerOf(record) !== accountId) continue;
        const hay = `${record.entities.join(" ")} ${record.content}`.toLowerCase();
        if (
          hay.includes(entry.name.toLowerCase()) ||
          entry.aliases.some((a) => a && hay.includes(a.toLowerCase())) ||
          record.entityLinks?.some((link) => link.entryId === entry.id)
        ) {
          boostedIds.add(record.id);
        }
      }
      const neighbourhood = await traverse(entry.id, { accountId, depth: 1 });
      const relatedIds = new Set(neighbourhood.entries.map((e) => e.id));
      for (const record of all) {
        if (ownerOf(record) !== accountId) continue;
        if (record.entityLinks?.some((link) => relatedIds.has(link.entryId))) boostedIds.add(record.id);
      }
    } catch {
      // Dictionary failures degrade to lexical retrieval.
    }
  }

  const candidates = all.filter((record) => {
    if (ownerOf(record) !== accountId) return false;
    if (!isVisible(record, includeHistory)) return false;
    if (!scopeAllowedForTool(record)) return false;
    if (!includeHistory) {
      if (record.validUntil && record.validUntil <= nowIso) return false;
      if (record.validFrom && record.validFrom > nowIso) return false;
    }
    return true;
  });

  const ranked = candidates
    .map((record) => {
      const lexical = scoreMemory(record, effectiveQuery);
      const boosted = boostedIds.has(record.id);
      if (lexical <= 0 && !boosted) return null;
      const effectiveLexical = lexical > 0 ? lexical : 0.3;
      return {
        record,
        score: effectiveLexical + rankBoost(record) + (boosted ? 0.2 : 0),
      };
    })
    .filter((x): x is { record: MemoryRecord; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
    .slice(0, safeLimit);

  const results = ranked.map(({ record, score }) => ({
    ...record,
    relevance: Number(score.toFixed(3)),
  }));

  await touchAccessed(results.map((r) => r.id));
  return results;
}

export async function dictionarySnapshot(accountId = "local"): Promise<MemoryRecord[]> {
  return (await listMemories()).filter((r) => ownerOf(r) === accountId && isVisible(r));
}

export { listEntries, relationsFrom, resolveEntry, traverse };
