"use client";

import { useRef } from "react";

/** Underline tabs — tablist with roving tabindex + arrow keys. */
export function Tabs({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { value: string; label: string; badge?: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, tabs.findIndex((t) => t.value === value));
  return (
    <div
      role="tablist"
      aria-label={label}
      style={{ display: "flex", gap: "var(--ds-space-2)", borderBottom: "1px solid var(--ds-border)" }}
    >
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={i === idx ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              let next: number | null = null;
              if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
              if (e.key === "Home") next = 0;
              if (e.key === "End") next = tabs.length - 1;
              if (next !== null) {
                e.preventDefault();
                onChange(tabs[next].value);
                refs.current[next]?.focus();
              }
            }}
            className="ds-btn"
            style={{
              fontSize: "var(--ds-text-14)",
              fontWeight: selected ? 600 : 500,
              color: selected ? "var(--ds-accent)" : "var(--ds-muted)",
              background: "transparent",
              border: "none",
              borderBottom: selected ? "2px solid var(--ds-accent)" : "2px solid transparent",
              borderRadius: 0,
              padding: "10px 14px",
              marginBottom: -1,
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--ds-space-2)",
            }}
          >
            {t.label}
            {t.badge ? (
              <span
                style={{
                  fontSize: "var(--ds-text-12)",
                  fontWeight: 600,
                  background: "var(--ds-surface-2)",
                  color: "var(--ds-muted)",
                  borderRadius: "var(--ds-radius-pill)",
                  padding: "1px 8px",
                }}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
