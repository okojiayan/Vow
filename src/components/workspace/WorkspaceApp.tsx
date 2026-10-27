"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp, ChevronDown, Cpu, Mic, Paperclip, Square, UserRound,
} from "lucide-react";
import { useMode } from "@/components/shell/ModeContext";
import { useChrome } from "@/components/shell/ChromeContext";
import { AutonomyMenu } from "@/components/autonomy/AutonomyMenu";
import { Companion } from "@/components/vow/Companion";
import { setMicActive, useCompanionAgent } from "@/lib/companion";
import { loadPreferences } from "@/lib/preferences";
import {
  dedupeOutcomeBlocks,
  isActiveTaskStatus,
  isStaleActiveTask,
  isWorkingState,
  agentStatusText,
  formatOutcome,
  stepProgress,
  stepStatusText,
  stepTone,
  taskCardState,
  taskStateLabel,
} from "@/lib/task-display";
import { ApprovalCard, EvidenceReceipt, StepTimeline, type StepState } from "@/components/ui/trust";
import { StatusInline, VerificationBadge, type VerificationState } from "@/components/ui/badges";
import { InlineBanner } from "@/components/ui/feedback";
import { formatArgs, inferPermission } from "@/components/live/PersistentLiveActivity";

interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  taskId?: string;
  createdAt: string;
}

interface PlanStep {
  id: string;
  title: string;
  status: string;
}

interface TaskItem {
  id: string;
  conversationId: string;
  parentTaskId?: string | null;
  request: string;
  queuedAt?: string | null;
  status: string;
  plan: { summary?: string; steps: PlanStep[] } | null;
  resultSummary: string | null;
  verification: { passed: boolean | null; explanation: string } | null;
  error: string | null;
  outcome?: { outcome: string; reason: string } | null;
}

interface ApprovalItem {
  id: string;
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  status: string;
}

const CHIPS = [
  { label: "Research a topic and draft findings", text: "Research the latest developments in this area, compare the options, and create a short report with key insights." },
  { label: "Draft a note from my idea", text: "Create a new note that captures my idea, with a clear title and next steps." },
  { label: "Summarize with evidence", text: "Analyze this repository and summarize the findings with evidence." },
  { label: "Propose an organization plan", text: "Review workspace files, propose an organization plan, and request approval before moving anything." },
  { label: "Set up a recurring routine", text: "Set up an automated routine for my recurring work and explain what it will do before enabling it." },
];

function UserAvatar() {
  return (
    <span className="shell-ava" aria-hidden="true">
      <UserRound size={16} />
    </span>
  );
}

export function WorkspaceApp() {
  return (
    <Suspense fallback={<p className="text-sm p-8 text-gray-500">Loading workspace…</p>}>
      <WorkspaceInner />
    </Suspense>
  );
}

