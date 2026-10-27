import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import { appendLedger, getLedger, type LedgerEvent } from "./ledger";

const STORE = () => dataPath("ledger.json");
const MAX_EVENTS_PER_TASK = 200;

type LedgerMap = Record<string, LedgerEvent[]>;

/** Persist the in-memory ledger for a task (capped). Same event schema, same persistence infra as traces. */
export async function saveLedger(taskId: string): Promise<LedgerEvent[]> {
  const events = getLedger(taskId).slice(-MAX_EVENTS_PER_TASK);
  await mutateJsonFile<LedgerMap>(STORE(), {}, (current) => ({ ...current, [taskId]: events }));
  return events;
}

/** Load persisted events back into memory (deduplicated by id). Best-effort for continuation. */
export async function loadLedger(taskId: string): Promise<LedgerEvent[]> {
  const all = await readJsonFile<LedgerMap>(STORE(), {});
  const stored = all[taskId] ?? [];
  const seen = new Set(getLedger(taskId).map((e) => e.id));
  for (const e of stored) {
    if (!seen.has(e.id)) appendLedger(taskId, { kind: e.kind, title: e.title, detail: e.detail, evidenceIds: e.evidenceIds, data: e.data });
  }
  return getLedger(taskId);
}

/** Read persisted events without touching memory. */
export async function readLedger(taskId: string): Promise<LedgerEvent[]> {
  const all = await readJsonFile<LedgerMap>(STORE(), {});
  return all[taskId] ?? [];
}
