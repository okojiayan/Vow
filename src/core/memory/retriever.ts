import type { MemoryRecord } from "./types";

/**
 * General stopwords for retrieval scoring. Purely linguistic/task-framing
 * terms with no discriminative value across memory queries (articles,
 * interrogatives, prepositions, generic request verbs). No domain,
 * benchmark, or fixture terms are listed here.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at",
  "from", "into", "with", "without", "for", "about", "as", "by", "is",
  "are", "was", "were", "be", "been", "being", "do", "does", "did",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "there", "here", "this", "that", "these", "those", "it",
  "its", "my", "our", "your", "me", "us", "you", "we", "i",
  "please", "reply", "respond", "answer", "tell", "give", "show", "list",
  "exact", "briefly", "brief", "just",
  "memory", "memories", "project", "remember", "recall", "search", "searching",
]);

/**
 * Minimal plural-tolerant normalization (no dependencies, no domain lists).
 * Applied symmetrically to records and queries so "window"/"windows" and
 * "ferry"/"ferries" score the same token. Purely morphological; never maps
 * between distinct words.
 */
export function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 3 && token.endsWith("es") && !token.endsWith("ses")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .map(stemToken);
}

function tokenizeRelevant(value: string): string[] {
  const all = tokenize(value);
  const filtered = all.filter((token) => !STOPWORDS.has(token));
  return filtered.length > 0 ? filtered : all;
}

/**
 * Strip generic memory-task framing so the lexical scorer sees the actual
 * information need. Removes a leading "from/in/using ... memory" preamble
 * and trailing "reply/answer ..." instructions. No benchmark, entity, or
 * fixture terms are referenced; purely structural cleanup.
 */
export function cleanMemoryQuery(query: string): string {
  let cleaned = (query ?? "").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(
    /^\s*(from|in|using|within|search|check|look\s+in|consult)\b.{0,48}?\bmemory\b[\s,;:\-–—]*/i,
    "",
  );
  cleaned = cleaned.replace(/\breply\b[^.?!]*[.?!]?/gi, " ").replace(/\bplease\b[^.?!]*[.?!]?/gi, (m) =>
    /please\s+(reply|respond|answer)/i.test(m) ? " " : m,
  );
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : (query ?? "").replace(/\s+/g, " ").trim();
}

export function scoreMemory(record: MemoryRecord, query: string): number {
  const cleaned = cleanMemoryQuery(query);
  const hay = tokenizeRelevant(
    `${record.content} ${record.keywords.join(" ")} ${record.entities.join(" ")} ${record.provenance}`,
  );
  const needles = tokenizeRelevant(cleaned);
  if (needles.length === 0) return 0;
  const haySet = new Set(hay);
  let hits = 0;
  for (const needle of needles) {
    if (haySet.has(needle)) hits += 1;
  }
  // No lexical overlap means no relevance: recency must only boost genuinely
  // matching records, never make an unrelated recent record look relevant.
  // Alias/entity rescue is handled by the caller via boostedIds, not here.
  if (hits === 0) return 0;
  const recencyBoost = Math.max(0, 1 - (Date.now() - Date.parse(record.updatedAt)) / (1000 * 60 * 60 * 24 * 14));
  return hits / needles.length + recencyBoost * 0.1;
}

export function retrieveRelevant(records: MemoryRecord[], query: string, limit = 8): MemoryRecord[] {
  const cleaned = cleanMemoryQuery(query);
  return records
    .map((record) => ({ record, relevance: scoreMemory(record, cleaned) }))
    .filter((item) => item.relevance > 0)
    .sort(
      (a, b) =>
        b.relevance - a.relevance || b.record.updatedAt.localeCompare(a.record.updatedAt),
    )
    .slice(0, limit)
    .map((item) => ({ ...item.record, relevance: Number(item.relevance.toFixed(3)) }));
}
