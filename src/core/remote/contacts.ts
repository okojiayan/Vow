// Trusted Contact — opt-in, per-purpose, narrow, revocable, expiring.
// No delivery infrastructure exists in this repo (no SMS/push/email service).
// This module implements consent + scope + data-minimized local report preview.
// Delivery remains DOCUMENTED ONLY (local preview, explicitly labelled).
import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import { recordAudit } from "@/core/warden/audit";
import { redactArgs } from "@/core/execution/reversals";
import { getTask } from "@/core/agent/task-store";
import { listParked } from "@/core/keep/task-pass";

export type ContactPurpose = "view_report" | "approve_delegated";

export interface TrustedContact {
  id: string;
  label: string;
  purposes: ContactPurpose[];
  // Narrow delegated scope: exact action names the contact may approve, e.g. ["money.cancel"].
  delegatedActions: string[];
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

const STORE = () => dataPath("trusted-contacts.json");

export async function addContact(input: {
  label: string;
  purposes: ContactPurpose[];
  delegatedActions?: string[];
  ttlMs?: number;
}): Promise<TrustedContact> {
  const label = input.label.trim().slice(0, 80);
  if (!label) throw new Error("Contact label is required.");
  const purposes = [...new Set(input.purposes)];
  if (purposes.length === 0) throw new Error("At least one purpose (view_report and/or approve_delegated) is required.");
  for (const p of purposes) {
    if (p !== "view_report" && p !== "approve_delegated") throw new Error(`Unsupported purpose "${p}".`);
  }
  const c: TrustedContact = {
    id: createId("tc"),
    label,
    purposes,
    delegatedActions: (input.delegatedActions ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 20),
    expiresAt: new Date(Date.now() + (input.ttlMs ?? 7 * 24 * 3600 * 1000)).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  await mutateJsonFile<TrustedContact[]>(STORE(), [], (cur) => [...cur, c]);
  await recordAudit({
    kind: "policy",
    taskId: "contacts",
    tool: "trusted-contact.add",
    decision: "allow",
    policy: "contacts.opt-in",
    reason: `Trusted contact "${label}" added for ${purposes.join(", ")}.`,
    outcome: "success",
    fingerprint: c.id,
  });
  return c;
}

export async function listContacts(): Promise<TrustedContact[]> {
  return readJsonFile<TrustedContact[]>(STORE(), []);
}

export async function revokeContact(id: string): Promise<TrustedContact | null> {
  let out: TrustedContact | null = null;
  await mutateJsonFile<TrustedContact[]>(STORE(), [], (cur) =>
    cur.map((c) => {
      if (c.id !== id) return c;
      out = { ...c, revoked: true };
      return out;
    }),
  );
  return out;
}

export function contactUsable(c: TrustedContact | undefined, purpose: ContactPurpose, now = Date.now()): c is TrustedContact {
  if (!c || c.revoked) return false;
  if (Date.parse(c.expiresAt) <= now) return false;
  return c.purposes.includes(purpose);
}

/** Data-minimized away report: counts + redacted summaries only. No history, memories, or credentials. */
export async function buildAwayReport(taskId: string, contactId: string): Promise<Record<string, unknown>> {
  const contact = (await listContacts()).find((c) => c.id === contactId);
  if (!contactUsable(contact, "view_report")) throw new Error("Contact is not authorized for away reports (missing consent, revoked, or expired).");
  const task = await getTask(taskId);
  if (!task) throw new Error("Unknown task.");
  const parked = await listParked(taskId);
  const redacted = redactArgs({ request: task.request });
  return {
    simulated_delivery: true,
    note: "Local preview only — no delivery infrastructure is configured, so nothing was sent.",
    recipient: contact.label,
    task: { id: task.id, status: task.status, request: redacted.request },
    parked: parked.map((p) => ({ id: p.id, action: p.action, status: p.status, created_at: p.created_at })),
    generatedAt: new Date().toISOString(),
  };
}

/** Check whether a contact may approve a specific parked action. Never bypasses Warden/Plan Lock/kill. */
export async function canContactApprove(contactId: string, parkedId: string): Promise<{ ok: boolean; reason: string }> {
  const contact = (await listContacts()).find((c) => c.id === contactId);
  if (!contactUsable(contact, "approve_delegated")) {
    return { ok: false, reason: "Contact lacks approve_delegated consent or authorization is stale/revoked/expired." };
  }
  const item = (await listParked()).find((p) => p.id === parkedId);
  if (!item) return { ok: false, reason: "Unknown parked action." };
  if (!contact.delegatedActions.includes(item.action)) {
    return { ok: false, reason: `Action "${item.action}" is outside this contact's delegated scope.` };
  }
  return { ok: true, reason: "Contact scope permits this exact action; Warden/Plan Lock/kill switch still apply at consume time." };
}
