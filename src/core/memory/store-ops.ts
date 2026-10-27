import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { MemoryRecord } from "./types";

const STORE = () => dataPath("memory.json");

export function ownerOf(record: MemoryRecord): string {
  return record.accountId ?? "local";
}

/** Normal retrieval excludes deleted; history views may include superseded/archived. */
export function isVisible(record: MemoryRecord, includeHistory = false): boolean {
  if ((record.status ?? "active") === "deleted") return false;
  if (!includeHistory && (record.status === "superseded" || record.status === "expired" || record.status === "archived")) {
    return false;
  }
  return true;
}

export async function getMemory(id: string, accountId = "local"): Promise<MemoryRecord | null> {
  const all = await readJsonFile<MemoryRecord[]>(STORE(), []);
  const found = all.find((item) => item.id === id);
  if (!found || ownerOf(found) !== accountId) return null;
  return found;
}

export async function findByIdempotencyKey(key: string, accountId = "local"): Promise<MemoryRecord | null> {
  if (!key) return null;
  const all = await readJsonFile<MemoryRecord[]>(STORE(), []);
  return all.find((item) => item.idempotencyKey === key && ownerOf(item) === accountId) ?? null;
}

export async function findDuplicate(
  fingerprint: string,
  scope: { scope?: string; scopeId?: string; projectId?: string; conversationId?: string },
  accountId = "local",
): Promise<MemoryRecord | null> {
  const all = await readJsonFile<MemoryRecord[]>(STORE(), []);
  const norm = fingerprint.trim().toLowerCase();
  return (
    all.find(
      (item) =>
        ownerOf(item) === accountId &&
        isVisible(item, true) &&
        item.content.trim().toLowerCase() === norm &&
        (item.scope ?? "account") === (scope.scope ?? "account") &&
        (item.scopeId ?? "") === (scope.scopeId ?? "") &&
        (item.projectId ?? "") === (scope.projectId ?? "") &&
        (item.conversationId ?? "") === (scope.conversationId ?? ""),
    ) ?? null
  );
}

export async function correctMemory(
  id: string,
  content: string,
  accountId = "local",
  provenance = "user:correction",
): Promise<MemoryRecord> {
  const now = new Date().toISOString();
  let saved: MemoryRecord | undefined;
  await mutateJsonFile<MemoryRecord[]>(STORE(), [], (current) => {
    const target = current.find((item) => item.id === id);
    if (!target || ownerOf(target) !== accountId) throw new Error("Memory not found.");
    const corrected: MemoryRecord = {
      ...target,
      id: createId("mem"),
      content,
      supersedes: [target.id],
      status: "active",
      verificationStatus: "unverified",
      entityLinks: target.entityLinks,
      provenance,
      versions: [{ version: 1, content, updatedAt: now }],
      createdAt: now,
      updatedAt: now,
      conflictStatus: "none",
      conflictWith: [],
    };
    saved = corrected;
    return current.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "superseded" as const,
            supersededBy: corrected.id,
            updatedAt: now,
            versions: [...item.versions, { version: item.versions.length + 1, content: item.content, updatedAt: now }],
          }
        : item,
    ).concat([corrected]);
  });
  if (!saved) throw new Error("Failed to persist correction.");
  return saved;
}

export async function setMemoryStatus(
  id: string,
  status: NonNullable<MemoryRecord["status"]>,
  accountId = "local",
  options?: { pinned?: boolean; verificationStatus?: MemoryRecord["verificationStatus"] },
): Promise<MemoryRecord> {
  const now = new Date().toISOString();
  let saved: MemoryRecord | undefined;
  await mutateJsonFile<MemoryRecord[]>(STORE(), [], (current) =>
    current.map((item) => {
      if (item.id !== id || ownerOf(item) !== accountId) return item;
      saved = {
        ...item,
        status,
        pinned: options?.pinned ?? item.pinned,
        verificationStatus: options?.verificationStatus ?? item.verificationStatus,
        updatedAt: now,
      };
      return saved;
    }),
  );
  if (!saved) throw new Error("Memory not found.");
  return saved;
}

/** Tombstone: excluded from normal retrieval; content retained for audit. */
export async function deleteMemory(id: string, accountId = "local"): Promise<MemoryRecord> {
  return setMemoryStatus(id, "deleted", accountId);
}

export async function touchAccessed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  const set = new Set(ids);
  await mutateJsonFile<MemoryRecord[]>(STORE(), [], (current) =>
    current.map((item) => (set.has(item.id) ? { ...item, lastAccessedAt: now } : item)),
  );
}
