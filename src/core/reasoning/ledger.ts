import { createId } from "@/lib/ids";

export type LedgerEventKind = "decision" | "evidence" | "tool_outcome" | "transition" | "escalation" | "verification";
export interface LedgerEvent {
  id: string; taskId: string; kind: LedgerEventKind; title: string; detail?: string;
  evidenceIds?: string[]; data?: unknown; createdAt: string;
}

const stores = new Map<string, LedgerEvent[]>();
export function appendLedger(taskId: string, e: Omit<LedgerEvent, "id" | "taskId" | "createdAt">): LedgerEvent {
  const ev: LedgerEvent = { ...e, id: createId("led"), taskId, createdAt: new Date().toISOString() };
  stores.set(taskId, [...(stores.get(taskId) ?? []), ev]);
  return ev;
}
export function getLedger(taskId: string): LedgerEvent[] { return [...(stores.get(taskId) ?? [])]; }
export function clearLedger(taskId?: string): void { if (taskId) stores.delete(taskId); else stores.clear(); }
