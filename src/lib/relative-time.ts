/** Honest relative timestamps from real ISO dates. Never fabricates. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = now - t;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Latest real timestamp across a message list, for honest recency. */
export function latestMessageTime(messages: Array<{ createdAt?: string }>): string | null {
  let best: string | null = null;
  for (const m of messages) {
    if (m.createdAt && (!best || m.createdAt > best)) best = m.createdAt;
  }
  return best;
}
