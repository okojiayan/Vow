import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile } from "@/lib/persistence";
import { getSettings } from "@/core/settings";
import { listMemories, saveMemories, upsertMemory } from "./source-store";
import { findByIdempotencyKey, findDuplicate, ownerOf } from "./store-ops";
import { looksContradictory } from "./conflict-resolver";
import { resolveEntry, touchEntry, upsertEntry } from "./dictionary-store";
import { suggestEntityNames } from "./extract";
import { contentFingerprint, normaliseContent, normalizeKind, validateCandidate } from "./policy";
import type {
  EvidenceKind,
  MemoryKind,
  MemoryRecord,
  MemoryScopeType,
  MemorySource,
} from "./types";

export interface SubmitInput {
  content: string;
  kind?: unknown;
  entities?: string[];
  keywords?: string[];
  conversationId?: string;
  projectId?: string;
  scope?: MemoryScopeType;
  scopeId?: string;
  source: MemorySource;
  provenance: string;
  accountId?: string;
  idempotencyKey?: string;
  validFrom?: string;
  validUntil?: string;
  confidence?: number;
  evidenceKind?: EvidenceKind;
  explicit?: boolean;
  verified?: boolean;
}

export type SubmitOutcome =
  | { stored: true; record: MemoryRecord; deduped: boolean }
  | { stored: false; reason: string; message: string };

const DURABLE_KINDS = new Set(["observation", "inference", "decision", "preference", "semantic", "project", "procedural-learning"]);

function scopeOf(input: SubmitInput, kind: MemoryKind): { scope: MemoryScopeType; scopeId?: string } {
  if (input.scope) return { scope: input.scope, scopeId: input.scopeId };
  // Durable knowledge is account-visible; session/episodic context stays
  // in its conversation. Provenance always retains the conversation link.
  if (DURABLE_KINDS.has(kind)) return { scope: "account" };
  if (input.conversationId) return { scope: "conversation", scopeId: input.conversationId };
  if (input.projectId) return { scope: "project", scopeId: input.projectId };
  return { scope: "account" };
}

export function timeOverlaps(a: { validFrom?: string; validUntil?: string }, b: { validFrom?: string; validUntil?: string }): boolean {
  const aFrom = a.validFrom ? Date.parse(a.validFrom) : Number.NEGATIVE_INFINITY;
  const aTo = a.validUntil ? Date.parse(a.validUntil) : Number.POSITIVE_INFINITY;
  const bFrom = b.validFrom ? Date.parse(b.validFrom) : Number.NEGATIVE_INFINITY;
  const bTo = b.validUntil ? Date.parse(b.validUntil) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(aFrom) || Number.isNaN(aTo) || Number.isNaN(bFrom) || Number.isNaN(bTo)) return true;
  return aFrom <= bTo && bFrom <= aTo;
}

async function reconcileConflicts(created: MemoryRecord): Promise<MemoryRecord> {
  const all = await listMemories();
  const eligible = all.filter(
    (item) =>
      item.id !== created.id &&
      ownerOf(item) === ownerOf(created) &&
      (item.status ?? "active") !== "deleted" &&
      item.entities.some((entity) => created.entities.includes(entity)) &&
      looksContradictory(item.content, created.content) &&
      timeOverlaps(item, created),
  );
  if (!eligible.length) return created;
  const conflictIds = eligible.map((item) => item.id);
  const now = new Date().toISOString();
  const next = all.map((item) => {
    if (item.id === created.id) {
      return { ...item, conflictStatus: "open" as const, conflictWith: Array.from(new Set([...(item.conflictWith ?? []), ...conflictIds])) };
    }
    if (conflictIds.includes(item.id)) {
      return {
        ...item,
        conflictStatus: "open" as const,
        conflictWith: Array.from(new Set([...(item.conflictWith ?? []), created.id])),
        updatedAt: now,
      };
    }
    return item;
  });
  await saveMemories(next);
  return next.find((item) => item.id === created.id) ?? created;
}

