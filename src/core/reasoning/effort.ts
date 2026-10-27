export type EffortLevel = "Light" | "Medium" | "High" | "Max" | "PlusMax";

export const EFFORT_LEVELS: readonly EffortLevel[] = ["Light", "Medium", "High", "Max", "PlusMax"];
export const DEFAULT_CEILING: EffortLevel = "Medium";

export function parseEffortLevel(value: unknown): EffortLevel | null {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value) ? (value as EffortLevel) : null;
}

const RANK: Record<EffortLevel, number> = { Light: 0, Medium: 1, High: 2, Max: 3, PlusMax: 4 };
const MODEL_CALLS: Record<EffortLevel, number> = { Light: 1, Medium: 2, High: 4, Max: 8, PlusMax: 12 };
const TOOL_CALLS: Record<EffortLevel, number> = { Light: 2, Medium: 5, High: 10, Max: 20, PlusMax: 30 };

export interface EffortBudget { ceiling: EffortLevel; modelCallsUsed: number; toolCallsUsed: number; }

export function createBudget(ceiling: EffortLevel): EffortBudget { return { ceiling, modelCallsUsed: 0, toolCallsUsed: 0 }; }
export function maxModelCalls(b: EffortBudget): number { return MODEL_CALLS[b.ceiling]; }
export function maxToolCalls(b: EffortBudget): number { return TOOL_CALLS[b.ceiling]; }
export function effortAllowed(level: EffortLevel, ceiling: EffortLevel): boolean { return RANK[level] <= RANK[ceiling]; }
export function clampToCeiling(level: EffortLevel, ceiling: EffortLevel): EffortLevel { return effortAllowed(level, ceiling) ? level : ceiling; }
export function recordModelCall(b: EffortBudget): boolean { if (b.modelCallsUsed >= maxModelCalls(b)) return false; b.modelCallsUsed += 1; return true; }
export function recordToolCall(b: EffortBudget): boolean { if (b.toolCallsUsed >= maxToolCalls(b)) return false; b.toolCallsUsed += 1; return true; }
export function budgetExhausted(b: EffortBudget): boolean { return b.modelCallsUsed >= maxModelCalls(b) || b.toolCallsUsed >= maxToolCalls(b); }

/** Heuristic per-subtask effort: consequential or ambiguous work gets more; trivial reads get Light. */
export function suggestEffort(opts: { consequential?: boolean; ambiguous?: boolean; retries?: number }): EffortLevel {
  if (opts.consequential) return "High";
  if ((opts.retries ?? 0) >= 2 || opts.ambiguous) return "Medium";
  return "Light";
}
