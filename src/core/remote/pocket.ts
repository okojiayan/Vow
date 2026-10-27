// Pocket Approval — safe local foundation for phone-based parked-action decisions.
// No remote transport exists in this repo (no push, no public phone channel).
// This module implements the secure local primitives: short-lived single-use
// task-bound tokens, exact plan/action binding, atomic consume, and revalidation.
// Remote delivery remains BLOCKED BY INFRASTRUCTURE (see docs/phase3-advanced.md).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import { getTaskPass, isPassExpired, isKilled, listParked, decideParked } from "@/core/keep/task-pass";
import { recordAudit } from "@/core/warden/audit";
import { evaluatePolicy } from "@/core/warden/policy";
import { createId } from "@/lib/ids";

export interface PocketToken {
  id: string;
  tokenHash: string;
  parkedId: string;
  taskId: string;
  action: string;
  target?: string;
  planVersion: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
  decision?: "approved" | "denied";
  decidedBy?: string;
}

const TOKENS = () => dataPath("pocket-tokens.json");
export const POCKET_TTL_MS = 10 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** Issue a single-use token bound to one waiting parked item + plan version. */
export async function issuePocketToken(input: {
  parkedId: string;
  planVersion: string;
  ttlMs?: number;
}): Promise<{ raw: string; record: PocketToken }> {
  const parked = (await listParked()).find((p) => p.id === input.parkedId);
  if (!parked) throw new Error("Unknown parked action.");
  if (parked.status !== "waiting") throw new Error(`Parked action is ${parked.status}; only waiting items can be approved remotely.`);
  const pass = await getTaskPass(parked.task_id);
  if (!pass) throw new Error("No Task Pass for this parked action; fail closed.");
  if (await isKilled(parked.task_id)) throw new Error("Kill switch active; fail closed.");
  if (isPassExpired(pass)) throw new Error("Task Pass expired; fail closed.");
  const raw = `pkt_${randomBytes(24).toString("hex")}`;
  const now = Date.now();
  const record: PocketToken = {
    id: createId("pkt"),
    tokenHash: hashToken(raw),
    parkedId: parked.id,
    taskId: parked.task_id,
    action: parked.action,
    target: parked.target,
    planVersion: input.planVersion,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? POCKET_TTL_MS)).toISOString(),
    used: false,
  };
  await mutateJsonFile<PocketToken[]>(TOKENS(), [], (cur) => [...cur, record]);
  await recordAudit({
    kind: "approval",
    taskId: parked.task_id,
    tool: parked.action,
    decision: "require_approval",
    policy: "pocket.token-issued",
    reason: `Pocket token issued for parked ${parked.id} (plan ${input.planVersion}). Single-use, short-lived; remote transport unavailable.`,
    outcome: "pending",
    fingerprint: record.id,
  });
  return { raw, record };
}

export interface PocketDecision {
  ok: boolean;
  reason: string;
  parkedId?: string;
  decision?: "approved" | "denied";
}

/** Consume a token exactly once. Revalidates kill switch, pass, and policy. */
export async function consumePocketToken(input: {
  raw: string;
  decision: "approve" | "deny";
  planVersion: string;
  approver: string;
}): Promise<PocketDecision> {
  const presentedHash = hashToken(input.raw);
  let outcome: PocketDecision = { ok: false, reason: "Invalid or expired pocket token." };
  await mutateJsonFile<PocketToken[]>(TOKENS(), [], (cur) => {
    const idx = cur.findIndex((t) => safeEqual(t.tokenHash, presentedHash));
    if (idx < 0) {
      outcome = { ok: false, reason: "Invalid pocket token." };
      return cur;
    }
    const tok = cur[idx];
    if (tok.used) {
      outcome = { ok: false, reason: "Token already used; replay rejected." };
      return cur;
    }
    if (Date.parse(tok.expiresAt) <= Date.now()) {
      outcome = { ok: false, reason: "Token expired; fail closed." };
      return cur;
    }
    if (tok.planVersion !== input.planVersion) {
      outcome = { ok: false, reason: "Plan version mismatch; approval binds to the exact approved plan." };
      return cur;
    }
    const next: PocketToken = {
      ...tok,
      used: true,
      usedAt: new Date().toISOString(),
      decision: input.decision === "approve" ? "approved" : "denied",
      decidedBy: input.approver.slice(0, 120),
    };
    const copy = [...cur];
    copy[idx] = next;
    outcome = { ok: true, reason: "Token accepted; pending revalidation.", parkedId: tok.parkedId, decision: next.decision };
    return copy;
  });
  if (!outcome.ok || !outcome.parkedId) return outcome;
  // Revalidate against live state before touching the parked item.
  const parked = (await listParked()).find((p) => p.id === outcome.parkedId);
  if (!parked) return { ok: false, reason: "Parked action no longer exists; fail closed." };
  // Token is already bound to parkedId + planVersion; re-check the live
  // parked action matches the token's bound action to prevent cross-action use.
  const bound = await readToken(outcome.parkedId);
  if (bound && bound.action !== parked.action) return { ok: false, reason: "Token action mismatch; fail closed." };
  if (parked.status !== "waiting") return { ok: false, reason: `Parked action is ${parked.status}; concurrent decision already applied.` };
  if (await isKilled(parked.task_id)) return { ok: false, reason: "Kill switch active; phone approval cannot override." };
  const pass = await getTaskPass(parked.task_id);
  if (!pass || isPassExpired(pass)) return { ok: false, reason: "Task Pass expired or revoked; fail closed." };
  // Hard denials for Warden-known tools can never be overridden by pocket
  // approval. Keep-level money actions (money.*) are intentionally outside the
  // Warden tool allowlist — they are parked by the Keep gate, so the
  // default-deny.unknown-tool verdict must not block their explicit decision.
  const { getToolPermission } = await import("@/core/warden/policy");
  if (getToolPermission(parked.action)) {
    const policy = evaluatePolicy({ requestId: `pocket-${Date.now()}`, tool: parked.action, args: {}, target: parked.target, mode: "autonomous", hasMatchingApproval: false });
    if (policy.effect === "deny") return { ok: false, reason: `Hard denial stands (${policy.policy}); pocket approval cannot override.` };
  }
  const decided = await decideParked(parked.id, outcome.decision !== "denied");
  if (!decided || decided.status === "waiting") return { ok: false, reason: "Parked decision race lost; fail closed." };
  await recordAudit({
    kind: "approval",
    taskId: parked.task_id,
    tool: parked.action,
    decision: decided.status,
    policy: "pocket.decision",
    reason: `Pocket ${decided.status} by ${input.approver.slice(0, 80)} for exact action ${parked.action} (plan ${input.planVersion}).`,
    outcome: decided.status === "approved" ? "pending" : "blocked",
    fingerprint: parked.id,
  });
  return { ok: true, reason: `Parked action ${decided.status}.`, parkedId: parked.id, decision: decided.status };
}

async function readToken(parkedId: string): Promise<PocketToken | null> {
  const all = await readJsonFile<PocketToken[]>(TOKENS(), []);
  return all.find((t) => t.parkedId === parkedId) ?? null;
}

export async function listPocketTokens(): Promise<Omit<PocketToken, "tokenHash">[]> {
  const all = await readJsonFile<PocketToken[]>(TOKENS(), []);
  return all.map(({ tokenHash: _unused, ...rest }) => {
    void _unused;
    return rest;
  });
}
