// Trust Budget — bounded, diminishing allowance for eligible away-mode actions.
// Consumption is recorded from actual authorized execution records only.
// Hard denials, cooling, mandatory approvals, and denied policy checks are never bypassed.
import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import { recordAudit } from "@/core/warden/audit";

export interface TrustBudget {
  id: string;
  scope: string;
  maxUnits: number;
  remaining: number;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

// Eligible low-risk categories only. Money movement, deletion, network exfil,
// shell, and anything under mandatory approval/cooling is never eligible.
const ELIGIBLE = new Set(["fs.write", "notes.create", "memory.store", "fs.read", "fs.list", "memory.search", "calc.evaluate"]);

export function budgetEligible(tool: string): boolean {
  return ELIGIBLE.has(tool);
}

const STORE = () => dataPath("trust-budgets.json");

export async function createBudget(input: { scope?: string; maxUnits: number; ttlMs?: number }): Promise<TrustBudget> {
  if (!Number.isFinite(input.maxUnits) || input.maxUnits <= 0 || input.maxUnits > 1000) {
    throw new Error("maxUnits must be a positive number (<=1000).");
  }
  const b: TrustBudget = {
    id: createId("bud"),
    scope: (input.scope ?? "away").slice(0, 60),
    maxUnits: Math.floor(input.maxUnits),
    remaining: Math.floor(input.maxUnits),
    expiresAt: new Date(Date.now() + (input.ttlMs ?? 24 * 3600 * 1000)).toISOString(),
    revoked: false,
    createdAt: new Date().toISOString(),
  };
  await mutateJsonFile<TrustBudget[]>(STORE(), [], (cur) => [...cur, b]);
  return b;
}

export async function getBudget(id: string): Promise<TrustBudget | null> {
  const all = await readJsonFile<TrustBudget[]>(STORE(), []);
  return all.find((b) => b.id === id) ?? null;
}

export async function listBudgets(): Promise<TrustBudget[]> {
  return readJsonFile<TrustBudget[]>(STORE(), []);
}

export async function revokeBudget(id: string): Promise<void> {
  await mutateJsonFile<TrustBudget[]>(STORE(), [], (cur) => cur.map((b) => (b.id === id ? { ...b, revoked: true } : b)));
}

/** Atomically consume one unit. Fails closed on missing/expired/exhausted/revoked state. */
export async function tryConsumeBudget(input: {
  budgetId: string;
  tool: string;
  taskId: string;
  units?: number;
}): Promise<{ ok: boolean; reason: string; remaining?: number }> {
  if (!budgetEligible(input.tool)) {
    return { ok: false, reason: `Tool "${input.tool}" is not budget-eligible; mandatory policy still applies.` };
  }
  const units = input.units ?? 1;
  let result: { ok: boolean; reason: string; remaining?: number } = { ok: false, reason: "Budget unavailable." };
  await mutateJsonFile<TrustBudget[]>(STORE(), [], (cur) => {
    const idx = cur.findIndex((b) => b.id === input.budgetId);
    if (idx < 0) {
      result = { ok: false, reason: "Unknown budget; fail closed." };
      return cur;
    }
    const b = cur[idx];
    if (b.revoked) {
      result = { ok: false, reason: "Budget revoked; fail closed." };
      return cur;
    }
    if (Date.parse(b.expiresAt) <= Date.now()) {
      result = { ok: false, reason: "Budget expired; fail closed." };
      return cur;
    }
    if (b.remaining < units) {
      result = { ok: false, reason: "Budget exhausted; fail closed." };
      return cur;
    }
    const next = { ...b, remaining: b.remaining - units };
    const copy = [...cur];
    copy[idx] = next;
    result = { ok: true, reason: `Consumed ${units} unit(s) for ${input.tool}.`, remaining: next.remaining };
    return copy;
  });
  await recordAudit({
    kind: "execution",
    taskId: input.taskId,
    tool: input.tool,
    decision: result.ok ? "allow" : "deny",
    policy: "trust-budget.consume",
    reason: result.reason,
    outcome: result.ok ? "success" : "blocked",
    fingerprint: input.budgetId,
  });
  return result;
}
