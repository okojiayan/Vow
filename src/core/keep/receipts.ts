import { createHash } from "node:crypto";
import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";

export interface Receipt {
  id: string;
  time: string;
  task_id: string;
  action: string;
  target?: string;
  result: string;
  reversible: boolean;
  undo_data?: { from?: string; to?: string; content_hash?: string; content?: string };
}

const STORE = () => dataPath("keep-receipts.json");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function appendReceipt(input: Omit<Receipt, "id" | "time">): Promise<Receipt> {
  const full: Receipt = { ...input, id: createId("rc"), time: new Date().toISOString() };
  await mutateJsonFile<Receipt[]>(STORE(), [], (current) => [...current, full]);
  return full;
}

export async function listReceipts(task_id?: string, limit = 100): Promise<Receipt[]> {
  const all = await readJsonFile<Receipt[]>(STORE(), []);
  const filtered = task_id ? all.filter((r) => r.task_id === task_id) : all;
  return filtered.slice(-limit).reverse();
}

export async function undoAction(action_id: string, currentContent?: string): Promise<{ ok: boolean; reason: string }> {
  const all = await readJsonFile<Receipt[]>(STORE(), []);
  const item = all.find((r) => r.id === action_id);
  if (!item) return { ok: false, reason: "Receipt not found." };
  if (!item.reversible) return { ok: false, reason: "Action is not reversible." };
  if (Date.parse(item.time) + SEVEN_DAYS_MS < Date.now()) return { ok: false, reason: "Undo window (7 days) expired." };
  if (!item.undo_data?.content_hash) return { ok: false, reason: "No undo data recorded." };
  // For file moves: caller must supply current content; refuse if changed since.
  if (currentContent !== undefined && hashContent(currentContent) !== item.undo_data.content_hash) {
    return { ok: false, reason: "File changed since the action; refusing to overwrite." };
  }
  await appendReceipt({ task_id: item.task_id, action: `undo:${item.action}`, target: item.target, result: `undid ${item.id}`, reversible: false });
  return { ok: true, reason: `Undid ${item.id}. Restore ${item.undo_data.from ?? item.target ?? "original"} from recorded content.` };
}

export async function undoTask(task_id: string): Promise<{ undone: number }> {
  const all = await listReceipts(task_id, 1000);
  let undone = 0;
  for (const r of all) {
    if (!r.reversible) continue;
    if (r.action.startsWith("undo:")) continue;
    const res = await undoAction(r.id);
    if (res.ok) undone += 1;
  }
  return { undone };
}

export async function awaySummary(task_id?: string): Promise<{ safe: number; blocked: number; waiting: number }> {
  const all = await listReceipts(task_id, 1000);
  const safe = all.filter((r) => r.result === "success" || r.action.startsWith("allow")).length;
  const blocked = all.filter((r) => r.result === "blocked" || r.action.startsWith("block")).length;
  return { safe, blocked, waiting: 0 };
}
