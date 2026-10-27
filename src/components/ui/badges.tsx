import { AlertTriangle, Ban, Check, Clock, Eye, EyeOff, FileCheck, Flag, X } from "lucide-react";

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: "var(--ds-text-13)",
  fontWeight: 500,
  borderRadius: "var(--ds-radius-pill)",
  padding: "3px 12px",
  lineHeight: 1.5,
  whiteSpace: "nowrap",
};

/** Neutral badge. Pills are reserved for badges and toggles. */
export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ ...pill, background: "var(--ds-surface-2)", color: "var(--ds-ink-soft)" }}>
      {children}
    </span>
  );
}

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "blocked"
  | "unverified"
  | "stale"
  | "needs-review";

/**
 * Status shape — every state has a distinct outline/icon so none relies on
 * color. Queued vs stale (hollow vs dashed ring) and the three ambers
 * (clock vs eye-off vs flag) stay distinguishable in grayscale.
 */
function StatusShape({ status, tone }: { status: TaskStatus; tone: { bg: string; fg: string } }) {
  const ring = (extra: React.CSSProperties): React.CSSProperties => ({
    width: 13,
    height: 13,
    borderRadius: "50%",
    flex: "none",
    ...extra,
  });
  switch (status) {
    case "queued":
      return <span aria-hidden="true" style={ring({ border: "2px solid currentColor", background: "transparent" })} />;
    case "stale":
      return <span aria-hidden="true" style={ring({ border: "1.5px dashed currentColor", background: "transparent" })} />;
    case "running":
      return <span aria-hidden="true" className="ds-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />;
    case "waiting":
      return <Clock size={13} aria-hidden="true" strokeWidth={2.5} />;
    case "needs-review":
      return <Flag size={13} aria-hidden="true" strokeWidth={2.5} />;
    case "unverified":
      return <EyeOff size={13} aria-hidden="true" strokeWidth={2.5} />;
    case "blocked":
      return <Ban size={13} aria-hidden="true" strokeWidth={2.5} />;
    case "failed":
      return <X size={13} aria-hidden="true" strokeWidth={2.5} />;
    case "completed":
      return <Check size={13} aria-hidden="true" strokeWidth={3} />;
  }
  void tone;
  return null;
}

const statusTone: Record<TaskStatus, { bg: string; fg: string }> = {
  queued: { bg: "var(--ds-surface-2)", fg: "var(--ds-muted)" },
  running: { bg: "var(--ds-blue-wash)", fg: "var(--ds-blue-700)" },
  waiting: { bg: "var(--ds-amber-wash)", fg: "var(--ds-amber-700)" },
  completed: { bg: "var(--ds-green-wash)", fg: "var(--ds-green-700)" },
  failed: { bg: "var(--ds-red-wash)", fg: "var(--ds-red-700)" },
  blocked: { bg: "var(--ds-red-wash)", fg: "var(--ds-red-700)" },
  unverified: { bg: "var(--ds-amber-wash)", fg: "var(--ds-amber-700)" },
  stale: { bg: "var(--ds-surface-2)", fg: "var(--ds-muted)" },
  "needs-review": { bg: "var(--ds-accent-wash)", fg: "var(--ds-accent)" },
};

const statusLabel: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting approval",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
  unverified: "Unverified",
  stale: "Stale",
  "needs-review": "Needs review",
};

/** Status badge — shape + label on a tinted pill (cards and detail views). */
export function StatusBadge({ status }: { status: TaskStatus }) {
  const tone = statusTone[status];
  return (
    <span style={{ ...pill, background: tone.bg, color: tone.fg }}>
      <StatusShape status={status} tone={tone} />
      {statusLabel[status]}
    </span>
  );
}

/** StatusInline — shape + label with no tinted background (table rows). */
export function StatusInline({ status }: { status: TaskStatus }) {
  const tone = statusTone[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--ds-text-13)", fontWeight: 500, color: tone.fg, whiteSpace: "nowrap" }}>
      <StatusShape status={status} tone={tone} />
      {statusLabel[status]}
    </span>
  );
}

export type VerificationState = "verified" | "unverified" | "failed";

const verificationMeta: Record<VerificationState, { Icon: typeof Check; label: string; bg: string; fg: string }> = {
  verified: { Icon: Check, label: "Verified", bg: "var(--ds-green-wash)", fg: "var(--ds-green-700)" },
  unverified: { Icon: Eye, label: "Unverified", bg: "var(--ds-amber-wash)", fg: "var(--ds-amber-700)" },
  failed: { Icon: X, label: "Verification failed", bg: "var(--ds-red-wash)", fg: "var(--ds-red-700)" },
};

/** Verification badge — the trust mark on receipts and timelines. */
export function VerificationBadge({ state }: { state: VerificationState }) {
  const { Icon, label, bg, fg } = verificationMeta[state];
  return (
    <span style={{ ...pill, background: bg, color: fg }}>
      <Icon size={13} aria-hidden="true" strokeWidth={2.5} />
      {label}
    </span>
  );
}

export type PermissionLevel = "read" | "read-append" | "write";

const permissionMeta: Record<PermissionLevel, { label: string; hint: string; bg: string; fg: string }> = {
  read: { label: "Read", hint: "Can view files and search", bg: "var(--ds-blue-wash)", fg: "var(--ds-blue-700)" },
  "read-append": { label: "Read + append", hint: "Can add notes, cannot edit", bg: "var(--ds-amber-wash)", fg: "var(--ds-amber-700)" },
  write: { label: "Write", hint: "Can create and edit files", bg: "var(--ds-red-wash)", fg: "var(--ds-red-700)" },
};

/** Permission-level badge with a native tooltip describing the grant. */
export function PermissionBadge({ level }: { level: PermissionLevel }) {
  const { label, hint, bg, fg } = permissionMeta[level];
  return (
    <span title={hint} style={{ ...pill, background: bg, color: fg, cursor: "help" }}>
      {level === "read-append" ? <FileCheck size={13} aria-hidden="true" /> : null}
      {level === "write" ? <AlertTriangle size={13} aria-hidden="true" /> : null}
      {level === "read" ? <Eye size={13} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function StaleNote() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
      <Clock size={13} aria-hidden="true" />
      Updated 2 h ago — state may have changed
    </span>
  );
}

export function BlockedNote() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--ds-text-13)", color: "var(--ds-red-700)" }}>
      <Ban size={13} aria-hidden="true" />
      Blocked — waiting on a dependency
    </span>
  );
}
