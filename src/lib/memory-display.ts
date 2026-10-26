export interface MemoryDisplayRecord {
  id: string;
  content: string;
  category: string;
  source: string;
  createdAt: string;
  tags: string[];
}

/** Render an API `source` field (string or structured `{type, ref}`) as plain text. */
export function formatRecordSource(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") {
    const s = raw as { type?: unknown; ref?: unknown };
    if (typeof s.type === "string" && typeof s.ref === "string") return `${s.type}:${s.ref}`;
  }
  return "Conversation";
}

/**
 * Normalize a raw `/api/memory` record to the display shape.
 * The API returns structured records (`source` is `{type, ref}`, category
 * lives in `kind`); the Memory page must never hand a raw object to React.
 */
export function toDisplayRecord(raw: Record<string, unknown>): MemoryDisplayRecord {
  const content = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content ?? "");
  const category =
    typeof raw.category === "string" && raw.category.trim()
      ? raw.category
      : typeof raw.kind === "string" && raw.kind.trim()
        ? raw.kind
        : "General";
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.trim()
      ? raw.createdAt
      : typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : "Recently";
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t))
    : Array.isArray(raw.keywords)
      ? (raw.keywords as unknown[]).map((t) => String(t))
      : [];
  const id = typeof raw.id === "string" ? raw.id : `m-${Math.random().toString(36).slice(2)}`;
  return { id, content, category, source: formatRecordSource(raw.source ?? raw.provenance), createdAt, tags };
}

/** Stage 5a: system-provenance entries belong in Diagnostics, never in default views. */
export function isDiagnosticMemory(raw: { kind?: unknown; provenance?: unknown; source?: unknown }): boolean {
  const kind = typeof raw.kind === "string" ? raw.kind.toLowerCase() : "";
  if (kind === "failure") return true;
  const p = formatRecordSource(raw.source ?? raw.provenance).toLowerCase();
  return (
    p === "task-completion" ||
    p.startsWith("task-completion:") ||
    p.startsWith("system:") ||
    p.startsWith("verifier") ||
    p.startsWith("warden:") ||
    p.startsWith("tool:") ||
    p.includes("verifier") ||
    p.includes("warden")
  );
}
