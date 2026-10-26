"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity, Check, Cpu, FileText,
  Globe, Maximize2, Pin, RotateCw, ShieldAlert,
  ShieldCheck, X,
} from "lucide-react";
import { useMode } from "@/components/shell/ModeContext";
import { useChrome } from "@/components/shell/ChromeContext";
import { relativeTime } from "@/lib/relative-time";
import { humanEvent } from "@/lib/humanize";
import {
  freshestTaskTimestamp,
  isActiveTaskStatus,
  isStaleActiveTask,
  isWorkingState,
  monitorHeaderFor,
  stepProgress,
  stepStatusText,
  stepTone,
  taskCardState,
  taskStateLabel,
  wardenDisplay,
  type WardenBackend,
} from "@/lib/task-display";
import { ApprovalCard } from "@/components/ui/trust";
import type { PermissionLevel } from "@/components/ui/badges";
import { StatusInline } from "@/components/ui/badges";

interface PlanStep {
  id: string;
  title: string;
  status: string;
}

interface MonitorTask {
  id: string;
  request: string;
  conversationId?: string;
  queuedAt?: string | null;
  updatedAt?: string | null;
  lastHeartbeat?: string | null;
  pendingApprovalId?: string | null;
  status: string;
  plan: { steps: PlanStep[] } | null;
  resultSummary?: string | null;
  outcome?: { outcome: string; reason: string } | null;
}

interface TraceEvent {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  createdAt: string;
}

interface ApprovalItem {
  id: string;
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  status: string;
}

function eventIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("approv") || k.includes("policy") || k.includes("warden")) return ShieldAlert;
  if (k.includes("tool")) return Cpu;
  if (k.includes("model") || k.includes("search") || k.includes("brows")) return Globe;
  if (k.includes("verif") || k.includes("complet")) return Check;
  if (k.includes("read") || k.includes("memory")) return FileText;
  return Activity;
}

/** Permission inferred from the tool name. Display-only: the backend owns enforcement. */
export function inferPermission(tool: string): PermissionLevel {
  const t = tool.toLowerCase();
  if (/read|search|fetch|get|query|list|view|inspect/.test(t)) return "read";
  if (/write|create|update|delete|send|execute|run|apply|publish|edit|move|remove/.test(t)) return "write";
  return "read-append";
}

export function formatArgs(args: Record<string, unknown>): string {
  try {
    const raw = JSON.stringify(args);
    return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
  } catch {
    return "{}";
  }
}

const WIDTH_KEY = "vow-activity-width-v1";
const PIN_KEY = "vow-activity-pinned-v1";

function clampWidth(n: number): number {
  return Math.min(360, Math.max(320, Math.round(n)));
}

