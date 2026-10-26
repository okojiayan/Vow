import { createHash } from "node:crypto";
import { createId } from "@/lib/ids";
import { mutateJsonFile, dataPath, readJsonFile } from "@/lib/persistence";
import type { ApprovalGrant } from "./types";

const STORE = () => dataPath("approvals.json");
const TTL_MS = 15 * 60 * 1000;

export function canonicalAction(tool: string, args: Record<string, unknown>, target?: string): string {
  const sortedArgs = Object.keys(args)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = args[key];
      return acc;
    }, {});
  return JSON.stringify({ tool, args: sortedArgs, target: target ?? null });
}

export function fingerprintAction(tool: string, args: Record<string, unknown>, target?: string): string {
  return createHash("sha256").update(canonicalAction(tool, args, target)).digest("hex");
}

export async function listApprovals(): Promise<ApprovalGrant[]> {
  return readJsonFile<ApprovalGrant[]>(STORE(), []);
}

export async function createApproval(input: {
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  target?: string;
}): Promise<ApprovalGrant> {
  const grant: ApprovalGrant = {
    id: createId("appr"),
    taskId: input.taskId,
    tool: input.tool,
    args: input.args,
    target: input.target,
    actionFingerprint: fingerprintAction(input.tool, input.args, input.target),
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
  };
  await mutateJsonFile<ApprovalGrant[]>(STORE(), [], (current) => [...current, grant]);
  return grant;
}

export async function decideApproval(
  approvalId: string,
  decision: "approve" | "deny",
  note?: string,
): Promise<ApprovalGrant> {
  let updated: ApprovalGrant | undefined;
  await mutateJsonFile<ApprovalGrant[]>(STORE(), [], (current) =>
    current.map((item) => {
      if (item.id !== approvalId) return item;
      if (item.status === "cancelled") {
        throw new Error(`Approval ${approvalId} was cancelled with its task and cannot be decided.`);
      }
      if (item.status !== "pending") {
        throw new Error(`Approval ${approvalId} is ${item.status} and cannot be decided again.`);
      }
      if (Date.parse(item.expiresAt) <= Date.now()) {
        updated = { ...item, status: "expired", decidedAt: new Date().toISOString(), note };
        return updated;
      }
      updated = {
        ...item,
        status: decision === "approve" ? "approved" : "denied",
        decidedAt: new Date().toISOString(),
        note,
      };
      return updated;
    }),
  );
  if (!updated) throw new Error(`Unknown approval ${approvalId}`);
  if (updated.status === "expired") throw new Error("Approval expired before it could be used.");
  return updated;
}

/**
 * Void every live approval for a task (pending or approved-but-unconsumed).
 * Called when a task is cancelled; returns the number voided. Terminal
 * states (denied, consumed, expired) are left untouched. Idempotent.
 */
export async function cancelApprovalsForTask(taskId: string, reason = "Task cancelled"): Promise<number> {
  let count = 0;
  const now = new Date().toISOString();
  await mutateJsonFile<ApprovalGrant[]>(STORE(), [], (current) =>
    current.map((item) => {
      if (item.taskId !== taskId) return item;
      if (item.status !== "pending" && item.status !== "approved") return item;
      count += 1;
      return { ...item, status: "cancelled" as const, decidedAt: now, note: reason };
    }),
  );
  return count;
}

export async function consumeMatchingApproval(input: {
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  taskId?: string;
}): Promise<ApprovalGrant | null> {
  const fingerprint = fingerprintAction(input.tool, input.args, input.target);
  let matched: ApprovalGrant | null = null;
  await mutateJsonFile<ApprovalGrant[]>(STORE(), [], (current) =>
    current.map((item) => {
      if (matched) return item;
      if (item.status !== "approved") return item;
      if (input.taskId && item.taskId !== input.taskId) return item;
      if (item.actionFingerprint !== fingerprint) return item;
      if (Date.parse(item.expiresAt) <= Date.now()) {
        return { ...item, status: "expired" as const };
      }
      matched = {
        ...item,
        status: "consumed",
        consumedAt: new Date().toISOString(),
      };
      return matched;
    }),
  );
  return matched;
}

export async function findUsableApproval(input: {
  tool: string;
  args: Record<string, unknown>;
  target?: string;
  taskId?: string;
}): Promise<ApprovalGrant | null> {
  const fingerprint = fingerprintAction(input.tool, input.args, input.target);
  const all = await listApprovals();
  return (
    all.find(
      (item) =>
        item.actionFingerprint === fingerprint &&
        item.status === "approved" &&
        (!input.taskId || item.taskId === input.taskId) &&
        Date.parse(item.expiresAt) > Date.now(),
    ) ?? null
  );
}

export async function expireStaleApprovals(): Promise<void> {
  await mutateJsonFile<ApprovalGrant[]>(STORE(), [], (current) =>
    current.map((item) => {
      if (item.status === "pending" && Date.parse(item.expiresAt) <= Date.now()) {
        return { ...item, status: "expired" as const };
      }
      return item;
    }),
  );
}