/** Full capture→validate→resolve→dedupe→persist→reconcile pipeline. */
export async function submitCandidate(input: SubmitInput): Promise<SubmitOutcome> {
  const accountId = input.accountId ?? "local";
  const settings = await getSettings();
  if (!settings.memoryEnabled) {
    return { stored: false, reason: "memory_disabled", message: "Memory is disabled; nothing was stored." };
  }
  const validation = validateCandidate(input.content);
  if (!validation.ok) {
    return { stored: false, reason: validation.reason ?? "invalid", message: validation.message ?? "Invalid memory candidate." };
  }
  const content = normaliseContent(input.content);
  const requestedKind = normalizeKind(input.kind) ?? "observation";

  // Fast-path unlocked checks (efficiency only; correctness enforced atomically below).
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(input.idempotencyKey, accountId);
    if (existing) return { stored: true, record: existing, deduped: true };
  }
  const { scope, scopeId } = scopeOf(input, requestedKind);
  const duplicate = await findDuplicate(contentFingerprint(content), {
    scope,
    scopeId,
    projectId: input.projectId,
    conversationId: input.conversationId,
  }, accountId);
  if (duplicate) return { stored: true, record: duplicate, deduped: true };

  const isUserExplicit = input.explicit ?? input.source.type === "user";
  const inferredPreference = requestedKind === "preference" && !isUserExplicit;
  const evidenceKind: EvidenceKind =
    input.evidenceKind ?? (isUserExplicit ? "direct" : input.source.type === "tool" ? "tool-observed" : "inferred");

  const entityNames = Array.from(new Set([...(input.entities ?? []), ...suggestEntityNames(content)]));
  const entityLinks: NonNullable<MemoryRecord["entityLinks"]> = [];
  if (isUserExplicit) {
    for (const name of entityNames.slice(0, 8)) {
      try {
        const resolution = await resolveEntry(name, { accountId });
        if (resolution.entry) {
          entityLinks.push({ entryId: resolution.entry.id });
          await touchEntry(resolution.entry.id, accountId);
        } else if (resolution.provisional && name.length >= 3) {
          const created = await upsertEntry({
            type: /^[A-Z]/.test(name) && name.split(/\s+/).length <= 3 ? "concept" : "concept",
            name,
            provenance: input.provenance,
            accountId,
            status: "unverified",
          });
          entityLinks.push({ entryId: created.id });
        }
      } catch {
        // Dictionary failures must not block memory persistence.
      }
    }
  } else {
    for (const name of entityNames.slice(0, 8)) {
      try {
        const resolution = await resolveEntry(name, { accountId });
        if (resolution.entry && !resolution.provisional) {
          entityLinks.push({ entryId: resolution.entry.id });
        }
      } catch {
        // ignore
      }
    }
  }

  // Atomic reserve: re-check idempotency + duplicate inside the memory.json
  // lock so 8 concurrent same-key submits collapse to one record. The queue
  // in persistence serializes mutateJsonFile callers; unlocked reads above
  // are only a fast path.
  const nowIso = new Date().toISOString();
  const pendingBase = {
    content,
    kind: requestedKind,
    entities: entityNames,
    keywords: input.keywords ?? [],
    projectId: input.projectId,
    conversationId: input.conversationId,
    source: input.source,
    provenance: input.provenance,
    accountId,
    scope,
    scopeId,
    status: "candidate" as const,
    confidence: input.confidence ?? (isUserExplicit ? 0.9 : inferredPreference ? 0.35 : 0.6),
    verificationStatus: (input.verified === true && !validation.injectionSuspect ? "verified" : "unverified") as MemoryRecord["verificationStatus"],
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    importance: 0.5,
    sensitivity: (validation.sensitive ? "sensitive" : "normal") as MemoryRecord["sensitivity"],
    idempotencyKey: input.idempotencyKey,
    entityLinks: entityLinks.length ? entityLinks : undefined,
    evidence: {
      kind: evidenceKind,
      sourceType: input.source.type,
      sourceRef: input.source.ref,
      excerpt: content.slice(0, 280),
      capturedAt: nowIso,
      untrusted: validation.injectionSuspect || evidenceKind === "external" || evidenceKind === "inferred",
    },
  };
  let created: MemoryRecord | undefined;
  let atomicDeduped: MemoryRecord | undefined;
  await mutateJsonFile<MemoryRecord[]>(dataPath("memory.json"), [], (current) => {
    if (input.idempotencyKey) {
      const ex = current.find(
        (item) => item.idempotencyKey === input.idempotencyKey && ownerOf(item) === accountId,
      );
      if (ex) {
        atomicDeduped = ex;
        return current;
      }
    }
    const fp = contentFingerprint(content);
    const dup = current.find((item) => {
      if (ownerOf(item) !== accountId) return false;
      if ((item.status ?? "active") === "deleted") return false;
      if (item.content.trim().toLowerCase() !== fp) return false;
      if ((item.scope ?? "account") !== (scope ?? "account")) return false;
      if ((item.scopeId ?? "") !== (scopeId ?? "")) return false;
      if ((item.projectId ?? "") !== (input.projectId ?? "")) return false;
      if ((item.conversationId ?? "") !== (input.conversationId ?? "")) return false;
      return true;
    });
    if (dup) {
      atomicDeduped = dup;
      return current;
    }
    const rec: MemoryRecord = {
      ...(pendingBase as Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "versions" | "conflictStatus">),
      id: createId("mem"),
      conflictStatus: "none",
      versions: [{ version: 1, content, updatedAt: nowIso }],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    created = rec;
    return [rec, ...current];
  });
  if (atomicDeduped) return { stored: true, record: atomicDeduped, deduped: true };
  if (!created) {
    // Extremely unlikely: fall back to legacy path (should not happen).
    const fallback = await upsertMemory({
      ...pendingBase,
      status: "candidate",
    } as Parameters<typeof upsertMemory>[0]);
    created = fallback;
  }
  const createdRecord: MemoryRecord = created;

  // Promote validated candidates to active (explicit or observed; inferences stay candidate until reinforced).
  const promote = isUserExplicit || input.source.type === "tool" || input.source.type === "system";
  let record: MemoryRecord = createdRecord;
  if (promote) {
    const all = await listMemories();
    const next = all.map((item) => (item.id === createdRecord.id ? { ...item, status: "active" as const } : item));
    await saveMemories(next);
    record = next.find((item) => item.id === createdRecord.id) ?? createdRecord;
  }
  record = await reconcileConflicts(record);
  return { stored: true, record, deduped: false };
}

export type { MemoryKind, MemoryScopeType, MemorySource };
