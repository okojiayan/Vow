"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus } from "lucide-react";
import {
  ACTIVE_TASK_STATUSES,
  dedupeOutcomeBlocks,
  formatOutcome,
  isStaleActiveTask,
  taskCardState,
  taskStateLabel,
  type TaskCardState,
} from "@/lib/task-display";
import { relativeTime } from "@/lib/relative-time";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/fields";
import { Segmented } from "@/components/ui/Segmented";
import { StatusInline, VerificationBadge, type TaskStatus, type VerificationState } from "@/components/ui/badges";
import { Table } from "@/components/ui/Rows";
import { Dialog, Toast } from "@/components/ui/overlays";
import { EmptyState, InlineBanner } from "@/components/ui/feedback";
import { ApprovalCard, EvidenceReceipt, StepTimeline, type TimelineStep } from "@/components/ui/trust";

interface TaskItem {
  id: string;
  conversationId?: string;
  request: string;
  status: string;
  updatedAt?: string;
  queuedAt?: string | null;
  resultSummary?: string | null;
  verification?: { passed: boolean | null; explanation?: string } | null;
  error?: string | null;
  outcome?: { outcome: string; reason: string } | null;
  pendingApprovalId?: string | null;
  plan?: {
    summary?: string;
    steps: Array<{ id: string; title: string; status: string; instruction?: string }>;
  } | null;
}

interface TraceEvent {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  createdAt?: string;
}

interface ApprovalItem {
  id: string;
  taskId: string;
  tool: string;
  target?: string;
  args?: Record<string, unknown>;
  status: string;
}

const ACTIVE = ACTIVE_TASK_STATUSES as unknown as string[];

function cardStatus(t: TaskItem): TaskStatus {
  if (isStaleActiveTask(t)) return "stale";
  const s = taskCardState(t.status, t.outcome ?? null);
  switch (s) {
    case "waiting_approval": return "waiting";
    case "running":
    case "verifying": return "running";
    case "completed": return "completed";
    case "failed": return "failed";
    case "blocked":
    case "cancelled": return "blocked";
    case "partial": return "needs-review";
    case "unverified": return "unverified";
    default: return "queued";
  }
}

function verificationOf(t: TaskItem): VerificationState {
  if (t.verification?.passed === true) return "verified";
  if (t.verification?.passed === false) return "failed";
  return "unverified";
}

function fmtDuration(t: TaskItem): string {
  try {
    if (!t.queuedAt) return "—";
    const end = t.updatedAt ? Date.parse(t.updatedAt) : Date.now();
    const ms = end - Date.parse(t.queuedAt);
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  } catch {
    return "—";
  }
}

function stepStateOf(status: string): TimelineStep["state"] {
  const s = status.toLowerCase();
  if (s === "completed" || s === "verified") return "completed";
  if (s === "executing" || s === "in_progress" || s === "running") return "running";
  if (s === "awaiting_approval" || s === "waiting") return "waiting";
  if (s === "failed") return "failed";
  if (s === "blocked") return "blocked";
  return "queued";
}

/** Withhold sensitive-command text from log views; the entry stays, the payload does not. */
function redactLogLine(text: string): string {
  if (/(rm\s+-rf|\bpasswd\b|\bcurl\b|\bwget\b|shell\.exec|http\.fetch|bearer\s|sk-[a-z0-9]{8})/i.test(text)) {
    return "[command withheld — shown as metadata only]";
  }
  return text;
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}

type SavedView = "all" | "attention" | "stale" | "today";

