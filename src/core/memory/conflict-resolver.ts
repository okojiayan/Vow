import type { MemoryRecord } from "./types";

const NEGATIONS = /\b(not|never|failed|failure|unsuccessful|denied|blocked|false)\b/i;

export function looksContradictory(a: string, b: string): boolean {
  const aNeg = NEGATIONS.test(a);
  const bNeg = NEGATIONS.test(b);
  if (aNeg === bNeg) return false;
  const tokensA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const tokensB = b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const overlap = tokensB.filter((token) => tokensA.has(token) && token.length > 3);
  return overlap.length >= 2;
}

export function markConflicts(records: MemoryRecord[], incoming: MemoryRecord): MemoryRecord[] {
  const conflicts: string[] = [];
  const updated = records.map((record) => {
    if (record.id === incoming.id) return record;
    const entityOverlap = record.entities.some((entity) => incoming.entities.includes(entity));
    if (!entityOverlap && !looksContradictory(record.content, incoming.content)) {
      return record;
    }
    if (looksContradictory(record.content, incoming.content) || entityOverlap && looksContradictory(record.content, incoming.content)) {
      conflicts.push(record.id);
      return {
        ...record,
        conflictStatus: "open" as const,
        conflictWith: Array.from(new Set([...(record.conflictWith ?? []), incoming.id])),
      };
    }
    return record;
  });

  const nextIncoming: MemoryRecord = conflicts.length
    ? { ...incoming, conflictStatus: "open", conflictWith: conflicts }
    : incoming;

  return updated.map((record) => (record.id === nextIncoming.id ? nextIncoming : record)).concat(
    updated.some((record) => record.id === nextIncoming.id) ? [] : [nextIncoming],
  );
}
