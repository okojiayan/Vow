"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Companion } from "@/components/vow/Companion";

type Tone = "info" | "success" | "warning" | "error";

const toneMeta: Record<Tone, { Icon: typeof Info; bg: string; fg: string; border: string }> = {
  info: { Icon: Info, bg: "var(--ds-blue-wash)", fg: "var(--ds-blue-700)", border: "var(--ds-blue-700)" },
  success: { Icon: CheckCircle2, bg: "var(--ds-green-wash)", fg: "var(--ds-green-700)", border: "var(--ds-green-700)" },
  warning: { Icon: AlertTriangle, bg: "var(--ds-amber-wash)", fg: "var(--ds-amber-700)", border: "var(--ds-amber-700)" },
  error: { Icon: XCircle, bg: "var(--ds-red-wash)", fg: "var(--ds-red-700)", border: "var(--ds-red-700)" },
};

/** Inline banner — persistent contextual message with optional action. */
export function InlineBanner({
  tone,
  title,
  body,
  action,
}: {
  tone: Tone;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { Icon, bg, fg } = toneMeta[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        gap: "var(--ds-space-3)",
        background: bg,
        borderRadius: "var(--ds-radius-md)",
        padding: "12px 16px",
      }}
    >
      <Icon size={18} aria-hidden="true" style={{ color: fg, flex: "none", marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: "var(--ds-text-14)", fontWeight: 600, color: fg }}>{title}</p>
        {body ? (
          <p style={{ fontSize: "var(--ds-text-13)", color: fg, opacity: 0.9, marginTop: 2, lineHeight: 1.5 }}>{body}</p>
        ) : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onPress}
          className="ds-btn"
          style={{ background: "transparent", border: "none", color: fg, fontSize: "var(--ds-text-14)", fontWeight: 600, padding: "2px 4px", alignSelf: "flex-start" }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/** Empty state — in-flow only, with an optional mascot slot above the copy. Never floating. */
export function EmptyState({
  title,
  body,
  action,
  mascot,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
  mascot?: "normal" | "warden";
}) {
  return (
    <div style={{ textAlign: "center", padding: "var(--ds-space-8) var(--ds-space-4)" }}>
      {mascot ? (
        <span style={{ display: "block", marginBottom: "var(--ds-space-4)" }}>
          <Companion
            variant={mascot}
            liveliness="static"
            className="companion-empty"
          />
        </span>
      ) : null}
      <p style={{ fontSize: "var(--ds-text-16)", fontWeight: 600, color: "var(--ds-ink)", marginBottom: "var(--ds-space-2)" }}>{title}</p>
      <p style={{ fontSize: "var(--ds-text-14)", color: "var(--ds-muted)", maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>{body}</p>
      {action ? (
        <p style={{ marginTop: "var(--ds-space-4)" }}>
          <button
            type="button"
            onClick={action.onPress}
            className="ds-btn"
            style={{
              background: "var(--ds-surface)",
              color: "var(--ds-accent)",
              border: "1px solid var(--ds-accent)",
              borderRadius: "var(--ds-radius-md)",
              padding: "9px 18px",
              fontSize: "var(--ds-text-14)",
              fontWeight: 500,
            }}
          >
            {action.label}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Skeleton — placeholder shimmer while content loads. Decorative; pair with an sr status. */
export function Skeleton({ lines = 3, label = "Loading content" }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <span className="ds-sr">{label}…</span>
      <span aria-hidden="true" style={{ display: "grid", gap: "var(--ds-space-2)" }}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className="ds-skeleton"
            style={{
              display: "block",
              height: 14,
              borderRadius: "var(--ds-radius-sm)",
              background: "var(--ds-surface-2)",
              width: i === lines - 1 ? "62%" : "100%",
            }}
          />
        ))}
      </span>
    </div>
  );
}
