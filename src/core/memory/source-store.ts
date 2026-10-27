import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { MemoryRecord } from "./types";

const STORE = () => dataPath("memory.json");

export async function listMemories(): Promise<MemoryRecord[]> {
  return readJsonFile<MemoryRecord[]>(STORE(), []);
}

export async function upsertMemory(
  record: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "versions" | "conflictStatus"> & {
    id?: string;
  },
): Promise<MemoryRecord> {
  const now = new Date().toISOString();
  let saved: MemoryRecord | undefined;
  await mutateJsonFile<MemoryRecord[]>(STORE(), [], (current) => {
    if (record.id) {
      return current.map((item) => {
        if (item.id !== record.id) return item;
        saved = {
          ...item,
          ...record,
          id: item.id,
          versions: [...item.versions, { version: item.versions.length + 1, content: record.content, updatedAt: now }],
          updatedAt: now,
          conflictStatus: item.conflictStatus,
        };
        return saved;
      });
    }
    saved = {
      ...record,
      id: createId("mem"),
      conflictStatus: "none",
      versions: [{ version: 1, content: record.content, updatedAt: now }],
      createdAt: now,
      updatedAt: now,
    };
    return [saved, ...current];
  });
  if (!saved) throw new Error("Failed to persist memory.");
  return saved;
}

export async function saveMemories(records: MemoryRecord[]): Promise<void> {
  await mutateJsonFile<MemoryRecord[]>(STORE(), [], () => records);
}
