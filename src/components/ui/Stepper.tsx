"use client";

import { useRef } from "react";

/** Linear stepper for guided flows (e.g. the Integrations connection wizard). */
export function Stepper({
  label,
  steps,
  current,
  onChange,
}: {
  label: string;
  steps: { id: string; label: string }[];
  current: number;
  onChange?: (index: number) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <ol
      aria-label={label}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-2)" }}
    >
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.id} style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)" }}>
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              onClick={() => {
                if (i <= current) onChange?.(i);
              }}
              disabled={i > current}
              aria-current={active ? "step" : undefined}
              className="ds-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--ds-space-3)",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "6px 8px",
                borderRadius: "var(--ds-radius-sm)",
                cursor: i <= current ? "pointer" : "default",
                opacity: i > current ? 0.6 : 1,
              }}
              onKeyDown={(e) => {
                let next: number | null = null;
                if (e.key === "ArrowDown" || e.key === "ArrowRight") next = Math.min(steps.length - 1, i + 1);
                if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = Math.max(0, i - 1);
                if (next !== null && next <= current) {
                  e.preventDefault();
                  onChange?.(next);
                  refs.current[next]?.focus();
                }
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: "none",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "var(--ds-text-13)",
                  fontWeight: 600,
                  background: active ? "var(--ds-accent)" : done ? "var(--ds-surface-2)" : "transparent",
                  color: active ? "var(--ds-accent-ink)" : done ? "var(--ds-accent)" : "var(--ds-muted)",
                  border: active ? "1px solid transparent" : "1px solid var(--ds-border-strong)",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                style={{
                  fontSize: "var(--ds-text-14)",
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--ds-ink)" : "var(--ds-muted)",
                }}
              >
                {s.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