function WorkspaceInner() {
  const { uiMode, warden: wardenVisual, setUiMode } = useMode();
  const { newChatSignal, setConversationId: setChromeConversationId } = useChrome();
  const [composerText, setComposerText] = useState("");
  const [attached, setAttached] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [greeting, setGreeting] = useState({ headline: "Good evening!", sub: "What would you like to work on today?" });
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const endPadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const attachRequested = searchParams?.get("attach") === "1";
  const convoRequested = searchParams?.get("convo");
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    if (toolsOpen) {
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }
  }, [toolsOpen]);

  useEffect(() => {
    const hr = new Date().getHours();
    const part = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
    setGreeting({
      headline: `Good ${part}!`,
      sub: wardenVisual ? "Warden is watching over your work." : "What would you like to work on today?",
    });
  }, [wardenVisual]);

  const refresh = useCallback(async () => {
    try {
      const [convRes, taskRes, apprRes] = await Promise.all([
        fetch("/api/conversations").then((r) => r.json()).catch(() => ({})),
        fetch("/api/agent").then((r) => r.json()).catch(() => ({})),
        fetch("/api/approvals").then((r) => r.json()).catch(() => ({})),
      ]);
      const conversations = (convRes.conversations ?? []) as Array<{ id: string; messages: ConversationMessage[] }>;
      const fetchedTasks = (taskRes.tasks ?? []) as TaskItem[];
      const fetchedApprovals = (apprRes.approvals ?? []) as ApprovalItem[];
      setTasks(fetchedTasks);
      setApprovals(fetchedApprovals.filter((a) => a.status === "pending"));
      setConversationId((prev) => {
        if (convoRequested) {
          const match = conversations.find((c) => c.id === convoRequested);
          if (match) {
            setMessages(match.messages ?? []);
            return convoRequested;
          }
        }
        if (prev) {
          const match = conversations.find((c) => c.id === prev);
          if (match) {
            setMessages(match.messages ?? []);
            return prev;
          }
        }
        // When on root / with no explicit convo requested, keep clean state for canonical showcase
        setMessages([]);
        return null;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load workspace state.");
    } finally {
      setLoading(false);
    }
  }, [convoRequested]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (convoRequested) {
      setConversationId(convoRequested);
    }
  }, [convoRequested]);

  useEffect(() => {
    if (attachRequested && !loading) {
      // Library Upload deep-link: open the real file picker in the composer.
      const id = window.setTimeout(() => fileRef.current?.click(), 400);
      return () => window.clearTimeout(id);
    }
  }, [attachRequested, loading]);

  useEffect(() => {
    if (newChatSignal > 0) {
      setConversationId(null);
      setMessages([]);
      setComposerText("");
      setAttached([]);
    }
  }, [newChatSignal]);

  // Keep the monitor rail scoped to this conversation: the rail shows this
  // chat's task when it has one and falls back to the latest active task.
  useEffect(() => {
    setChromeConversationId(conversationId);
  }, [conversationId, setChromeConversationId]);

  const activeTask: TaskItem | null = (() => {
    if (!conversationId) {
      // On default root, only follow a freshly active task — a quiet
      // `executing` record is stale, not live work.
      return tasks.find((t) => isActiveTaskStatus(t.status) && !isStaleActiveTask(t)) ?? null;
    }
    const scoped = tasks.filter((t) => t.conversationId === conversationId);
    return scoped.find((t) => isActiveTaskStatus(t.status)) ?? scoped[0] ?? null;
  })();
  const staleActiveTask: TaskItem | null = (() => {
    if (!conversationId) return null;
    const scoped = tasks.filter((t) => t.conversationId === conversationId);
    const live = scoped.find((t) => isActiveTaskStatus(t.status));
    return live && isStaleActiveTask(live) ? live : null;
  })();
  // The card may show the latest terminal task; cardState keeps the display
  // honest (terminal states never render as running and never show a bar).
  const displayTask = activeTask ?? staleActiveTask;
  const cardState = displayTask ? taskCardState(displayTask.status, displayTask.outcome ?? null) : null;
  const isStaleCard = displayTask ? isStaleActiveTask(displayTask) : false;
  const isActive = cardState
    ? (isWorkingState(cardState) && !isStaleCard) || (cardState === "waiting_approval" && !isStaleCard)
    : false;

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [isActive, refresh]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    // Keep scrollTop = 0 on initial load so the Greeting, Crystal, and Suggestion chips
    // are immediately front-and-center when loading /!
    if (!sending) {
      el.scrollTop = 0;
      return;
    }
    const pad = endPadRef.current?.offsetHeight ?? 0;
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - pad);
  }, [sending, messages.length]);

  const sendMessage = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;
    const suffix = attached.length > 0 ? `\n\n[Attached: ${attached.join(", ")}]` : "";
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text + suffix, conversationId: conversationId ?? undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Task request failed.");
      if (payload.conversation) {
        setConversationId(payload.conversation.id);
        setMessages(payload.conversation.messages ?? []);
      }
      setComposerText("");
      setAttached([]);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message.");
    } finally {
      setSending(false);
    }
  }, [attached, conversationId, refresh, sending]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    void sendMessage(composerText);
  };

  const handleChip = (text: string) => {
    void sendMessage(text);
  };

  const handleDecide = useCallback(async (approvalId: string, decision: "approve" | "deny") => {
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Approval decision failed.");
      flash(decision === "approve" ? "Tool access approved. Task resumed." : "Tool access denied. Task paused.");
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Approval decision failed.");
    }
  }, [flash, refresh]);

  const toggleVoice = () => {
    if (recording) {
      try { recogRef.current?.stop(); } catch { /* ignore */ }
      setRecording(false);
      setMicActive(false);
      return;
    }
    const W = window as unknown as { SpeechRecognition?: new () => { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void }; webkitSpeechRecognition?: new () => { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void } };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { flash("Voice input is not supported in this browser. Type your message instead."); return; }
    try {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const t = e.results?.[0]?.[0]?.transcript ?? "";
        if (t) setComposerText((v) => (v ? v + " " : "") + t);
      };
      rec.onerror = () => { setRecording(false); setMicActive(false); };
      rec.onend = () => { setRecording(false); setMicActive(false); };
      recogRef.current = rec;
      rec.start();
      setRecording(true);
      setMicActive(true);
    } catch {
      flash("Voice input could not start. Type your message instead.");
    }
  };

  // Visual-verification hooks (?demo=task / ?demo=approval): applied after
  // mount so server HTML and the first client render always agree (the demo
  // carries timestamps). Realistic examples; real backend state wins.
  // Display-only: the backend is never touched.
  // ?demo= hooks are compiled out of production: Next.js inlines NODE_ENV,
  // so the minifier drops the demo branch entirely from prod bundles.
  const allowDemoHooks = process.env.NODE_ENV !== "production";
  const [demoKind, setDemoKind] = useState<string | null>(null);
  useEffect(() => {
    if (!allowDemoHooks) return;
    try {
      setDemoKind(new URLSearchParams(window.location.search).get("demo"));
    } catch { /* ignore */ }
  }, [allowDemoHooks]);
  const demoTask: TaskItem | null = !allowDemoHooks ? null : demoKind === "task" || demoKind === "approval" ? {
    id: "demo-task-01",
    conversationId: conversationId ?? "demo",
    parentTaskId: null,
    request: "Summarize the Q3 planning notes into decisions and owners",
    queuedAt: new Date().toISOString(),
    status: demoKind === "approval" ? "awaiting_approval" : "executing",
    plan: {
      summary: "Read notes, extract decisions, verify owners",
      steps: [
        { id: "s1", title: "Read the planning notes", status: "completed" },
        { id: "s2", title: "Extract decisions and owners", status: "executing" },
        { id: "s3", title: "Verify owners against the team list", status: "queued" },
      ],
    },
    resultSummary: null,
    verification: { passed: null, explanation: "Ownership check has not run yet." },
    error: null,
    outcome: null,
  } : null;
  const demoApprovals: ApprovalItem[] = !allowDemoHooks ? [] : demoKind === "approval" && demoTask ? [{
    id: "demo-approval-01",
    taskId: demoTask.id,
    tool: "filesystem.write",
    args: { path: "notes/decisions.md", mode: "create" },
    target: "notes/decisions.md",
    status: "pending",
  }] : [];

  const shownTask = displayTask ?? demoTask;
  const shownCardState = shownTask ? taskCardState(shownTask.status, shownTask.outcome ?? null) : null;
  const shownStale = shownTask ? (displayTask ? isStaleCard : false) : false;
  const shownWorking = shownCardState ? isWorkingState(shownCardState) && !shownStale : false;
  const steps = shownTask?.plan?.steps ?? [];
  const progress = stepProgress(steps);
  const blocks = shownTask && !shownWorking
    ? dedupeOutcomeBlocks({
        summary: shownTask.resultSummary,
        verification: shownTask.verification
          ? `${shownTask.verification.passed == null ? "not checked" : shownTask.verification.passed ? "passed" : "did not pass"} — ${shownTask.verification.explanation}`
          : null,
        error: shownTask.error,
        outcome: formatOutcome(shownTask.outcome ?? null),
      })
    : null;
  const pendingForTask = shownTask
    ? (demoApprovals.length > 0 ? demoApprovals : approvals.filter((a) => a.taskId === shownTask.id))
    : approvals;

  const [planOpen, setPlanOpen] = useState(true);
  const shownVerification: VerificationState =
    shownTask?.verification?.passed === true ? "verified"
    : shownTask?.verification?.passed === false ? "failed"
    : "unverified";

  const timelineSteps = steps.map((st, i) => ({
    id: st.id || `step-${i}`,
    title: st.title,
    state: mapStepState(st.status),
    detail: stepStatusText(st.status),
  }));

  const isEmpty = messages.length === 0 && !loading && !shownTask;
  const companionMode = (() => { try { return loadPreferences().companion ?? "full"; } catch { return "full" as const; } })();
  const { state: companionState, lookAtActivity } = useCompanionAgent(conversationId ?? null, isEmpty && companionMode === "full");
  const reduceMotion = (() => { try { return loadPreferences().reduceMotion ?? false; } catch { return false; } })();

  return (
    <div className="shell-chat">
      <div ref={chatScrollRef} className="shell-chat-scroll">
        {!isEmpty ? <h1 className="ds-sr">VOW chat</h1> : null}
        {isEmpty ? (
          <div className="shell-empty">
            {companionMode !== "off" ? (
              <Companion
                variant={wardenVisual ? "warden" : "normal"}
                liveliness={companionMode === "subtle" ? "static" : "live"}
                calm={companionMode === "subtle"}
                reducedMotion={reduceMotion}
                state={companionState}
                lookAtActivity={lookAtActivity}
                interactive
                showBubble
                className="companion-hero"
                label={wardenVisual ? "Interact with VOW Warden mascot" : "Interact with VOW mascot"}
              />
            ) : null}
            <h1 className="shell-greet">{greeting.headline} {greeting.sub}</h1>
            <div className="shell-sugs" role="group" aria-label="Suggestions">
              {CHIPS.map(({ label, text }) => (
                <button key={label} type="button" onClick={() => handleChip(text)} disabled={sending} className="shell-sug-link">
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="shell-thread" aria-live="polite">
            <div className="shell-msg-row">
              <span className="shell-ava" aria-hidden="true">
                <Image src={wardenVisual ? "/assets/vow/warden.webp" : "/assets/vow/mascot.webp"} alt="" width={32} height={32} />
              </span>
              <div className="shell-bubble">Loading conversation…</div>
            </div>
          </div>
        ) : null}

        {error && !loading ? (
          <div style={{ padding: "12px 0" }}>
            <InlineBanner tone="error" title="Could not load workspace state" body={error ?? ""} />
          </div>
        ) : null}

        {messages.length > 0 || shownTask ? (
          <div className="shell-thread">
            {messages.map((message) => {
              const mine = message.role === "user";
              return (
                <div key={message.id} className={`shell-msg-row${mine ? " mine" : ""}`}>
                  {!mine ? (
                    <span className="shell-ava" aria-hidden="true">
                      <Image src={wardenVisual ? "/assets/vow/warden.webp" : "/assets/vow/mascot.webp"} alt="" width={32} height={32} />
                    </span>
                  ) : null}
                  <div className={`shell-bubble${mine ? " user" : ""}`}>{message.content}</div>
                  {mine ? <UserAvatar /> : null}
                </div>
              );
            })}

            {shownTask && shownCardState ? (
              <div className="shell-taskcard" aria-label="Task progress">
                <button
                  type="button"
                  className="shell-plan-toggle"
                  aria-expanded={planOpen}
                  onClick={() => setPlanOpen((v) => !v)}
                >
                  <span className="shell-plan-title">
                    {shownStale
                      ? "Stale — not currently running"
                      : shownWorking
                        ? (wardenVisual ? "Protected task execution" : "Working on your task…")
                        : taskStateLabel(shownCardState)}
                  </span>
                  {progress && shownWorking ? (
                    <span className="shell-muted" aria-hidden="true">{progress.pct}%</span>
                  ) : null}
                  {shownWorking ? (
                    <StatusInline status="running" />
                  ) : shownCardState === "waiting_approval" ? (
                    <StatusInline status={pendingForTask.length > 0 ? "waiting" : "needs-review"} />
                  ) : shownCardState === "completed" ? (
                    <StatusInline status="completed" />
                  ) : shownCardState === "failed" ? (
                    <StatusInline status="failed" />
                  ) : shownCardState === "blocked" ? (
                    <StatusInline status="blocked" />
                  ) : shownCardState === "unverified" ? (
                    <StatusInline status="unverified" />
                  ) : shownStale ? (
                    <StatusInline status="stale" />
                  ) : null}
                  <ChevronDown size={16} aria-hidden="true" style={{ color: "var(--ds-muted)", transform: planOpen ? "rotate(180deg)" : undefined, flex: "none" }} />
                </button>
                {progress && shownWorking ? (
                  <div className="shell-progress" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Task step progress">
                    <div style={{ width: `${progress.pct}%` }} />
                  </div>
                ) : null}
                {planOpen ? (
                  <StepTimeline steps={timelineSteps} verification={shownVerification} />
                ) : null}
                {planOpen ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {steps.map((st, i) => (
                      <EvidenceReceipt
                        key={st.id || i}
                        taskId={`Task ${shownTask.id.slice(0, 8)}`}
                        title={st.title}
                        duration={`step ${i + 1} of ${steps.length}`}
                        state={shownVerification}
                        checks={receiptChecks(st)}
                      />
                    ))}
                  </div>
                ) : null}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="shell-muted">
                    {shownStale ? "This task stopped sending heartbeats — shown as stale, never as running." : agentStatusText(shownCardState, shownWorking)}
                  </span>
                  <VerificationBadge state={shownVerification} />
                </div>
                {!shownWorking && blocks ? (
                  <div className="shell-blocks">
                    {blocks.summary ? <p>{blocks.summary}</p> : null}
                    {blocks.verification ? (<p>Verification: {blocks.verification}</p>) : null}
                    {blocks.error ? <p>Error: {blocks.error}</p> : null}
                    {blocks.outcome ? <p>{blocks.outcome}</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {pendingForTask.length > 0 ? pendingForTask.map((approval) => (
              <ApprovalCard
                key={approval.id}
                title="Tool access request"
                tool={approval.tool}
                scope={approval.target ?? approval.tool}
                blastRadius={[{
                  path: approval.target ?? approval.tool,
                  permission: inferPermission(approval.tool),
                  note: `${approval.tool} ${formatArgs(approval.args)}`,
                }]}
                onApprove={() => void handleDecide(approval.id, "approve")}
                onDeny={() => void handleDecide(approval.id, "deny")}
                onEditScope={() => flash("Open the task in the Activity panel to edit approval scope.")}
              />
            )) : null}
          </div>
        ) : null}

        <div ref={endPadRef} style={{ height: 24, flexShrink: 0 }} aria-hidden="true" />
      </div>

      <div className="shell-composer-zone">
        <form onSubmit={handleSend} className="shell-composer">
          <button type="button" className="shell-iconbtn" title="Attach file" aria-label="Attach file" onClick={() => fileRef.current?.click()}>
            <Paperclip size={18} aria-hidden="true" />
          </button>
          <input ref={fileRef} type="file" multiple hidden aria-hidden="true" tabIndex={-1}
            onChange={(e) => {
              const names = Array.from(e.target.files ?? []).map((f) => f.name);
              if (names.length) setAttached((a) => [...a, ...names].slice(0, 5));
              e.target.value = "";
            }} />
          <div ref={toolsMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              className="shell-tools-btn"
              title="Connected tools and capabilities"
              aria-expanded={toolsOpen}
              aria-haspopup="true"
            >
              <Cpu size={13} aria-hidden="true" />
              <span>Tools</span>
              <ChevronDown size={12} aria-hidden="true" style={{ opacity: .6 }} />
            </button>
            {toolsOpen ? (
              <div className="tools-menu" role="menu" aria-label="Connected tools">
                <p className="shell-card-title" style={{ padding: "4px 8px" }}>Connected tools · 5 active</p>
                {[
                  { name: "Web Research and Fetch", desc: "Live web search and page reading" },
                  { name: "Filesystem Gateway", desc: "Sandboxed file read and write" },
                  { name: "Terminal Execution", desc: "Monitored shell execution harness" },
                  { name: "Memory Consolidation", desc: "Cross-session recall" },
                  { name: "Data Virtualization", desc: "Guarded SQL queries" },
                ].map((t) => (
                  <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: "var(--ds-radius-md)" }}>
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ds-green-700)", flex: "none" }} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-ink)", margin: 0 }}>{t.name}</p>
                      <p className="shell-muted" style={{ fontSize: "var(--ds-text-12)" }}>{t.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <input
            type="text"
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder="Tell me what you want to do next..."
            aria-label="Message VOW"
          />
          <button type="button" className="shell-iconbtn" title={recording ? "Stop voice input" : "Voice input"} aria-label={recording ? "Stop voice input" : "Voice input"} aria-pressed={recording} onClick={toggleVoice}>
            {recording ? <Square size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
          </button>
          <AutonomyMenu value={uiMode} onChange={setUiMode} />
          <button type="submit" disabled={sending || !composerText.trim()} className="shell-send" title="Send" aria-label="Send message">
            <ArrowUp size={17} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </form>
        {attached.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingTop: 8 }}>
            {attached.map((name, i) => (
              <span key={`${name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: "var(--ds-radius-md)", padding: "6px 10px", fontSize: "var(--ds-text-13)", fontWeight: 500, background: "var(--ds-surface-2)", color: "var(--ds-ink)", minHeight: 44 }}>
                {name}
                <button type="button" aria-label={`Remove ${name}`} onClick={() => setAttached((a) => a.filter((_, j) => j !== i))} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 16 }}>×</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {toast ? (
        <p className="shell-toast" role="status">{toast}</p>
      ) : null}
    </div>
  );
}

function mapStepState(status: string): StepState {
  const tone = stepTone(status);
  if (tone === "done") return "completed";
  if (tone === "failed") return "failed";
  if (tone === "blocked") return "blocked";
  if (tone === "now") return status.toLowerCase() === "awaiting_approval" ? "waiting" : "running";
  return "queued";
}

function receiptChecks(step: { id: string; title: string; status: string }) {
  const tone = stepTone(step.status);
  const execState = tone === "done" ? "passed" as const : tone === "failed" ? "failed" as const : "pending" as const;
  return [
    { label: "Step recorded in plan", detail: step.id || step.title, state: "passed" as const },
    { label: `Execution — ${stepStatusText(step.status)}`, detail: step.id || step.title, state: execState },
  ];
}
