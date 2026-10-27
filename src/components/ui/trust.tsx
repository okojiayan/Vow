"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Clock, Pencil, ShieldCheck, X } from "lucide-react";
import { Button } from "./Button";
import { PermissionBadge, VerificationBadge, type PermissionLevel, type VerificationState } from "./badges";

/* ---------------- Evidence receipt ---------------- */

export type CheckState = "passed" | "pending" | "failed";

export interface ReceiptCheck {
  label: string;
  detail: string;
  state: CheckState;
}

export function EvidenceReceipt({
  taskId,
  title,
  duration,
  state,
  checks,
  defaultOpen = false,
}: {
  taskId: string;
  title: string;
  duration: string;
  state: VerificationState;
  checks: ReceiptCheck[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  const passed = checks.filter((c) => c.state === "passed").length;
  return (
    <div
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-radius-lg)",
        boxShadow: "var(--ds-elev-1)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="ds-btn ds-card-head"
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "14px 16px",
          textAlign: "left",
        }}
      >
        <ShieldCheck size={18} aria-hidden="true" style={{ color: "var(--ds-accent)", flex: "none" }} />
        <span className="ds-card-title">
          <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 600, color: "var(--ds-ink)" }}>{title}</span>
          <span className="ds-card-id">
            {taskId} · {duration} · {passed}/{checks.length} checks
          </span>
        </span>
        <VerificationBadge state={state} />
        <ChevronDown
          size={16}
          aria-hidden="true"
          style={{ color: "var(--ds-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform var(--ds-dur-2) var(--ds-ease-out)" }}
        />
      </button>
      {open ? (
        <div id={regionId} style={{ borderTop: "1px solid var(--ds-border)", padding: "12px 16px 16px", display: "grid", gap: "var(--ds-space-2)" }}>
          {checks.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "flex-start", gap: "var(--ds-space-3)" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background:
                    c.state === "passed"
                      ? "var(--ds-green-wash)"
                      : c.state === "pending"
                        ? "var(--ds-surface-2)"
                        : "var(--ds-red-wash)",
                  color:
                    c.state === "passed"
                      ? "var(--ds-green-700)"
                      : c.state === "pending"
                        ? "var(--ds-muted)"
                        : "var(--ds-red-700)",
                  marginTop: 1,
                }}
              >
                {c.state === "passed" ? (
                  <Check size={12} strokeWidth={3} />
                ) : c.state === "pending" ? (
                  <Clock size={12} strokeWidth={2.5} />
                ) : (
                  <X size={12} strokeWidth={3} />
                )}
              </span>
              <span>
                <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 500, color: "var(--ds-ink)" }}>
                  {c.label}
                  <span className="ds-sr">{c.state === "passed" ? " — passed" : c.state === "pending" ? " — pending" : " — failed"}</span>
                </span>
                <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", fontFamily: "var(--ds-font-mono)" }}>{c.detail}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Approval card ---------------- */

export interface BlastRadiusItem {
  path: string;
  permission: PermissionLevel;
  note: string;
}

export function ApprovalCard({
  title,
  tool,
  scope,
  blastRadius,
  onApprove,
  onDeny,
  onEditScope,
}: {
  title: string;
  tool: string;
  scope: string;
  blastRadius: BlastRadiusItem[];
  onApprove: () => void;
  onDeny: () => void;
  onEditScope: () => void;
}) {
  return (
    <section
      aria-label={`Approval request: ${title}`}
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-radius-lg)",
        boxShadow: "var(--ds-elev-1)",
        padding: "var(--ds-space-6)",
      }}
    >
<div className="ds-card-head" style={{ marginBottom: "var(--ds-space-2)" }}>
<span className="ds-card-title">
          <span style={{ display: "block", fontSize: "var(--ds-text-16)", fontWeight: 600, color: "var(--ds-ink)" }}>{title}</span>
