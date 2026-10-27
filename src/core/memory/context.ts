import { listMemories } from "./source-store";
import { cleanMemoryQuery, scoreMemory } from "./retriever";
import { isVisible, ownerOf, touchAccessed } from "./store-ops";
import { resolveEntry, traverse } from "./dictionary-store";
import { suggestEntityNames } from "./extract";
import type { MemoryRecord } from "./types";

export interface BundleQuery {
  query: string;
  accountId?: string;
  projectId?: string;
  conversationId?: string;
  taskId?: string;
  limit?: number;
  budgetChars?: number;
  includeHistory?: boolean;
  now?: string;
}

export interface BundleItem {
  id: string;
  content: string;
  kind: string;
  scope?: string;
  provenance: string;
  source: MemoryRecord["source"];
  verificationStatus: string;
  confidence?: number;
  importance?: number;
  status: string;
  conflictStatus: string;
  entities: string[];
  keywords: string[];
  evidenceUntrusted: boolean;
  lastAccessedAt?: string;
  updatedAt: string;
  temporal?: { validFrom?: string; validUntil?: string };
  truncated: boolean;
}

export interface ContextBundle {
  items: BundleItem[];
  totalCandidates: number;
  budgetChars: number;
  charsUsed: number;
  partial: boolean;
}

function scopeAllowed(record: MemoryRecord, q: { projectId: string; conversationId: string; taskId: string }): boolean {
  const scope = record.scope ?? "account";
  if (scope === "account") return true;
  if (scope === "project") return !!q.projectId && (record.scopeId === q.projectId || record.projectId === q.projectId);
  if (scope === "conversation") return !!q.conversationId && record.scopeId === q.conversationId;
  if (scope === "task") return !!q.taskId && record.scopeId === q.taskId;
  return false;
}

export function rankBoost(record: MemoryRecord): number {
  let boost = 0;
  // Source authority: user requests outrank tool observations outrank model guesses.
  if (record.source.type === "user") boost += 0.15;
  else if (record.source.type === "tool") boost += 0.08;
  else if (record.source.type === "model") boost += 0.02;
  else if (record.source.type === "system") boost += 0.02;
  if (record.provenance.startsWith("user-explicit") || record.provenance.startsWith("user:")) boost += 0.1;
  if (record.verificationStatus === "verified") boost += 0.1;
  if (record.verificationStatus === "disputed") boost -= 0.1;
  if (record.pinned) boost += 0.1;
  if (record.kind === "preference" && record.source.type === "user") boost += 0.05;
  // Confidence / importance metadata stored at submit time.
  const confidence = typeof record.confidence === "number" ? record.confidence : undefined;
  if (confidence !== undefined) {
    if (confidence >= 0.8) boost += 0.06;
    else if (confidence >= 0.5) boost += 0.02;
    else if (confidence < 0.4) boost -= 0.05;
  }
  const importance = typeof record.importance === "number" ? record.importance : undefined;
  if (importance !== undefined) {
    if (importance >= 0.7) boost += 0.05;
    else if (importance <= 0.3) boost -= 0.03;
  }
  // Evidence trust: external/inferred or injection-suspect stays retrievable
  // but ranks below direct observations. Never hidden, just deprioritised.
  if (record.evidence?.untrusted) boost -= 0.15;
  // Conflict / lifecycle state: open conflicts and unpromoted candidates rank lower.
  if (record.conflictStatus === "open") boost -= 0.08;
  else if (record.conflictStatus === "acknowledged") boost -= 0.04;
  if ((record.status ?? "active") === "candidate") boost -= 0.03;
  // Durable knowledge outranks session scratch for the same lexical hit.
  if (record.kind === "semantic" || record.kind === "decision" || record.kind === "project") boost += 0.03;
  else if (record.kind === "working" || record.kind === "episodic") boost -= 0.02;
  // Structured grounding: entity-linked records survived dictionary resolution.
  if (record.entityLinks?.length) boost += 0.03;
  // Near-expiry facts are still visible but deprioritised.
  if (record.validUntil) {
    const msLeft = Date.parse(record.validUntil) - Date.now();
    if (Number.isFinite(msLeft) && msLeft < 7 * 24 * 3600 * 1000) boost -= 0.03;
  }
  return boost;
}

export async function buildContextBundle(input: BundleQuery): Promise<ContextBundle> {
  const accountId = input.accountId ?? "local";
  const limit = Math.max(1, Math.min(input.limit ?? 8, 25));
  const budgetChars = Math.max(500, Math.min(input.budgetChars ?? 4000, 20000));
  const includeHistory = input.includeHistory ?? false;
  const nowIso = input.now ?? new Date().toISOString();
  const scopeCtx = {
    projectId: input.projectId ?? "",
    conversationId: input.conversationId ?? "",
    taskId: input.taskId ?? "",
  };

  const all = await listMemories();
  const cleanedQuery = cleanMemoryQuery(input.query);
  const names = suggestEntityNames(cleanedQuery.length > 0 ? cleanedQuery : input.query);
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
    if (!scopeAllowed(record, scopeCtx)) return false;
    if (!includeHistory) {
      if (record.validUntil && record.validUntil <= nowIso) return false;
      if (record.validFrom && record.validFrom > nowIso) return false;
    }
    return true;
  });

  const ranked = candidates
    .map((record) => {
      const lexical = scoreMemory(record, cleanedQuery.length > 0 ? cleanedQuery : input.query);
      const boosted = boostedIds.has(record.id);
      // Alias/entity-linked records stay retrievable even when the phrasing
      // shares no surface token: give them a lexical floor so dictionary
      // resolution (aliases, relations) can rescue paraphrased queries.
      // Pure lexical misses without entity support still return null.
      if (lexical <= 0 && !boosted) return null;
      const effectiveLexical = lexical > 0 ? lexical : 0.3;
      return { record, score: effectiveLexical + rankBoost(record) + (boosted ? 0.2 : 0) };
    })
    .filter((x): x is { record: MemoryRecord; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
    .slice(0, limit);

  const items: BundleItem[] = [];
  let charsUsed = 0;
  let partial = false;
  for (const { record } of ranked) {
    const remaining = budgetChars - charsUsed;
    if (remaining < 120) {
      partial = true;
      break;
    }
    const full = record.content;
    const slice = full.length > remaining ? full.slice(0, Math.max(0, remaining - 24)) + "…[truncated]" : full;
    charsUsed += slice.length;
    if (slice.length < full.length) partial = true;
    items.push({
      id: record.id,
      content: slice,
      kind: record.kind,
      scope: record.scope ?? "account",
      provenance: record.provenance,
      source: record.source,
      verificationStatus: record.verificationStatus ?? "unverified",
      confidence: record.confidence,
      importance: record.importance,
      status: record.status ?? "active",
      conflictStatus: record.conflictStatus,
      entities: record.entities ?? [],
      keywords: record.keywords ?? [],
      evidenceUntrusted: record.evidence?.untrusted ?? false,
      lastAccessedAt: record.lastAccessedAt,
      updatedAt: record.updatedAt,
      temporal: record.validFrom || record.validUntil ? { validFrom: record.validFrom, validUntil: record.validUntil } : undefined,
      truncated: slice.length < full.length,
    });
  }

  await touchAccessed(items.map((item) => item.id));
  return { items, totalCandidates: candidates.length, budgetChars, charsUsed, partial };
}