export function PersistentLiveActivity() {
  const { warden, wardenBackend, wardenPending } = useMode();
  const { drawerOpen, setDrawerOpen, toggleDrawer, conversationId: chromeConversationId, setPendingApprovals } = useChrome();
  const backend: WardenBackend =
    wardenBackend ?? (wardenPending ? { status: "pending" } : { status: "unknown", error: "not checked yet" });
  const wardenUi = wardenDisplay(warden, backend);
  const [tasks, setTasks] = useState<MonitorTask[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [width, setWidth] = useState(340);
  const [pinned, setPinned] = useState(false);
  // Visual-verification hook (?demo=task / ?demo=approval): applied after
  // mount so server HTML and the first client render always agree (the demo
  // carries a timestamp). Realistic examples; real backend state wins.
  // Display-only: the backend is never touched.
  // ?demo= hook is compiled out of production: Next.js inlines NODE_ENV,
  // so the minifier drops the demo branch entirely from prod bundles.
  const allowDemoHooks = process.env.NODE_ENV !== "production";
  const [demoKind, setDemoKind] = useState<string | null>(null);
  useEffect(() => {
    if (!allowDemoHooks) return;
    try {
      setDemoKind(new URLSearchParams(window.location.search).get("demo"));
    } catch { /* ignore */ }
  }, [allowDemoHooks]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WIDTH_KEY);
      if (raw !== null && raw !== "") {
        const w = Number(raw);
        if (Number.isFinite(w)) setWidth(clampWidth(w));
      }
      setPinned(window.localStorage.getItem(PIN_KEY) === "1");
    } catch { /* ignore */ }
  }, []);

  const persistWidth = useCallback((w: number) => {
    const c = clampWidth(w);
    setWidth(c);
    try { window.localStorage.setItem(WIDTH_KEY, String(c)); } catch { /* ignore */ }
  }, []);

  const togglePinned = useCallback(() => {
    setPinned((v) => {
      try { window.localStorage.setItem(PIN_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [taskRes, traceRes, apprRes] = await Promise.all([
        fetch("/api/agent").then((r) => r.json()).catch(() => ({})),
        fetch("/api/traces/all").then((r) => r.json()).catch(() => ({})),
        fetch("/api/approvals").then((r) => r.json()).catch(() => ({})),
      ]);
      const fetchedTasks = (taskRes.tasks ?? []) as MonitorTask[];
      const traces = (traceRes.traces ?? []) as Array<{ taskId: string; events: TraceEvent[] }>;
      setTasks(fetchedTasks);
      setApprovals(((apprRes.approvals ?? []) as ApprovalItem[]).filter((a) => a.status === "pending"));
      // The live card follows the open conversation's active task. On the
      // default root (no open conversation), only follow a freshly executing
      // task — a quiet `executing` record is stale, not live work.
      const scoped = chromeConversationId
        ? fetchedTasks.filter((t) => t.conversationId === chromeConversationId)
        : [];
      const isFresh = (x: MonitorTask) => !isStaleActiveTask(x);
      const live = chromeConversationId
        ? (scoped.find((x) => isActiveTaskStatus(x.status) && isFresh(x))
          ?? scoped.find((x) => isActiveTaskStatus(x.status))
          ?? null)
        : (fetchedTasks.find((x) => x.status === "executing" && isFresh(x)) ?? null);
      const trace = live ? traces.find((t) => t.taskId === live.id) : undefined;
      setEvents(trace ? trace.events.slice(-6) : []);

      const pendingApprovals = ((apprRes.approvals ?? []) as ApprovalItem[]).filter((a) => a.status === "pending");
      // Orphan guard: ignore approvals whose task is no longer active
      // (cancelled, completed, failed, blocked). Approving an orphan resumes
      // nothing — the backend routes continueTask to cancelNow — so surfacing
      // it would promise an action that cannot happen.
      const liveApprovals = pendingApprovals.filter((a) =>
        fetchedTasks.some((t) => t.id === a.taskId && isActiveTaskStatus(t.status)),
      );
      const activeApprovals = chromeConversationId
        ? liveApprovals.filter((a) => scoped.some((t) => t.id === a.taskId))
        : (live ? liveApprovals.filter((a) => a.taskId === live.id) : []);
      setApprovals(activeApprovals);
      setLoadError(false);
    } catch {
      // Keep last known state, but say so honestly instead of silently stalling.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [chromeConversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const demoTask: MonitorTask | null = !allowDemoHooks ? null : demoKind === "task" || demoKind === "approval" ? {
    id: "demo-task-01",
    request: "Summarize the Q3 planning notes into decisions and owners",
    conversationId: chromeConversationId ?? "demo",
    queuedAt: new Date().toISOString(),
    status: demoKind === "approval" ? "awaiting_approval" : "executing",
    plan: {
      steps: [
        { id: "s1", title: "Read the planning notes", status: "completed" },
        { id: "s2", title: "Extract decisions and owners", status: "executing" },
        { id: "s3", title: "Verify owners against the team list", status: "queued" },
      ],
    },
  } : null;
  const demoApprovalList: ApprovalItem[] = !allowDemoHooks ? [] : demoKind === "approval" && demoTask ? [{
    id: "demo-approval-01",
    taskId: demoTask.id,
    tool: "filesystem.write",
    args: { path: "notes/decisions.md", mode: "create" },
    target: "notes/decisions.md",
    status: "pending",
  }] : [];

  const scopedTasks = chromeConversationId
    ? tasks.filter((t) => t.conversationId === chromeConversationId)
    : [];
  // Authoritative live task: follow the conversation's active task when a chat
  // is open. On root (no conversation), only a freshly executing task counts
  // as live — stale `executing` records are shown as stale, never as working.
  const activeTask = chromeConversationId
    ? (scopedTasks.find((t) => isActiveTaskStatus(t.status)) ?? null)
    : (tasks.find((t) => t.status === "executing" && !isStaleActiveTask(t)) ?? null);
  // A stale record kept for context (conversation-scoped) so it can be
  // labelled honestly instead of as running.
  const staleScopedTask = chromeConversationId
    ? (scopedTasks.find((t) => isActiveTaskStatus(t.status) && isStaleActiveTask(t)) ?? null)
    : null;
  const realApprovals = approvals;
  const visibleApprovals = realApprovals.length > 0 ? realApprovals : demoApprovalList;
  const displayTask = activeTask ?? staleScopedTask ?? (demoKind ? demoTask : null);
  const isRealActiveTask = activeTask !== null;
  const isStaleDisplay = displayTask ? isStaleActiveTask(displayTask) : false;
  const displayApprovals = displayTask ? visibleApprovals.filter((a) => a.taskId === displayTask.id) : [];
  useEffect(() => {
    setPendingApprovals(approvals.length);
  }, [approvals.length, setPendingApprovals]);
  const startedAt = (() => {
    try {
      const q = displayTask?.queuedAt;
      return q
        ? new Date(q).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : null;
    } catch {
      return null;
    }
  })();
  const cardState = displayTask ? taskCardState(displayTask.status, displayTask.outcome ?? null) : null;
  const header = displayTask
    ? monitorHeaderFor(displayTask, {
        stale: isStaleDisplay,
        hasPendingApproval: cardState === "waiting_approval" ? displayApprovals.length > 0 : undefined,
      })
    : { mode: "idle" as const, text: "Up to date" };

  // Auto-open when live work appears, an approval lands, or the panel is
  // pinned. Collapse when idle so there is never a large empty panel.
  // A manual Monitor-toggle open while idle is respected: this effect only
  // runs when its inputs change, never on a timer.
  const hadSignal = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    const signal = isRealActiveTask || displayApprovals.length > 0 || pinned;
    if (signal) {
      hadSignal.current = true;
      setDrawerOpen(true);
    } else if (!mounted.current) {
      // Fresh idle load: start collapsed rather than showing an empty panel.
      // An explicit ?monitor=1 open is a prop-level initial, applied before
      // this effect, and is left alone on mount.
      if (drawerOpen && !pinned) setDrawerOpen(false);
    } else if (hadSignal.current && !pinned) {
      hadSignal.current = false;
      setDrawerOpen(false);
    }
    mounted.current = true;
  }, [isRealActiveTask, displayApprovals.length, pinned, setDrawerOpen]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const decide = useCallback(async (approvalId: string, decision: "approve" | "deny") => {
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Approval decision failed.");
      setNotice(decision === "approve" ? "Approved. Task resumed." : "Denied. Task paused.");
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Approval decision failed.");
    }
    setTimeout(() => setNotice(null), 3000);
  }, [refresh]);

  const steps = displayTask?.plan?.steps ?? [];
  const progress = stepProgress(steps);

  // Collapsed strip when idle: a 44px rail, never a large empty panel.
  if (!drawerOpen) {
    const pending = approvals.length;
    const dot = pending > 0 || isRealActiveTask;
    return (
      <div className="shell-activity-strip">
        <button
          type="button"
          className="shell-iconbtn"
          onClick={toggleDrawer}
          aria-label={pending > 0 ? `Show activity, ${pending} approval${pending === 1 ? "" : "s"} pending` : "Show activity"}
          title={pending > 0 ? `Show activity — ${pending} approval${pending === 1 ? "" : "s"} pending (⌘⇧M)` : "Show activity (⌘⇧M)"}
          aria-expanded={false}
          style={{ position: "relative" }}
        >
          <Activity size={18} aria-hidden="true" />
          {pending > 0 ? (
            <span aria-hidden="true" style={{ position: "absolute", top: 2, right: 2, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--ds-accent)", color: "var(--ds-accent-ink)", fontSize: 11, fontWeight: 700, lineHeight: "18px", textAlign: "center" }}>{pending > 9 ? "9+" : pending}</span>
          ) : dot ? (
            <span aria-hidden="true" style={{ position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: "var(--ds-amber-700)" }} />
          ) : null}
        </button>
      </div>
    );
  }

  const headerBadge = (() => {
    if (!displayTask || !cardState || isStaleDisplay) return null;
    if (cardState === "running" || cardState === "verifying") return <StatusInline status="running" />;
    if (cardState === "waiting_approval") {
      return <StatusInline status={displayApprovals.length > 0 ? "waiting" : "needs-review"} />;
    }
    return <span className="shell-muted">{taskStateLabel(cardState)}</span>;
  })();

  return (
    <aside
      className="shell-activity"
      aria-label="Activity"
      style={{ ["--shell-activity-w" as string]: `${width}px` }}
    >
      <div
        className="shell-activity-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize activity panel"
        aria-valuenow={width}
        aria-valuemin={320}
        aria-valuemax={360}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); persistWidth(width - 8); }
          if (e.key === "ArrowRight") { e.preventDefault(); persistWidth(width + 8); }
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = width;
          const move = (ev: PointerEvent) => persistWidth(startW + (startX - ev.clientX));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div className="shell-activity-head">
        <h2 className="shell-activity-title">Activity</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {loading ? (
            <span className="shell-muted" aria-live="polite">Loading…</span>
          ) : displayTask ? (
            header.mode === "working" || header.mode === "waiting" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{headerBadge}<span className="shell-muted">{header.text}</span></span>
            ) : (
              <span className="shell-muted">{header.text}</span>
            )
          ) : (
            <span className="shell-muted">Up to date</span>
          )}
          {loadError && !loading ? (
            <span className="shell-muted" title="Showing last known state">stale</span>
          ) : null}
          <button
            type="button"
            onClick={togglePinned}
            className="shell-iconbtn"
            aria-pressed={pinned}
            aria-label={pinned ? "Unpin activity panel" : "Pin activity panel"}
            title={pinned ? "Unpin activity panel" : "Pin activity panel"}
          >
            <Pin size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggleDrawer}
            className="shell-iconbtn"
            aria-label="Collapse activity"
            title="Collapse activity (⌘⇧M)"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="shell-activity-body">
        <section className="shell-card" aria-label="Current task">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <p className="shell-card-title">Current task</p>
            {displayTask && cardState ? (
              isStaleDisplay ? (
                <StatusInline status="stale" />
              ) : headerBadge
            ) : (
              <span className="shell-muted">No active task</span>
            )}
          </div>
          {loading ? (
            <p className="shell-muted" aria-live="polite">Loading task state…</p>
          ) : displayTask ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="shell-trace-ic" aria-hidden="true">{warden ? <ShieldCheck size={13} /> : <Cpu size={13} />}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-ink)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayTask.request}</p>
                  <p className="shell-muted" style={{ fontSize: "var(--ds-text-12)" }}>
                    {isStaleDisplay
                      ? `Stale · last activity ${relativeTime(freshestTaskTimestamp(displayTask) ? new Date(freshestTaskTimestamp(displayTask) as number).toISOString() : displayTask.updatedAt ?? displayTask.queuedAt) ?? "a while ago"}`
                      : startedAt ? `Started ${startedAt}` : agentLabel(cardState)}
                  </p>
                </div>
              </div>
              {progress && cardState && isWorkingState(cardState) && !isStaleDisplay ? (
                <div className="shell-progress" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Task step progress" style={{ marginTop: 12 }}>
                  <div style={{ width: `${progress.pct}%` }} />
                </div>
              ) : null}
              <div style={{ paddingTop: 8, fontSize: "var(--ds-text-13)" }}>
                {steps.length === 0 ? (
                  <p className="shell-muted">Plan is being prepared. Steps will appear here once planning completes.</p>
                ) : steps.slice(0, 5).map((s) => {
                  const st = stepTone(s.status);
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 32 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, color: "var(--ds-ink)" }}>
                        <StepDot tone={st} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                      </span>
                      <span className="shell-muted" style={{ fontSize: "var(--ds-text-12)", flex: "none" }}>
                        {stepStatusText(s.status)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="shell-muted">No active task. Start a new task from Chat.</p>
          )}
        </section>

        <section className="shell-card" aria-label="Recent activity">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p className="shell-card-title">{warden ? "Policy log" : "Recent activity"}</p>
            <Link href="/history" style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-accent)", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              View all
            </Link>
          </div>
          {loading ? (
            <p className="shell-muted" aria-live="polite">Loading activity…</p>
          ) : events.length > 0 ? (
            <ul className="shell-trace">
              {events.slice(-5).reverse().map((e) => {
                const Icon = eventIcon(e.kind);
                const h = humanEvent(e.kind, e.title, e.detail ?? "");
                return (
                  <li key={e.id} className="shell-trace-row">
                    <span className="shell-trace-ic" aria-hidden="true">
                      <Icon size={12} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="shell-trace-t" title={e.title}>{h.title}</span>
                      <span className="shell-trace-time">{relativeTime(e.createdAt) ?? "—"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="shell-muted">No recent activity yet.</p>
          )}
        </section>

        {displayApprovals.length > 0 ? (
          <section aria-label="Approvals" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {displayApprovals.slice(0, 3).map((a) => (
              <ApprovalCard
                key={a.id}
                title="Tool access request"
                tool={a.tool}
                scope={a.target ?? a.tool}
                blastRadius={[{
                  path: a.target ?? a.tool,
                  permission: inferPermission(a.tool),
                  note: `${a.tool} ${formatArgs(a.args)}`,
                }]}
                onApprove={() => void decide(a.id, "approve")}
                onDeny={() => void decide(a.id, "deny")}
                onEditScope={() => setNotice("Open the task in Chat to edit approval scope.")}
              />
            ))}
          </section>
        ) : displayTask && cardState === "waiting_approval" ? (
          <div className="shell-card">
            <p className="shell-card-title">Approval needs review</p>
            <p className="shell-muted">
              This task is waiting for approval, but no pending approval request was found. The request may have expired or been resolved. Open the task to review.
            </p>
          </div>
        ) : null}

        {warden ? (
          <section className="shell-card" aria-label="Warden status">
            <p className="shell-card-title">Warden status</p>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span className="shell-trace-ic" style={{ width: 36, height: 36, background: "var(--ds-accent-wash)", color: "var(--ds-accent)" }} aria-hidden="true">
                <ShieldCheck size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-ink)", margin: "0 0 2px" }}>
                  {wardenUi.panelTitle}
                </p>
                <p className="shell-muted">
                  {wardenUi.panelTitle === "WARDEN ACTIVE"
                    ? "Monitoring tool access, permissions, and execution in real time."
                    : wardenUi.panelSub}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/history" aria-label="Open full history" className="shell-iconbtn" title="Open full history">
            <Maximize2 size={14} aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => void refresh()} aria-label="Reload activity" title="Reload activity" className="shell-iconbtn">
            <RotateCw size={14} aria-hidden="true" />
          </button>
        </div>
        </div>

      {notice ? (
        <p className="shell-muted" role="status" aria-live="polite" style={{ padding: "0 16px 16px" }}>{notice}</p>
      ) : null}
    </aside>
  );
}

function agentLabel(cardState: ReturnType<typeof taskCardState> | null): string {
  if (!cardState) return "Idle";
  if (cardState === "waiting_approval") return "Waiting for approval";
  if (cardState === "running" || cardState === "verifying") return "Working…";
  return taskStateLabel(cardState);
}

function StepDot({ tone }: { tone: ReturnType<typeof stepTone> }) {
  const base: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: "50%",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (tone === "done") {
    return <span aria-hidden="true" style={{ ...base, background: "var(--ds-green-700)", color: "var(--ds-surface)" }}><Check size={9} strokeWidth={3} /></span>;
  }
  if (tone === "failed") {
    return <span aria-hidden="true" style={{ ...base, background: "var(--ds-red-700)", color: "var(--ds-surface)" }}><X size={9} strokeWidth={3} /></span>;
  }
  if (tone === "blocked") {
    return <span aria-hidden="true" style={{ ...base, background: "var(--ds-amber-wash)", border: "2px solid var(--ds-amber-700)" }} />;
  }
  if (tone === "now") {
    return <span aria-hidden="true" style={{ ...base, border: "2px solid var(--ds-accent)" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ds-accent)" }} /></span>;
  }
  return <span aria-hidden="true" style={{ ...base, border: "2px solid var(--ds-border-strong)" }} />;
}
