"use client";

// Companion shared state: face geometry measured from the supplied renders,
// mic activity store, user-input clock, cursor/perk tracking, agent snapshot
// polling (real backend data only), and the single shared rAF loop.

export type CompanionVariant = "normal" | "warden";
export type CompanionAgentState = "idle" | "listening" | "running" | "waiting" | "verified" | "blocked";

export interface FaceGeometry {
  eyeL: { x: number; y: number; w: number; h: number };
  eyeR: { x: number; y: number; w: number; h: number };
  smile: { x: number; y: number; w: number };
  antennaOrigin: { x: number; y: number };
  aspect: number; // width / height of the body art
}

/** Measured from public/mascot/*-cut.png (fractions of image size). */
export const FACE: Record<CompanionVariant, FaceGeometry> = {
  normal: {
    eyeL: { x: 0.422, y: 0.506, w: 0.073, h: 0.14 },
    eyeR: { x: 0.699, y: 0.456, w: 0.073, h: 0.134 },
    smile: { x: 0.576, y: 0.542, w: 0.105 },
    antennaOrigin: { x: 0.44, y: 0.24 },
    aspect: 1,
  },
  warden: {
    eyeL: { x: 0.422, y: 0.484, w: 0.061, h: 0.123 },
    eyeR: { x: 0.649, y: 0.451, w: 0.058, h: 0.117 },
    smile: { x: 0.546, y: 0.526, w: 0.082 },
    antennaOrigin: { x: 0.43, y: 0.22 },
    aspect: 1310 / 1200,
  },
};

export const BODY_SRC: Record<CompanionVariant, string> = {
  normal: "/mascot/normal-cut.png",
  warden: "/mascot/warden-cut.png",
};

// ---------- mic activity (set by the composer voice control) ----------
let micActive = false;
const micListeners = new Set<() => void>();
export function setMicActive(v: boolean) {
  if (micActive === v) return;
  micActive = v;
  micListeners.forEach((fn) => fn());
}
export function subscribeMic(fn: () => void): () => void {
  micListeners.add(fn);
  return () => { micListeners.delete(fn); };
}

// ---------- user input clock (sleepy after 60s without input) ----------
let lastInput = 0;
let inputInstalled = false;
export function noteInput() { lastInput = performance.now(); }
export function lastInputAt() { return lastInput; }
function installInputClock() {
  if (inputInstalled || typeof window === "undefined") return;
  inputInstalled = true;
  lastInput = performance.now();
  const bump = () => { lastInput = performance.now(); };
  addEventListener("pointermove", bump, { passive: true });
  addEventListener("pointerdown", bump, { passive: true });
  addEventListener("keydown", bump);
}

// ---------- cursor + composer-perk tracking (module level, one listener) ----------
let mouse: { x: number; y: number } | null = null;
let perkUntil = 0;
let trackInstalled = false;
function installTracking() {
  if (trackInstalled || typeof window === "undefined") return;
  trackInstalled = true;
  installInputClock();
  addEventListener("pointermove", (e) => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) {
      perkUntil = performance.now() + 4000;
    }
  });
}
export function cursorNow() { installTracking(); return mouse; }
export function perkedNow() { installTracking(); return performance.now() < perkUntil; }

// ---------- phrases (<=40 chars, sidebar-safe) ----------
export const POKE_PHRASES = ["Hi. I am VOW.", "Hey you.", "Boop.", "Ready when you are."];
export const POKE_MANY = "Okay, okay. I feel it.";
export const POKE_TOO_MANY = "That is a lot of pokes.";

// ---------- single shared rAF loop ----------
export interface LoopTick { (t: number, dt: number): void; }
interface Subscriber { tick: LoopTick; visible: () => boolean; }
const subscribers = new Set<Subscriber>();
let loopRunning = false;
let statFrames = 0;
let statMs = 0;
let statSince = 0;

function loopStep(t: number) {
  if (subscribers.size === 0 || document.hidden) { loopRunning = false; return; }
  const dt = Math.min(0.05, (t - (loopStep as { last?: number }).last! || 16.7) / 1000 || 0.016);
  (loopStep as { last?: number }).last = t;
  const t0 = performance.now();
  subscribers.forEach((s) => { try { if (s.visible()) s.tick(t, dt); } catch { /* decorative */ } });
  const cost = performance.now() - t0;
  statFrames += 1; statMs += cost;
  if (!statSince) statSince = t0;
  requestAnimationFrame(loopStep);
}

/** Subscribe a live companion tick. The loop is shared: one rAF total. */
export function subscribeLoop(tick: LoopTick, visible: () => boolean): () => void {
  const s = { tick, visible };
  subscribers.add(s);
  if (!loopRunning && typeof window !== "undefined") {
    loopRunning = true;
    (loopStep as { last?: number }).last = 0;
    requestAnimationFrame(loopStep);
  }
  return () => { subscribers.delete(s); };
}

