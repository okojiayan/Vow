"use client";

/**
 * Stage 5a shared page header: title at 28, one-line description,
 * at most one primary action. No eyebrow labels. All color via --ds-*.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--ds-space-4)",
        flexWrap: "wrap",
        marginBottom: "var(--ds-space-6)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--ds-text-28)",
            lineHeight: 1.2,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            color: "var(--ds-ink)",
            overflowWrap: "break-word",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "var(--ds-text-14)",
            color: "var(--ds-muted)",
          }}
        >
          {description}
        </p>
      </div>
      {action ? <div style={{ flex: "none" }}>{action}</div> : null}
    </div>
  );
}
