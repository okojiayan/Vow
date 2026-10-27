import { createHash } from "node:crypto";
import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import { fingerprintAction } from "./approval-service";

/** Tools whose approved executions must wait out a mandatory delay. */
export const COOLING_TOOLS = new Set(["fs.delete"]);

export interface CoolingRecord {
  id: string;
  taskId: string;
  tool: string;
  argsFingerprint: string;
  reason: string;
  delayMs: number;
  earliestExec: string;
  status: "waiting" | "ready" | "consumed" | "cancelled";
  createdAt: string;
}

const STORE = () => dataPath("cooling.json");
export const DEFAULT_COOLING_MS = 10 * 60 * 1000;

export function coolingDelayFor(tool: string): number | null {
  if (COOLING_TOOLS.has(tool)) return DEFAULT_COOLING_MS;
  return null;
}

export async function startCooling(input: { taskId: string; tool: string; args: Record<string, unknown>; target?: string; reason: string; delayMs?: number; now?: number }): Promise<CoolingRecord> {
  const nowMs = input.now ?? Date.now();
  const rec: CoolingRecord = {
    id: createId("cool"),
    taskId: input.taskId,
    tool: input.tool,
    argsFingerprint: fingerprintAction(input.tool, input.args, input.target),
    reason: input.reason,
    delayMs: input.delayMs ?? DEFAULT_COOLING_MS,
    earliestExec: new Date(nowMs + (input.delayMs ?? DEFAULT_COOLING_MS)).toISOString(),
    status: "waiting",
    createdAt: new Date(nowMs).toISOString(),
  };
  await mutateJsonFile<CoolingRecord[]>(STORE(), [], (c) => [...c, rec]);
  return rec;
}

export type CoolingStatus = "none" | "waiting" | "ready";

export async function coolingStatus(taskId: string, tool: string, args: Record<string, unknown>, target?: string, now?: number): Promise<{ status: CoolingStatus; record?: CoolingRecord }> {
  const nowMs = now ?? Date.now();
  const all = await readJsonFile<CoolingRecord[]>(STORE(), []);
  const fp = fingerprintAction(tool, args, target);
  const rec = all.find((r) => r.taskId === taskId && r.tool === tool && r.argsFingerprint === fp && (r.status === "waiting" || r.status === "ready"));
  if (!rec) return { status: "none" };
  if (rec.status === "ready") return { status: "ready", record: rec };
  if (Date.parse(rec.earliestExec) <= nowMs) {
    return { status: "ready", record: rec };
  }
  return { status: "waiting", record: rec };
}

export async function markCoolingReady(id: string): Promise<void> {
  await mutateJsonFile<CoolingRecord[]>(STORE(), [], (c) => c.map((r) => (r.id === id && r.status === "waiting" ? { ...r, status: "ready" as const } : r)));
}

export async function consumeCooling(id: string): Promise<void> {
  await mutateJsonFile<CoolingRecord[]>(STORE(), [], (c) => c.map((r) => (r.id === id ? { ...r, status: "consumed" as const } : r)));
}

export async function cancelCooling(id: string): Promise<CoolingRecord | null> {
  let out: CoolingRecord | null = null;
  await mutateJsonFile<CoolingRecord[]>(STORE(), [], (c) =>
    c.map((r) => {
      if (r.id !== id) return r;
      if (r.status === "consumed") return r;
      out = { ...r, status: "cancelled" as const };
      return out;
    }),
  );
  return out;
}

export async function listCooling(taskId?: string): Promise<CoolingRecord[]> {
  const all = await readJsonFile<CoolingRecord[]>(STORE(), []);
  return taskId ? all.filter((r) => r.taskId === taskId) : all;
}

export function coolingFingerprint(tool: string, content: string): string {
  return createHash("sha256").update(`${tool}:${content}`).digest("hex").slice(0, 16);
}
