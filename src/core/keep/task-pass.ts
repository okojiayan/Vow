import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";

export type KeepMode = "manual" | "smart" | "turbo" | "warden";
export type OperatingModeCompat = "supervised" | "assisted" | "autonomous";

export function keepModeToOperatingMode(mode: KeepMode): OperatingModeCompat {
  switch (mode) {
    case "manual":
      return "supervised";
    case "smart":
      return "assisted";
    case "turbo":
    case "warden":
      return "autonomous";
    default:
      return "supervised";
  }
}

export interface TaskPass {
  task_id: string;
  mode: KeepMode;
  allowed_read_paths: string[];
  allowed_write_paths: string[];
  allowed_actions: string[];
  network: boolean;
  expires_at: string;
  max_files: number;
  created_at: string;
  revoked: boolean;
}

export interface ParkedItem {
  id: string;
  task_id: string;
  action: string;
  target?: string;
  consequence: string;
  status: "waiting" | "approved" | "denied";
  created_at: string;
  decided_at?: string;
}

const PASS_STORE = () => dataPath("keep-passes.json");
const PARKED_STORE = () => dataPath("keep-parked.json");
const KILL_STORE = () => dataPath("keep-kill.json");

type PassMap = Record<string, TaskPass>;

export function defaultMoneyActions(): string[] {
  return ["fs.list", "fs.read", "memory.search", "calc.evaluate", "run_sql"];
}

export async function createTaskPass(input: {
  task_id?: string;
  mode: KeepMode;
  grantPaths?: string[];
  allowed_actions?: string[];
  network?: boolean;
  ttlMs?: number;
  max_files?: number;
}): Promise<TaskPass> {
  const now = Date.now();
  const pass: TaskPass = {
    task_id: input.task_id ?? createId("task"),
    mode: input.mode,
    allowed_read_paths: input.grantPaths ?? ["demo/sandbox"],
    allowed_write_paths: [],
    allowed_actions: input.allowed_actions ?? defaultMoneyActions(),
    network: input.network ?? false,
    expires_at: new Date(now + (input.ttlMs ?? 30 * 60 * 1000)).toISOString(),
    max_files: input.max_files ?? 25,
    created_at: new Date(now).toISOString(),
    revoked: false,
  };
  await mutateJsonFile<PassMap>(PASS_STORE(), {}, (current) => ({ ...current, [pass.task_id]: pass }));
  return pass;
}

export async function getTaskPass(task_id: string): Promise<TaskPass | null> {
  const all = await readJsonFile<PassMap>(PASS_STORE(), {});
  return all[task_id] ?? null;
}

export async function revokeTaskPass(task_id: string): Promise<void> {
  await mutateJsonFile<PassMap>(PASS_STORE(), {}, (current) => {
    const existing = current[task_id];
    if (!existing) return current;
    return { ...current, [task_id]: { ...existing, revoked: true } };
  });
}

export function isPassExpired(pass: TaskPass, now = Date.now()): boolean {
  return Date.parse(pass.expires_at) <= now;
}

export async function parkAction(input: { task_id: string; action: string; target?: string; consequence: string }): Promise<ParkedItem> {
  const item: ParkedItem = {
    id: createId("park"),
    task_id: input.task_id,
    action: input.action,
    target: input.target,
    consequence: input.consequence,
    status: "waiting",
    created_at: new Date().toISOString(),
  };
  await mutateJsonFile<ParkedItem[]>(PARKED_STORE(), [], (current) => [...current, item]);
  return item;
}

export async function listParked(task_id?: string): Promise<ParkedItem[]> {
  const all = await readJsonFile<ParkedItem[]>(PARKED_STORE(), []);
  return task_id ? all.filter((i) => i.task_id === task_id) : all;
}

export async function decideParked(id: string, approve: boolean): Promise<ParkedItem | null> {
  let result: ParkedItem | null = null;
  await mutateJsonFile<ParkedItem[]>(PARKED_STORE(), [], (current) =>
    current.map((i) => {
      if (i.id !== id) return i;
      result = { ...i, status: approve ? "approved" : "denied", decided_at: new Date().toISOString() };
      return result;
    }),
  );
  return result;
}

export async function killTask(task_id: string): Promise<void> {
  await revokeTaskPass(task_id);
  await mutateJsonFile<Record<string, string>>(KILL_STORE(), {}, (current) => ({ ...current, [task_id]: new Date().toISOString() }));
}

export async function isKilled(task_id: string): Promise<boolean> {
  const all = await readJsonFile<Record<string, string>>(KILL_STORE(), {});
  return Boolean(all[task_id]);
}

export function blastRadius(pass: TaskPass, totalFiles: number): { allowed: number; total: number; pct: number } {
  if (pass.mode === "turbo") return { allowed: totalFiles, total: totalFiles, pct: 100 };
  const allowed = Math.min(pass.allowed_read_paths.length, totalFiles);
  const pct = totalFiles === 0 ? 0 : Math.round((allowed / totalFiles) * 100);
  return { allowed, total: totalFiles, pct };
}
