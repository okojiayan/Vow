// Deadline Guardian — read-only reminders from existing memory + task records.
// Never writes memory, never sends messages, never touches calendars.
import { readJsonFile, dataPath, mutateJsonFile } from "@/lib/persistence";
import type { MemoryRecord } from "@/core/memory/types";
import { isVisible } from "@/core/memory/store-ops";
import { listTasks } from "@/core/agent/task-store";

export interface DeadlineItem {
  id: string;
  date: string;
  explicit: boolean;
  source: string;
  snippet: string;
  stale: boolean;
}

const MEMORY_FILE = () => dataPath("memory.json");
const DISMISS = () => dataPath("deadline-dismissals.json");

const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;

function isStale(dateIso: string, now = Date.now()): boolean {
  return Date.parse(dateIso) < now - 24 * 3600 * 1000;
}

export async function collectDeadlines(now = Date.now()): Promise<DeadlineItem[]> {
  const out: DeadlineItem[] = [];
  try {
    const mem = await readJsonFile<MemoryRecord[]>(MEMORY_FILE(), []);
    for (const r of mem) {
      if (!isVisible(r)) continue;
      const text = `${r.content} ${(r.keywords ?? []).join(" ")}`;
      ISO_DATE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ISO_DATE.exec(text)) !== null) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        if (Number.isNaN(Date.parse(iso))) continue;
        out.push({
          id: `mem:${r.id}:${iso}`,
          date: iso,
          explicit: /due|deadline|by |expires/i.test(text),
          source: `memory:${r.id}`,
          snippet: r.content.slice(0, 140),
          stale: isStale(iso, now),
        });
      }
    }
  } catch { /* read-only best effort */ }
  try {
    const tasks = await listTasks();
    for (const t of tasks) {
      ISO_DATE.lastIndex = 0;
      const text = `${t.request} ${t.resultSummary ?? ""}`;
      let m: RegExpExecArray | null;
      while ((m = ISO_DATE.exec(text)) !== null) {
        const iso = `${m[1]}-${m[2]}-${m[3]}`;
        out.push({
          id: `task:${t.id}:${iso}`,
          date: iso,
          explicit: /due|deadline|by |expires/i.test(text),
          source: `task:${t.id}`,
          snippet: t.request.slice(0, 140),
          stale: isStale(iso, now),
        });
      }
    }
  } catch { /* best effort */ }
  // Deduplicate by source+date, then remove dismissed.
  const seen = new Set<string>();
  const dismissed = new Set(await readJsonFile<string[]>(DISMISS(), []));
  return out.filter((d) => {
    const k = `${d.source}:${d.date}`;
    if (seen.has(k) || dismissed.has(d.id)) return false;
    seen.add(k);
    return true;
  });
}

export async function dismissDeadline(id: string): Promise<void> {
  await mutateJsonFile<string[]>(DISMISS(), [], (cur) => (cur.includes(id) ? cur : [...cur, id]));
}
