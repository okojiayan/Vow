import { createId } from "@/lib/ids";
import { listMemories, saveMemories } from "./source-store";
import { submitCandidate } from "./lifecycle";
import type { MemoryKind, MemoryRecord, MemorySource } from "./types";

/**
 * Legacy remember() — now delegates to the lifecycle pipeline (validation,
 * dedupe, dictionary resolution, time-aware conflict reconciliation).
 * Never throws for policy rejections; returns the persisted record, or an
 * unpersisted candidate shell so fire-and-forget callers keep working.
 */
export async function remember(input: {
  content: string;
  kind: MemoryKind;
  entities?: string[];
  keywords?: string[];
  conversationId?: string;
  projectId?: string;
  source: MemorySource;
  provenance: string;
  idempotencyKey?: string;
}): Promise<MemoryRecord> {
  const outcome = await submitCandidate({
    content: input.content,
    kind: input.kind,
    entities: input.entities,
    keywords: input.keywords,
    conversationId: input.conversationId,
    projectId: input.projectId,
    source: input.source,
    provenance: input.provenance,
    idempotencyKey: input.idempotencyKey,
  });
  if (outcome.stored) return outcome.record;
  const now = new Date().toISOString();
  return {
    id: createId("mem-ephemeral"),
    content: input.content.slice(0, 2000),
    kind: input.kind,
    entities: input.entities ?? [],
    keywords: input.keywords ?? [],
    projectId: input.projectId,
    conversationId: input.conversationId,
    source: input.source,
    provenance: input.provenance,
    conflictStatus: "none",
    versions: [],
    createdAt: now,
    updatedAt: now,
    status: "candidate",
  };
}

export async function consolidate(records: MemoryRecord[]): Promise<MemoryRecord[]> {
  const byKey = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const key = record.entities.sort().join("|") || record.keywords.sort().slice(0, 3).join("|");
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }
  const kept: MemoryRecord[] = [];
  for (const group of byKey.values()) {
    const failures = group.filter((item) => item.kind === "failure");
    const others = group.filter((item) => item.kind !== "failure");
    kept.push(...failures);
    kept.push(...others);
  }
  return kept;
}

export { listMemories, saveMemories };
