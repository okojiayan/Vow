"use client";

import { useRef } from "react";

/** Segmented control — radiogroup with roving tabindex + arrow keys. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label}>
      <div
        style={{
          display: "inline-flex",
          gap: 2,
          padding: 3,
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border)",
          borderRadius: "var(--ds-radius-md)",
        }}
      >
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={i === idx ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                let next: number | null = null;
                if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
                if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + options.length) % options.length;
                if (e.key === "Home") next = 0;
                if (e.key === "End") next = options.length - 1;
                if (next !== null) {
                  e.preventDefault();
                  onChange(options[next].value);
                  refs.current[next]?.focus();
                }
              }}
              className="ds-btn"
              style={{
                fontSize: "var(--ds-text-13)",
                fontWeight: 500,
                padding: "6px 14px",
                borderRadius: "var(--ds-radius-sm)",
                border: "1px solid transparent",
                background: selected ? "var(--ds-surface)" : "transparent",
                color: selected ? "var(--ds-ink)" : "var(--ds-muted)",
                boxShadow: selected ? "var(--ds-elev-1)" : "none",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