export default function TasksPage() {
  const { effective } = useTheme();
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<SavedView>("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [traces, setTraces] = useState<Record<string, TraceEvent[]>>({});
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not load tasks.");
      setTasks((payload.tasks ?? []) as TaskItem[]);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      setTasks((current) => {
        if (current.some((t) => ACTIVE.includes(t.status))) void refresh();
        return current;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const openDetail = useCallback(async (t: TaskItem) => {
    setDetailId(t.id);
    setCopied(false);
    try {
      const [traceRes, apprRes] = await Promise.all([
        fetch("/api/traces/all").then((r) => r.json()).catch(() => ({})),
        fetch("/api/approvals").then((r) => r.json()).catch(() => ({})),
      ]);
      const list = (traceRes.traces ?? []) as Array<{ taskId: string; events: TraceEvent[] }>;
      const found = list.find((x) => x.taskId === t.id);
      if (found) setTraces((prev) => ({ ...prev, [t.id]: found.events.slice(-30) }));
      setApprovals(((apprRes.approvals ?? []) as ApprovalItem[]).filter((a) => a.taskId === t.id));
    } catch {
      /* detail still renders from the task record */
    }
  }, []);

  const decide = useCallback(async (approvalId: string, decision: "approve" | "deny") => {
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Decision failed.");
      setToast(decision === "approve" ? "Approved — the task continues." : "Denied — the task will stop safely.");
      await refresh();
      const t = tasks.find((x) => x.id === detailId);
      if (t) await openDetail(t);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Decision failed.");
    }
    window.setTimeout(() => setToast(null), 3000);
  }, [detailId, openDetail, refresh, tasks]);

  const clearStale = useCallback(async () => {
    const stale = tasks.filter((t) => isStaleActiveTask(t));
    if (stale.length === 0) return;
    setConfirmClear(false);
    setClearing(true);
    let done = 0;
    for (const t of stale) {
      try {
        await fetch(`/api/agent/${t.id}/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "Cleared as stale from Tasks." }),
        });
        done += 1;
      } catch {
        /* keep going; toast reports the count */
      }
    }
    setClearing(false);
    setToast(done === stale.length ? `Cleared ${done} stale task${done === 1 ? "" : "s"}.` : `Cleared ${done} of ${stale.length} stale tasks.`);
    window.setTimeout(() => setToast(null), 3000);
    await refresh();
  }, [refresh, tasks]);

  const copyId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      /* clipboard unavailable; the full id is still shown in title */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, []);

  const staleTasks = useMemo(() => tasks.filter((t) => isStaleActiveTask(t)), [tasks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (q && !t.request.toLowerCase().includes(q)) return false;
      if (view === "attention") {
        const s = taskCardState(t.status, t.outcome ?? null);
        if (!(s === "waiting_approval" || s === "failed" || isStaleActiveTask(t))) return false;
      }
      if (view === "stale" && !isStaleActiveTask(t)) return false;
      if (view === "today") {
        try {
          if (!t.queuedAt || Date.now() - Date.parse(t.queuedAt) > 24 * 3600 * 1000) return false;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [query, statusFilter, tasks, view]);

  const statusOptions = useMemo(() => {
    const seen = Array.from(new Set(tasks.map((t) => t.status))).sort();
    return ["all", ...seen];
  }, [tasks]);

  const detail = tasks.find((t) => t.id === detailId) ?? null;
  const detailApprovals = detail ? approvals.filter((a) => a.taskId === detail.id) : [];
  const detailEvents = detail ? traces[detail.id] ?? [] : [];
  const detailBlocks = detail
    ? dedupeOutcomeBlocks({
        summary: detail.resultSummary ?? null,
        verification: detail.verification
          ? `${detail.verification.passed == null ? "not checked" : detail.verification.passed ? "passed" : "did not pass"} — ${detail.verification.explanation ?? ""}`
          : null,
        error: detail.error ?? null,
        outcome: formatOutcome(detail.outcome ?? null),
      })
    : null;

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Tasks"
          description="Track every agent run, its approvals, and verified outcomes."
          action={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => router.push("/")}>New task</Button>}
        />

        {loadError ? <InlineBanner tone="error" title="Could not load tasks" body={loadError} /> : null}

        <div style={{ display: "flex", gap: "var(--ds-space-3)", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "var(--ds-space-4)" }}>
          <div style={{ minWidth: 220, flex: "1 1 220px" }}>
            <Field label="Search tasks">
              {(id) => <Input id={id} placeholder="Filter by request text…" value={query} onChange={(e) => setQuery(e.target.value)} />}
            </Field>
          </div>
          <div style={{ minWidth: 180 }}>
            <Field label="Status">
              {(id) => (
                <Select id={id} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Segmented<SavedView>
            label="Saved views"
            value={view}
            onChange={setView}
            options={[
              { value: "all", label: `All (${tasks.length})` },
              { value: "attention", label: "Needs attention" },
              { value: "stale", label: `Stale (${staleTasks.length})` },
              { value: "today", label: "Today" },
            ]}
          />
          <Button variant="secondary" disabled={staleTasks.length === 0 || clearing} loading={clearing} onClick={() => setConfirmClear(true)}>
            Clear stale{staleTasks.length > 0 ? ` (${staleTasks.length})` : ""}
          </Button>
        </div>

        {loading ? (
          <p style={{ color: "var(--ds-muted)", fontSize: "var(--ds-text-14)" }} aria-live="polite">Loading tasks…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={tasks.length === 0 ? "No tasks yet" : "No tasks match these filters"}
            body={tasks.length === 0 ? "Start a task from Chat and it will appear here with its steps and verification." : "Try a different saved view or clear the search."}
            mascot={tasks.length === 0 ? "normal" : undefined}
            action={tasks.length === 0 ? { label: "Start in Chat", onPress: () => router.push("/") } : undefined}
          />
        ) : (
          <Table<TaskItem>
            label="Tasks"
            rows={filtered}
            columns={[
              {
                key: "status",
                header: "Status",
                render: (t) => <StatusInline status={cardStatus(t)} />,
              },
              {
                key: "title",
                header: "Task",
                render: (t) => (
                  <span style={{ display: "block", minWidth: 0, maxWidth: 420 }}>
                    <span style={{ display: "block", fontWeight: 500, overflowWrap: "break-word" }}>{t.request}</span>
                    <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", fontFamily: "var(--ds-font-mono)" }} title={t.id}>{shortId(t.id)}</span>
                  </span>
                ),
              },
              {
                key: "started",
                header: "Started",
                render: (t) => <span style={{ whiteSpace: "nowrap" }}>{relativeTime(t.queuedAt ?? t.updatedAt) ?? "—"}</span>,
              },
              {
                key: "duration",
                header: "Duration",
                render: (t) => <span style={{ whiteSpace: "nowrap", fontFamily: "var(--ds-font-mono)" }}>{fmtDuration(t)}</span>,
              },
              {
                key: "agent",
                header: "Agent",
                render: () => <span style={{ whiteSpace: "nowrap" }}>VOW agent</span>,
              },
              {
                key: "outcome",
                header: "Outcome",
                render: (t) => <VerificationBadge state={verificationOf(t)} />,
              },
              {
                key: "open",
                header: "",
                render: (t) => (
                  <Button variant="ghost" size="sm" onClick={() => void openDetail(t)} aria-label={`Open details for ${shortId(t.id)}`}>
                    Details
                  </Button>
                ),
              },
            ]}
          />
        )}

        <Dialog
          title={staleTasks.length === 1 ? "Clear 1 stale task?" : `Clear ${staleTasks.length} stale tasks?`}
          open={confirmClear}
          onClose={() => setConfirmClear(false)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Keep tasks</Button>
              <Button variant="destructive" size="sm" loading={clearing} onClick={() => void clearStale()}>Clear stale</Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {staleTasks.length === 1
              ? "This task will be cancelled and removed from active views."
              : `These ${staleTasks.length} tasks will be cancelled and removed from active views.`}{" "}
            Cancelling archives them — no pending approval is granted and nothing executes. This cannot be undone.
          </p>
        </Dialog>

        <Dialog
          title={detail ? detail.request : "Task details"}
          open={detail !== null}
          onClose={() => setDetailId(null)}
          actions={
            detail ? (
              <>
                <Button variant="ghost" size="sm" icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={() => void copyId(detail.id)} title={detail.id}>
                  {copied ? "Copied" : `Copy ID (${shortId(detail.id)})`}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => router.push(`/?task=${detail.id}`)}>Open in Chat</Button>
              </>
            ) : undefined
          }
        >
          {detail ? (
            <div style={{ display: "grid", gap: "var(--ds-space-5)" }}>
              <StepTimeline
                verification={verificationOf(detail)}
                steps={(detail.plan?.steps ?? []).map((s) => ({
                  id: s.id,
                  title: s.title,
                  state: stepStateOf(s.status),
                  detail: s.instruction && s.instruction !== s.title ? s.instruction : undefined,
                }))}
              />
              <section aria-label="Subagents">
                <h3 style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 var(--ds-space-2)" }}>Subagents</h3>
                <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)" }}>
                  VOW agent · {taskStateLabel(taskCardState(detail.status, detail.outcome ?? null) as TaskCardState)}
                  {isStaleActiveTask(detail) ? " · stale, not currently running" : ""}
                </p>
              </section>
              <section aria-label="Logs">
                <h3 style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 var(--ds-space-2)" }}>Logs</h3>
                {detailEvents.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>No log entries recorded yet.</p>
                ) : (
                  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-2)" }}>
                    {detailEvents.map((e) => (
                      <li key={e.id} style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "8px 12px", background: "var(--ds-bg)" }}>
                        <p style={{ margin: 0, fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-ink)", overflowWrap: "anywhere" }}>{redactLogLine(e.title)}</p>
                        {e.detail ? (
                          <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-muted)", overflowWrap: "anywhere" }}>{redactLogLine(e.detail)}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              {detailApprovals.length > 0 ? (
                <section aria-label="Approvals" style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                  <h3 style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>Approvals</h3>
                  {detailApprovals.map((a) => (
                    a.status === "pending" ? (
                      <ApprovalCard
                        key={a.id}
                        title={`${a.tool} access request`}
                        tool={a.tool}
                        scope={a.target ?? shortId(a.taskId)}
                        blastRadius={[{ permission: "write", path: a.target ?? a.tool, note: `Requested by task ${shortId(a.taskId)}` }]}
                        onApprove={() => void decide(a.id, "approve")}
                        onDeny={() => void decide(a.id, "deny")}
                        onEditScope={() => router.push(`/?task=${detail.id}`)}
                      />
                    ) : (
                      <p key={a.id} style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>
                        {a.tool} · {a.status}
                      </p>
                    )
                  ))}
                </section>
              ) : null}
              {detailBlocks && (detailBlocks.summary || detailBlocks.verification || detailBlocks.error || detailBlocks.outcome) ? (
                <section aria-label="Outcome">
                  <h3 style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 var(--ds-space-2)" }}>Outcome</h3>
                  {detailBlocks.summary ? <p style={{ margin: "0 0 8px", fontSize: "var(--ds-text-14)", color: "var(--ds-ink)" }}>{detailBlocks.summary}</p> : null}
                  {detailBlocks.verification ? <p style={{ margin: "0 0 8px", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>Verification: {detailBlocks.verification}</p> : null}
                  {detailBlocks.error ? <p style={{ margin: "0 0 8px", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>Error: {detailBlocks.error}</p> : null}
                  {detailBlocks.outcome ? <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>{detailBlocks.outcome}</p> : null}
                  <EvidenceReceipt
                    taskId={detail.id}
                    title={detail.request}
                    duration={fmtDuration(detail)}
                    state={verificationOf(detail)}
                    checks={[{ label: "Independent receipt check", state: detail.verification?.passed === true ? "passed" : detail.verification?.passed === false ? "failed" : "pending", detail: detail.verification?.explanation ?? "No explanation recorded." }]}
                  />
                </section>
              ) : null}
            </div>
          ) : null}
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}
