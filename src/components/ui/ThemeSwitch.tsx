"use client";

import { Moon, Sun, Monitor, ShieldCheck } from "lucide-react";

export type ThemeChoice = "light" | "dark" | "system" | "warden";

/** Theme switch — explicit Light/Dark/System plus Warden as a semantic theme. */
export function ThemeSwitch({
  value,
  onChange,
}: {
  value: ThemeChoice;
  onChange: (v: ThemeChoice) => void;
}) {
  const modes = [
    { v: "light", label: "Light", Icon: Sun },
    { v: "dark", label: "Dark", Icon: Moon },
    { v: "system", label: "System", Icon: Monitor },
  ] as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
      <div role="group" aria-label="Color theme" style={{ display: "inline-flex", gap: 2, padding: 3, background: "var(--ds-surface-2)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)" }}>
        {modes.map(({ v, label, Icon }) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(v)}
              className="ds-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
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
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-pressed={value === "warden"}
        onClick={() => onChange(value === "warden" ? "system" : "warden")}
        className="ds-btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: "var(--ds-text-13)",
          fontWeight: 600,
          padding: "7px 14px",
          borderRadius: "var(--ds-radius-md)",
          border: value === "warden" ? "1px solid var(--ds-accent)" : "1px solid var(--ds-border-strong)",
          background: value === "warden" ? "var(--ds-accent-wash)" : "var(--ds-surface)",
          color: value === "warden" ? "var(--ds-accent)" : "var(--ds-ink-soft)",
        }}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        Warden
      </button>
    </div>
  );
}