<span className="ds-card-id" style={{ marginTop: 2 }}>
            {tool} · {scope}
          </span>
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--ds-text-13)",
            fontWeight: 600,
            color: "var(--ds-amber-700)",
            background: "var(--ds-amber-wash)",
            borderRadius: "var(--ds-radius-pill)",
            padding: "3px 12px",
            whiteSpace: "nowrap",
          }}
        >
          <Clock size={13} aria-hidden="true" />
          Needs decision
        </span>
      </div>
      <h4 style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "var(--ds-space-4) 0 var(--ds-space-2)" }}>
        Blast radius
      </h4>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-2)", marginBottom: "var(--ds-space-6)" }}>
        {blastRadius.map((b) => (
          <li
            key={b.path}
            className="ds-blast-row"
            style={{
              background: "var(--ds-bg)",
              border: "1px solid var(--ds-border)",
              borderRadius: "var(--ds-radius-md)",
              padding: "9px 12px",
            }}
          >
            <PermissionBadge level={b.permission} />
            <span className="ds-blast-path">{b.path}</span>
              <span className="ds-blast-note">{b.note}</span>
          </li>
        ))}
      </ul>
      <div className="ds-approve-actions">
        <Button variant="primary" icon={<Check size={15} strokeWidth={2.5} />} onClick={onApprove}>
          Approve
        </Button>
        <Button variant="destructive" icon={<X size={15} strokeWidth={2.5} />} onClick={onDeny}>
          Deny
        </Button>
        <Button variant="secondary" icon={<Pencil size={15} />} onClick={onEditScope}>
          Edit scope
        </Button>
      </div>
    </section>
  );
}

/* ---------------- Step timeline ---------------- */

export type StepState = "completed" | "running" | "queued" | "failed" | "blocked" | "waiting";

export interface TimelineStep {
  id: string;
  title: string;
  state: StepState;
  detail?: string;
}

const dotTone: Record<StepState, { bg: string; ring: string }> = {
  completed: { bg: "var(--ds-green-700)", ring: "var(--ds-green-wash)" },
  running: { bg: "var(--ds-blue-700)", ring: "var(--ds-blue-wash)" },
  queued: { bg: "var(--ds-border-strong)", ring: "var(--ds-surface-2)" },
  failed: { bg: "var(--ds-red-700)", ring: "var(--ds-red-wash)" },
  blocked: { bg: "var(--ds-red-700)", ring: "var(--ds-red-wash)" },
  waiting: { bg: "var(--ds-amber-700)", ring: "var(--ds-amber-wash)" },
};

const stepWord: Record<StepState, string> = {
  completed: "completed",
  running: "in progress",
  queued: "queued",
  failed: "failed",
  blocked: "blocked",
  waiting: "waiting approval",
};

export function StepTimeline({
  steps,
  verification,
}: {
  steps: TimelineStep[];
  verification: VerificationState;
}) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s) => {
        const tone = dotTone[s.state];
        return (
          <li key={s.id} style={{ display: "flex", gap: "var(--ds-space-3)" }}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: tone.bg,
                  boxShadow: `0 0 0 4px ${tone.ring}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--ds-surface)",
                  marginTop: 2,
                }}
              >
                {s.state === "completed" ? <Check size={12} strokeWidth={3} /> : null}
                {s.state === "failed" || s.state === "blocked" ? <X size={12} strokeWidth={3} /> : null}
              </span>
              <span aria-hidden="true" style={{ width: 2, flex: 1, minHeight: 20, background: "var(--ds-border)", borderRadius: 2, margin: "4px 0" }} />
            </span>
            <span style={{ paddingBottom: "var(--ds-space-4)" }}>
              <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 500, color: "var(--ds-ink)" }}>
                {s.title}
                <span className="ds-sr"> — {stepWord[s.state]}</span>
              </span>
              {s.detail ? (
                <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", fontFamily: "var(--ds-font-mono)" }}>{s.detail}</span>
              ) : (
                <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>{stepWord[s.state]}</span>
              )}
            </span>
          </li>
        );
      })}
      <li style={{ display: "flex", gap: "var(--ds-space-3)" }}>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
          <span
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--ds-accent)",
              boxShadow: "0 0 0 4px var(--ds-accent-wash)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ds-accent-ink)",
              marginTop: 2,
            }}
          >
            <ShieldCheck size={12} strokeWidth={2.5} />
          </span>
        </span>
        <span>
          <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 500, color: "var(--ds-ink)" }}>
            Verification
          </span>
          <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", marginTop: 2, marginBottom: "var(--ds-space-2)" }}>
            Independent receipt check
          </span>
          <VerificationBadge state={verification} />
        </span>
      </li>
    </ol>
  );
}
