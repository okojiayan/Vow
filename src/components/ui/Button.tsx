"use client";

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Leading icon, rendered before the label. */
  icon?: React.ReactNode;
}

/**
 * VOW Button. Primary = the single bronze accent action per view.
 * All color through --ds-* tokens; every state keeps AA contrast.
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  icon,
  children,
  style,
  ...rest
}: ButtonProps) {
  const styles: Record<ButtonVariant, React.CSSProperties> = {
    primary: { background: "var(--ds-accent)", color: "var(--ds-accent-ink)", border: "1px solid transparent" },
    secondary: { background: "var(--ds-surface)", color: "var(--ds-ink)", border: "1px solid var(--ds-border-strong)" },
    ghost: { background: "transparent", color: "var(--ds-ink-soft)", border: "1px solid transparent" },
    destructive: { background: "var(--ds-surface)", color: "var(--ds-red-700)", border: "1px solid var(--ds-red-700)" },
  };
  const sizes: Record<ButtonSize, React.CSSProperties> = {
    sm: { fontSize: "var(--ds-text-13)", padding: "6px 12px", borderRadius: "var(--ds-radius-sm)" },
    md: { fontSize: "var(--ds-text-14)", padding: "9px 18px", borderRadius: "var(--ds-radius-md)" },
    lg: { fontSize: "var(--ds-text-16)", padding: "12px 24px", borderRadius: "var(--ds-radius-md)" },
  };
  const isDisabled = disabled || loading;
  return (
    <button
      className="ds-btn"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      style={{
        ...styles[variant],
        ...sizes[size],
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--ds-space-2)",
        opacity: disabled && !loading ? 0.55 : 1,
        boxShadow: variant === "primary" ? "var(--ds-elev-1)" : "none",
        ...style,
      }}
      {...rest}
    >
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : null}
      {!loading && icon ? (
        <span aria-hidden="true" style={{ display: "inline-flex", flex: "none" }}>
          {icon}
        </span>
      ) : null}
      <span style={loading ? { opacity: 0.85 } : undefined}>{children}</span>
    </button>
  );
}
