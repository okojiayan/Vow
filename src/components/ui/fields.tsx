"use client";

import { Check } from "lucide-react";

import { useId, useState, type SelectHTMLAttributes, type TextareaHTMLAttributes, type InputHTMLAttributes } from "react";

const controlBase: React.CSSProperties = {
  width: "100%",
  background: "var(--ds-surface)",
  color: "var(--ds-ink)",
  border: "1px solid var(--ds-border-strong)",
  borderRadius: "var(--ds-radius-md)",
  fontSize: "var(--ds-text-14)",
  padding: "9px 12px",
  fontFamily: "var(--ds-font-sans)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--ds-text-13)",
  fontWeight: 500,
  color: "var(--ds-ink-soft)",
  marginBottom: "var(--ds-space-2)",
};

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {children(id, describedBy)}
      {error ? (
        <p id={errorId} role="alert" style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-red-700)", marginTop: "var(--ds-space-2)" }}>{error}</p>
      ) : hint ? (
        <p id={hintId} style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", marginTop: "var(--ds-space-2)" }}>{hint}</p>
      ) : null}
    </div>
  );
}

function focusRing(error: boolean | undefined): React.CSSProperties {
  return error ? { borderColor: "var(--ds-red-700)" } : {};
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> { error?: boolean }
export function Input({ error, style, ...rest }: InputProps) {
  return (
    <input
      className="ds-btn"
      aria-invalid={error || undefined}
      style={{ ...controlBase, ...focusRing(error), opacity: rest.disabled ? 0.55 : 1, ...style }}
      {...rest}
    />
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { error?: boolean }
export function Textarea({ error, style, ...rest }: TextareaProps) {
  return (
    <textarea
      className="ds-btn"
      aria-invalid={error || undefined}
      rows={4}
      style={{ ...controlBase, ...focusRing(error), resize: "vertical", lineHeight: 1.5, opacity: rest.disabled ? 0.55 : 1, ...style }}
      {...rest}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { error?: boolean }
export function Select({ error, style, children, ...rest }: SelectProps) {
  return (
    <select
      className="ds-btn"
      aria-invalid={error || undefined}
      style={{ ...controlBase, ...focusRing(error), opacity: rest.disabled ? 0.55 : 1, ...style }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  checked,
  defaultChecked,
  disabled,
  onChange,
}: {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const id = useId();
  const [inner, setInner] = useState(defaultChecked ?? false);
  const isChecked = checked ?? inner;
  return (
    <span className="ds-check-row" style={{ opacity: disabled ? 0.55 : 1 }}>
      <button
        type="button"
        role="checkbox"
        id={id}
        aria-label={label}
        aria-checked={isChecked}
        disabled={disabled}
        onClick={() => {
          const next = !isChecked;
          setInner(next);
          onChange?.(next);
        }}
        className="ds-btn"
        style={{
          width: 44,
          height: 44,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          padding: 0,
          flex: "none",
        }}
      >
        {/* Unchecked: transparent with a visible border. Disabled dims, never fills solid. */}
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: isChecked ? "var(--ds-accent)" : "transparent",
            border: isChecked ? "none" : "2px solid var(--ds-muted)",
            color: "var(--ds-accent-ink)",
          }}
        >
          {isChecked ? <Check size={12} strokeWidth={3.5} /> : null}
        </span>
      </button>
      <span
        onClick={disabled ? undefined : () => {
          const next = !isChecked;
          setInner(next);
          onChange?.(next);
        }}
        style={{ fontSize: "var(--ds-text-14)", color: disabled ? "var(--ds-muted)" : "var(--ds-ink)", cursor: disabled ? "default" : "pointer" }}
      >
        {label}
      </span>
    </span>
  );
}

export function Switch({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="ds-switch-hit" style={{ display: "inline-flex", alignItems: "center", gap: "var(--ds-space-3)", opacity: disabled ? 0.55 : 1 }}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className="ds-btn"
        style={{
          minHeight: 44,
          display: "inline-flex",
          alignItems: "center",
          background: "transparent",
          border: "none",
          padding: "0 var(--ds-space-1)",
        }}
      >
        {/* Off track: surface fill with a 2px muted boundary so the edge stays
            >= 3:1 against the card behind it in every theme. */}
        <span
          aria-hidden="true"
          style={{
            width: 46,
            height: 27,
            borderRadius: "var(--ds-radius-pill)",
            display: "inline-flex",
            alignItems: "center",
            padding: 2,
            boxSizing: "border-box",
            justifyContent: checked ? "flex-end" : "flex-start",
            background: checked ? "var(--ds-accent)" : "var(--ds-surface-2)",
            border: checked ? "2px solid transparent" : "2px solid var(--ds-muted)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 19,
              height: 19,
              borderRadius: "50%",
              background: checked ? "var(--ds-accent-ink)" : "var(--ds-surface)",
              border: checked ? "none" : "1px solid var(--ds-muted)",
            }}
          />
        </span>
      </button>
      <span
        onClick={disabled ? undefined : () => onCheckedChange?.(!checked)}
        style={{ fontSize: "var(--ds-text-14)", color: disabled ? "var(--ds-muted)" : "var(--ds-ink)", cursor: disabled ? "default" : "pointer" }}
      >
        {label}
      </span>
    </span>
  );
}
