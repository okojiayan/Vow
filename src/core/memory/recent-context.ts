import type { MemoryRecord } from "./types";

export function recentContext(records: MemoryRecord[], limit = 6): MemoryRecord[] {
  return [...records]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