export function liveCompanionCount() { return subscribers.size; }

/** {fps, avgTickMs, windowSec} measured over the current window (for reporting). */
export function getCompanionStats() {
  const now = performance.now();
  const win = statSince ? (now - statSince) / 1000 : 0;
  const out = { fps: win > 0 ? statFrames / win : 0, avgTickMs: statFrames ? statMs / statFrames : 0, subscribers: subscribers.size, windowSec: win };
  statFrames = 0; statMs = 0; statSince = now;
  return out;
}
if (typeof window !== "undefined") {
  (window as unknown as { __companionStats?: () => unknown }).__companionStats = getCompanionStats;
}

// ---------- agent snapshot from real backend data only ----------
import { useEffect, useState } from "react";
import { isActiveTaskStatus, isStaleActiveTask, STALE_ACTIVE_AFTER_MS, freshestTaskTimestamp } from "@/lib/task-display";

export interface CompanionAgent {
  state: CompanionAgentState;
  lookAtActivity: boolean;
}

interface AgentTask {
  id: string;
  conversationId?: string;
  queuedAt?: string | null;
  updatedAt?: string | null;
  lastHeartbeat?: string | null;
  status: string;
  verification?: { passed: boolean | null } | null;
  outcome?: { outcome: string; reason: string } | null;
}
interface AgentApproval { id: string; taskId: string; tool: string; status: string; }

function recent(x: AgentTask): boolean {
  try {
    const ts = freshestTaskTimestamp({ queuedAt: x.queuedAt ?? null, updatedAt: x.updatedAt ?? null, lastHeartbeat: x.lastHeartbeat ?? null });
    if (ts === null) return false;
    return Date.now() - ts <= STALE_ACTIVE_AFTER_MS;
  } catch { return false; }
}

function stale(x: AgentTask): boolean {
  try {
    return isStaleActiveTask({
      status: x.status, queuedAt: x.queuedAt ?? null,
      updatedAt: x.updatedAt ?? null, lastHeartbeat: x.lastHeartbeat ?? null,
    } as never);
  } catch { return false; }
}

/**
 * Derives the companion pose from live backend state. No demo, no fake
 * activity: without data every branch falls through to idle.
 * listening = mic active; running = fresh executing task; waiting = pending
 * approval on a live task; verified = latest recent finished task verified
 * with a receipt; blocked = recent task blocked/failed or approval denied
 * on a recent task. Old history never holds the face.
 */
export function useCompanionAgent(conversationId?: string | null, active = true): CompanionAgent {
  const [agent, setAgent] = useState<CompanionAgent>({ state: "idle", lookAtActivity: false });
  useEffect(() => {
    let alive = true;
    if (!active) return () => { alive = false; };
    const unsub = subscribeMic(() => {
      if (!alive) return;
      setAgent((a) => ({ ...a, state: micActive ? "listening" : "idle" }));
    });
    const poll = async () => {
      try {
        const [taskRes, apprRes] = await Promise.all([
          fetch("/api/agent").then((r) => r.json()).catch(() => ({})),
          fetch("/api/approvals").then((r) => r.json()).catch(() => ({})),
        ]);
        if (!alive) return;
        if (micActive) { setAgent((a) => ({ ...a, state: "listening", lookAtActivity: false })); return; }
        const tasks = ((taskRes.tasks ?? []) as AgentTask[])
          .filter((t) => !conversationId || t.conversationId === conversationId);
        const approvals = ((apprRes.approvals ?? []) as AgentApproval[]);
        const pending = approvals.filter((a) => a.status === "pending");
        const livePending = pending.filter((a) =>
          tasks.some((t) => t.id === a.taskId && isActiveTaskStatus(t.status)));
        const denied = approvals.some((a) => a.status === "denied" && tasks.some((t) => t.id === a.taskId && recent(t)));
        const executing = tasks.find((t) => t.status === "executing" && !stale(t));
        const finished = tasks
          .filter((t) => !isActiveTaskStatus(t.status) && recent(t))
          .sort((a, b) => String(b.updatedAt ?? b.queuedAt ?? "").localeCompare(String(a.updatedAt ?? a.queuedAt ?? "")))[0];
        const latestBlocked = finished && (finished.status === "blocked" || finished.status === "failed");
        if (livePending.length > 0) setAgent({ state: "waiting", lookAtActivity: true });
        else if (executing) setAgent({ state: "running", lookAtActivity: false });
        else if (latestBlocked || denied) setAgent({ state: "blocked", lookAtActivity: false });
        else if (finished?.verification?.passed === true) setAgent({ state: "verified", lookAtActivity: false });
        else setAgent({ state: "idle", lookAtActivity: false });
      } catch { if (alive) setAgent({ state: "idle", lookAtActivity: false }); }
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); unsub(); };
  }, [conversationId, active]);
  return agent;
}
