"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ShieldCheck, TriangleAlert, UserRound, Bot, Zap } from "lucide-react";
import { AUTONOMY_OPTIONS, type UiAutonomyMode } from "@/lib/autonomy";


const ICONS: Record<string, typeof Bot> = { manual: ShieldCheck, smart: Bot, full: Zap, warden: ShieldCheck };

export function AutonomyMenu({ value, onChange }: { value: UiAutonomyMode; onChange: (mode: UiAutonomyMode) => void; }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = AUTONOMY_OPTIONS.find((o) => o.id === value) ?? AUTONOMY_OPTIONS[1];
  const CurrentIcon = ICONS[current.id] ?? Bot;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="mode-trigger"
        data-mode={current.id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`Autonomy: ${current.label} — ${current.description}`}
      >
        <span className="mode-dot" aria-hidden="true" />
        <CurrentIcon size={14} aria-hidden="true" />
        {current.label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mode-menu" role="listbox" aria-label="Autonomy mode">
          {AUTONOMY_OPTIONS.map((o) => {
            const Icon = ICONS[o.id] ?? Bot;
            const selected = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`mode-opt${selected ? " selected" : ""}`}
                onClick={() => { onChange(o.id); setOpen(false); }}
              >
                <span className="mode-opt-ico" aria-hidden="true"><Icon size={16} /></span>
                <span className="min-w-0">
                  <span className="mode-opt-label">{o.label}</span>
                  <span className="mode-opt-desc" style={{ display: "block" }}>{o.id === "full" ? "Acts independently within boundaries. Policy denials still apply." : o.description}</span>
                </span>
              </button>
            );
          })}
          {value === "full" ? (
            <p className="risk-note"><TriangleAlert size={15} aria-hidden="true" /> Full control runs without per-step approval. Boundaries and denials still apply — review destructive work in the task monitor.</p>
          ) : null}
          <p className="px-3 pb-2 text-[0.7rem]" style={{ color: "var(--ds-muted)" }}>Warden policy stays enforced in every mode. Warden mode applies strict-enforcement styling.</p>
        </div>
      ) : null}
    </div>
  );
}
