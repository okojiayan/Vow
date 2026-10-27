"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Search, ShieldCheck, Zap } from "lucide-react";

export interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  kind: "task" | "action" | "guard";
  onRun: () => void;
}

const kindIcon = {
  task: FileText,
  action: Zap,
  guard: ShieldCheck,
};

/**
 * Command palette. Opens from the showcase button or ⌘K — the ⌘K listener is
 * capture-phase and scoped to this component, so it never leaks into the
 * app-wide new-chat shortcut once unmounted.
 */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      };
      document.addEventListener("keydown", onKey, true);
      return () => {
        document.removeEventListener("keydown", onKey, true);
        prevFocus.current?.focus();
      };
    }
  }, [open, onClose]);

  const filtered = items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(query.toLowerCase()));
  const clamped = Math.min(active, Math.max(0, filtered.length - 1));

  if (!open) return null;
  return (
    <span
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "center", padding: "12vh 16px 16px", background: "var(--ds-scrim)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <span
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="ds-pop"
        style={{
          background: "var(--ds-surface)",
          border: "1px solid var(--ds-border)",
          borderRadius: "var(--ds-radius-lg)",
          boxShadow: "var(--ds-elev-2)",
          width: 560,
          maxWidth: "100%",
          height: "fit-content",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)", padding: "12px 16px", borderBottom: "1px solid var(--ds-border)" }}>
          <Search size={16} aria-hidden="true" style={{ color: "var(--ds-muted)", flex: "none" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && filtered[clamped]) {
                filtered[clamped].onRun();
                onClose();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="ds-palette-list"
            aria-activedescendant={filtered[clamped] ? `ds-palette-${filtered[clamped].id}` : undefined}
            placeholder="Search tasks, actions, and guards…"
            aria-label="Search commands"
            style={{ flex: 1, border: "none", background: "transparent", color: "var(--ds-ink)", fontSize: "var(--ds-text-14)", outline: "none" }}
          />
          <span className="ds-kbd">esc</span>
        </span>
        <span id="ds-palette-list" role="listbox" aria-label="Results" style={{ overflowY: "auto", padding: 6 }}>
          {filtered.length === 0 ? (
            <span style={{ display: "block", padding: "16px", fontSize: "var(--ds-text-14)", color: "var(--ds-muted)", textAlign: "center" }}>
              No matches for “{query}”.
            </span>
          ) : (
            filtered.map((item, i) => {
              const Icon = kindIcon[item.kind];
              const isActive = i === clamped;
              return (
                <button
                  key={item.id}
                  id={`ds-palette-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    item.onRun();
                    onClose();
                  }}
                  onMouseEnter={() => setActive(i)}
                  className="ds-btn"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--ds-space-3)",
                    background: isActive ? "var(--ds-surface-2)" : "transparent",
                    border: "none",
                    borderRadius: "var(--ds-radius-sm)",
                    padding: "9px 10px",
                    textAlign: "left",
                  }}
                >
                  <Icon size={15} aria-hidden="true" style={{ color: isActive ? "var(--ds-accent)" : "var(--ds-muted)", flex: "none" }} />
                  <span style={{ flex: 1, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)" }}>{item.label}</span>
                  <span style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>{item.hint}</span>
                </button>
              );
            })
          )}
        </span>
      </span>
    </span>
  );
}
