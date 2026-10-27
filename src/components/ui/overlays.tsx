"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";

const surfacePop: React.CSSProperties = {
  background: "var(--ds-surface)",
  border: "1px solid var(--ds-border)",
  borderRadius: "var(--ds-radius-lg)",
  boxShadow: "var(--ds-elev-2)",
};

function useDismiss(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, onClose]);
}

/* ---------------- Menu ---------------- */

export function Menu({
  label,
  items,
}: {
  label: string;
  items: { label: string; hint?: string; danger?: boolean; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const close = () => setOpen(false);
  useDismiss(close, open);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </Button>
      {open ? (
        <span
          role="menu"
          aria-label={label}
          className="ds-pop"
          style={{ ...surfacePop, position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 220, padding: 6, zIndex: 50 }}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              autoFocus={i === 0}
              onClick={() => {
                item.onSelect();
                close();
              }}
              onKeyDown={(e) => {
                let next: number | null = null;
                if (e.key === "ArrowDown") next = (i + 1) % items.length;
                if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
                if (e.key === "Home") next = 0;
                if (e.key === "End") next = items.length - 1;
                if (next !== null) {
                  e.preventDefault();
                  refs.current[next]?.focus();
                }
              }}
              className="ds-btn"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "var(--ds-space-2)",
                background: "transparent",
                border: "none",
                borderRadius: "var(--ds-radius-sm)",
                padding: "8px 10px",
                fontSize: "var(--ds-text-14)",
                color: item.danger ? "var(--ds-red-700)" : "var(--ds-ink)",
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.hint ? <span className="ds-kbd">{item.hint}</span> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/* ---------------- Popover ---------------- */

export function Popover({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useDismiss(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open ]);
  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <Button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </Button>
      {open ? (
        <span role="dialog" aria-label={label} className="ds-pop" style={{ ...surfacePop, position: "absolute", top: "calc(100% + 6px)", left: 0, width: 280, padding: "var(--ds-space-4)", zIndex: 50 }}>
          {children}
        </span>
      ) : null}
    </span>
  );
}

/* ---------------- Tooltip ---------------- */

export function Tooltip({
  tip,
  shortcut,
  children,
}: {
  tip: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show ? (
        <span
          role="tooltip"
          className="ds-pop"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--ds-space-2)",
            background: "var(--ds-ink)",
            color: "var(--ds-bg)",
            fontSize: "var(--ds-text-13)",
            borderRadius: "var(--ds-radius-sm)",
            padding: "6px 10px",
            whiteSpace: "nowrap",
            zIndex: 60,
            pointerEvents: "none",
          }}
        >
          {tip}
          {shortcut ? <span className="ds-kbd">{shortcut}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/* ---------------- Dialog ---------------- */

export function Dialog({
  title,
  open,
  onClose,
  children,
  actions,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  useDismiss(onClose, open);
  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
      return () => prevFocus.current?.focus();
    }
  }, [open ]);
  if (!open) return null;
  return (
    <span
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--ds-scrim)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <span
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ds-pop"
        style={{ ...surfacePop, width: 440, maxWidth: "100%", padding: "var(--ds-space-6)" }}
      >
        <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--ds-space-4)", marginBottom: "var(--ds-space-3)" }}>
          <span id={titleId} style={{ fontSize: "var(--ds-text-20)", fontWeight: 600, color: "var(--ds-ink)" }}>
            {title}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="ds-btn"
            style={{ background: "transparent", border: "none", color: "var(--ds-muted)", fontSize: "var(--ds-text-16)", padding: 4, lineHeight: 1 }}
          >
            ✕
          </button>
        </span>
        <span style={{ display: "block", fontSize: "var(--ds-text-14)", color: "var(--ds-ink-soft)", lineHeight: 1.6, marginBottom: "var(--ds-space-6)" }}>
          {children}
        </span>
        <span style={{ display: "flex", gap: "var(--ds-space-3)", justifyContent: "flex-end" }}>{actions}</span>
      </span>
    </span>
  );
}

/* ---------------- Drawer ---------------- */

export function Drawer({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  useDismiss(onClose, open);
  if (!open) return null;
  return (
    <span
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--ds-scrim)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ds-pop"
        style={{
          ...surfacePop,
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          maxWidth: "90vw",
          borderRadius: "var(--ds-radius-lg) 0 0 var(--ds-radius-lg)",
          padding: "var(--ds-space-6)",
          overflowY: "auto",
        }}
      >
        <span style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--ds-space-4)", marginBottom: "var(--ds-space-4)" }}>
          <span id={titleId} style={{ fontSize: "var(--ds-text-16)", fontWeight: 600, color: "var(--ds-ink)" }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="ds-btn"
            style={{ background: "transparent", border: "none", color: "var(--ds-muted)", fontSize: "var(--ds-text-16)", padding: 4, lineHeight: 1 }}
          >
            ✕
          </button>
        </span>
        {children}
      </aside>
    </span>
  );
}

/* ---------------- Toast ---------------- */

export function Toast({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <span
      role="status"
      className="ds-toast-in"
      style={{
        ...surfacePop,
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--ds-space-3)",
        padding: "12px 16px",
        maxWidth: 360,
      }}
    >
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 600, color: "var(--ds-ink)" }}>{title}</span>
        {body ? (
          <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", marginTop: 2 }}>{body}</span>
        ) : null}
      </span>
      {action ? (
        <button
          type="button"
          onClick={action.onPress}
          className="ds-btn"
          style={{ background: "transparent", border: "none", color: "var(--ds-accent)", fontSize: "var(--ds-text-14)", fontWeight: 600, padding: "2px 4px", flex: "none" }}
        >
          {action.label}
        </button>
      ) : null}
    </span>
  );
}
