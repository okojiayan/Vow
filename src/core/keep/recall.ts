import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";

export interface RecallEntry {
  id: string;
  chat_id: string;
  turn_ref: string;
  date: string;
  content: string;
  keywords: string[];
  topic: string;
  type: "fact" | "preference" | "decision";
  said_by: "user" | "inferred";
  last_confirmed: string;
  supersedes?: string;
  superseded_by?: string;
  importance: number;
  source: "user" | "tool" | "file" | "model";
}

const STORE = () => dataPath("keep-recall.json");

function keywordFallback(text: string): string[] {
  const stop = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "my", "me", "i", "you", "that", "this", "for", "on"]);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
  const uniq: string[] = [];
  for (const w of words) if (!uniq.includes(w) && uniq.length < 8) uniq.push(w);
  return uniq;
}

export async function rememberExchange(input: {
  chat_id: string;
  turn_ref: string;
  content: string;
  topic?: string;
  type?: RecallEntry["type"];
  said_by?: RecallEntry["said_by"];
  source: RecallEntry["source"];
  importance?: number;
}): Promise<{ ok: boolean; reason?: string; entry?: RecallEntry }> {
  // Write gate: ONLY user messages can create or change memories.
  if (input.source !== "user") {
    return { ok: false, reason: "Refused: only user messages can write memory. Tool/file/model content is untrusted data." };
  }
  const now = new Date().toISOString();
  const entry: RecallEntry = {
    id: createId("mem"),
    chat_id: input.chat_id,
    turn_ref: input.turn_ref,
    date: now,
    content: input.content,
    keywords: keywordFallback(input.content),
    topic: input.topic ?? keywordFallback(input.content).slice(0, 3).join(" "),
    type: input.type ?? "fact",
    said_by: input.said_by ?? "user",
    last_confirmed: now,
    importance: input.importance ?? 1,
    source: "user",
  };
  await mutateJsonFile<RecallEntry[]>(STORE(), [], (current) => [...current, entry]);
  return { ok: true, entry };
}

export async function listRecall(): Promise<RecallEntry[]> {
  return readJsonFile<RecallEntry[]>(STORE(), []);
}

function scoreEntry(entry: RecallEntry, query: string, now: number): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of q) {
    if (entry.content.toLowerCase().includes(token)) score += 2;
    if (entry.keywords.some((k) => k.includes(token) || token.includes(k))) score += 3;
    if (entry.topic.toLowerCase().includes(token)) score += 2;
  }
  const ageDays = Math.max(0, (now - Date.parse(entry.date)) / 86400000);
  score += entry.importance * 0.5 - Math.min(2, ageDays / 30);
  if (entry.superseded_by) score -= 5;
  return score;
}

export async function recall(query: string, limit = 3): Promise<{ entries: RecallEntry[]; source_refs: string[] }> {
  const all = await listRecall();
  const now = Date.now();
  const ranked = all
    .map((e) => ({ e, s: scoreEntry(e, query, now) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
  return { entries: ranked, source_refs: ranked.map((e) => `Found in memory: ${e.chat_id} · ${e.date.slice(0, 10)}`) };
}

export async function supersede(id: string, byId: string): Promise<void> {
  await mutateJsonFile<RecallEntry[]>(STORE(), [], (current) =>
    current.map((e) => (e.id === id ? { ...e, superseded_by: byId } : e)),
  );
}

export async function editRecall(id: string, content: string): Promise<RecallEntry | null> {
  let out: RecallEntry | null = null;
  await mutateJsonFile<RecallEntry[]>(STORE(), [], (current) =>
    current.map((e) => {
      if (e.id !== id) return e;
      out = { ...e, content, keywords: keywordFallback(content), last_confirmed: new Date().toISOString() };
      return out;
    }),
  );
  return out;
}

export async function deleteRecall(id: string): Promise<void> {
  await mutateJsonFile<RecallEntry[]>(STORE(), [], (current) => current.filter((e) => e.id !== id));
}

export async function exportRecall(): Promise<RecallEntry[]> {
  return listRecall();
}
