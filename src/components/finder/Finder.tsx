"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Field, Input } from "@/components/ui/fields";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/feedback";

export interface FinderItem {
  id: string;
  title: string;
  meta: string;
}

export interface FinderGroup {
  key: string;
  label: string;
  items: FinderItem[];
}

/**
 * Stage 5a shared search pattern: search + filter bar, results grouped by
 * type, keyboard navigation (up/down + enter), preview pane on selection.
 * Raw UUIDs stay behind a copy control — only short ids print.
 */
export function Finder({
  placeholder,
  filterLabel,
  filterOptions,
  filterValue,
  onFilter,
  groups,
  emptyTitle,
  emptyBody,
  previewTitle,
  renderPreview,
  onOpen,
  openLabel,
}: {
  placeholder: string;
  filterLabel: string;
  filterOptions: { value: string; label: string }[];
  filterValue: string;
  onFilter: (v: string) => void;
  groups: FinderGroup[];
  emptyTitle: string;
  emptyBody: string;
  previewTitle: string;
  renderPreview: (item: FinderItem) => React.ReactNode;
  onOpen?: (item: FinderItem) => void;
  openLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  const q = debounced.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          items: q
            ? g.items.filter(
                (i) => i.title.toLowerCase().includes(q) || i.meta.toLowerCase().includes(q),
              )
            : g.items,
        }))
        .filter((g) => g.items.length > 0),
    [groups, q],
  );
  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);
  const active = flat.find((i) => i.id === activeId) ?? null;

  useEffect(() => {
    if (activeId && !flat.some((i) => i.id === activeId)) setActiveId(null);
  }, [activeId, flat]);

  const move = (dir: 1 | -1) => {
    if (flat.length === 0) return;
    const idx = flat.findIndex((i) => i.id === activeId);
    const next = flat[(idx + dir + flat.length) % flat.length];
    setActiveId(next.id);
    itemRefs.current.get(next.id)?.focus();
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      /* clipboard unavailable; id stays visible in title */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 14)}…` : id);

  return (
    <div>
      <div style={{ display: "flex", gap: "var(--ds-space-3)", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "var(--ds-space-4)" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <Field label="Search">
            {(id) => <Input id={id} placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />}
          </Field>
        </div>
        <Segmented<string> label={filterLabel} value={filterValue} onChange={onFilter} options={filterOptions} />
      </div>

      {flat.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 380px)",
            gap: "var(--ds-space-4)",
            alignItems: "start",
          }}
          className="ds-finder-grid"
        >
          <div
            role="listbox"
            aria-label="Results"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
              else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
              else if (e.key === "Enter" && active && onOpen) { e.preventDefault(); onOpen(active); }
            }}
            style={{ display: "grid", gap: "var(--ds-space-4)", minWidth: 0 }}
          >
            {filtered.map((g) => (
              <section key={g.key} aria-label={g.label} style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 var(--ds-space-2)" }}>
                  {g.label} ({g.items.length})
                </h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-2)" }}>
                  {g.items.map((item) => {
                    const selected = item.id === activeId;
                    return (
                      <li key={item.id}>
                        <button
                          ref={(el) => {
                            if (el) itemRefs.current.set(item.id, el);
                            else itemRefs.current.delete(item.id);
                          }}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => setActiveId(item.id)}
                          onDoubleClick={() => onOpen?.(item)}
                          className="ds-btn"
                          style={{
                            width: "100%",
                            textAlign: "left",
                            display: "block",
                            background: selected ? "var(--ds-accent-wash)" : "var(--ds-surface)",
                            border: `1px solid ${selected ? "var(--ds-accent)" : "var(--ds-border)"}`,
                            borderRadius: "var(--ds-radius-md)",
                            padding: "10px 14px",
                          }}
                        >
                          <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: selected ? 600 : 500, color: "var(--ds-ink)", overflowWrap: "break-word" }}>{item.title}</span>
                          <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", marginTop: 2 }}>{item.meta}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <aside
            aria-label={previewTitle}
            aria-live="polite"
            style={{
              background: "var(--ds-surface)",
              border: "1px solid var(--ds-border)",
              borderRadius: "var(--ds-radius-lg)",
              padding: "var(--ds-space-4)",
              position: "sticky",
              top: 12,
              minWidth: 0,
            }}
            className="ds-finder-preview"
          >
            {active ? (
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-2)", flexWrap: "wrap", marginBottom: "var(--ds-space-3)" }}>
                  <span title={active.id} style={{ fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-muted)" }}>
                    {shortId(active.id)}
                  </span>
                  <Button variant="ghost" size="sm" icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={() => void copyId(active.id)} aria-label={`Copy full ID ${active.id}`}>
                    {copied ? "Copied" : "Copy ID"}
                  </Button>
                  {onOpen && openLabel ? (
                    <Button variant="secondary" size="sm" onClick={() => onOpen(active)}>{openLabel}</Button>
                  ) : null}
                </div>
                {renderPreview(active)}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>
                Select a result to preview it here. Use arrow keys to move{onOpen ? ", Enter to open" : ""}.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
