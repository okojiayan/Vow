"use client";

import { ChevronRight } from "lucide-react";
import { StatusInline } from "./badges";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
}

/** Data table — header row plus hoverable, keyboard-focusable body rows. */
export function Table<T extends { id: string }>({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
}) {
  return (
    <div className="ds-table" style={{ overflowX: "auto", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)", background: "var(--ds-surface)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--ds-text-14)" }}>
        <caption className="ds-sr">{label}</caption>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--ds-border)", textAlign: "left" }}>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{
                  fontSize: "var(--ds-text-13)",
                  fontWeight: 600,
                  color: "var(--ds-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  padding: "10px 16px",
                }}
              >
                {c.header || <span className="ds-sr">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              className="ds-focusable"
              style={{ borderBottom: "1px solid var(--ds-border)", cursor: "default" }}
            >
              {columns.map((c) => (
                <td key={c.key} data-label={c.header || ""} style={{ padding: "12px 16px", color: "var(--ds-ink)" }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** List row — single-line action row with hover, focus, and chevron affordance. */
export function ListRow({
  title,
  meta,
  onOpen,
}: {
  title: string;
  meta: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ds-btn"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--ds-space-3)",
        textAlign: "left",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-radius-md)",
        padding: "12px 16px",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 500, color: "var(--ds-ink)" }}>{title}</span>
        <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", fontFamily: "var(--ds-font-mono)" }}>{meta}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" style={{ color: "var(--ds-muted)", flex: "none" }} />
    </button>
  );
}
