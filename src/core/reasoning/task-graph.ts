import { createId } from "@/lib/ids";
import type { AgentTask, PlanStep } from "@/core/agent/types";

export type SubgoalStatus = "pending" | "ready" | "running" | "succeeded" | "failed" | "blocked" | "skipped";
export type GoalStatus = "open" | "completed" | "blocked" | "failed" | "partial" | "unverified";

export interface AcceptanceCondition {
  id: string;
  statement: string;
  satisfied: boolean | null;
  evidenceIds: string[];
}

export interface Subgoal {
  id: string;
  title: string;
  instruction: string;
  /** "tool" steps execute via Warden-gated tools; "analysis" steps are completed
   *  by provider-backed model analysis of prior tool evidence. */
  kind: "tool" | "analysis";
  dependsOn: string[];
  status: SubgoalStatus;
  effort: import("./effort").EffortLevel;
  attempts: number;
  evidenceIds: string[];
  stepId?: string;
}

export interface EvidenceRef { id: string; kind: string; ref: string; note?: string; createdAt: string; }
export interface Assumption { id: string; statement: string; validated: boolean | null; }
export interface Blocker { id: string; reason: string; subgoalId?: string; resolved: boolean; createdAt: string; }

export interface TaskStateGraph {
  taskId: string;
  goal: string;
  acceptance: AcceptanceCondition[];
  subgoals: Subgoal[];
  evidence: EvidenceRef[];
  assumptions: Assumption[];
  blockers: Blocker[];
  status: GoalStatus;
  executionState: string;
  checkpoints: { id: string; at: string; label: string }[];
  updatedAt: string;
}

export function buildGraphFromTask(task: AgentTask, acceptance: string[] = []): TaskStateGraph {
  const steps: PlanStep[] = task.plan?.steps ?? [];
  const subgoals: Subgoal[] = steps.map((s, i) => ({
    id: s.id || `sg-${i}`,
    title: s.title,
    instruction: s.instruction,
    kind: s.analysis === true ? "analysis" : "tool",
    dependsOn: i === 0 ? [] : [steps[i - 1].id || `sg-${i - 1}`],
    status: s.status === "verified" ? "succeeded" : s.status === "failed" || s.status === "blocked" ? s.status : s.status === "running" ? "running" : "pending",
    effort: "Light",
    attempts: 0,
    evidenceIds: [],
    stepId: s.id,
  }));
  return {
    taskId: task.id,
    goal: task.request,
    acceptance: acceptance.length > 0 ? acceptance.map((a) => ({ id: createId("acc"), statement: a, satisfied: null, evidenceIds: [] })) : [{ id: createId("acc"), statement: task.request, satisfied: null, evidenceIds: [] }],
    subgoals,
    evidence: [],
    assumptions: [],
    blockers: [],
    status: "open",
    executionState: task.status,
    checkpoints: [],
    updatedAt: new Date().toISOString(),
  };
}

export function readySubgoals(g: TaskStateGraph): Subgoal[] {
  const done = new Set(g.subgoals.filter((s) => s.status === "succeeded" || s.status === "skipped").map((s) => s.id));
  return g.subgoals.filter((s) => (s.status === "pending" || s.status === "failed") && s.dependsOn.every((d) => done.has(d)));
}

export function markSubgoal(g: TaskStateGraph, id: string, status: SubgoalStatus, evidenceId?: string): TaskStateGraph {
  const next: TaskStateGraph = { ...g, subgoals: g.subgoals.map((s) => (s.id === id ? { ...s, status, evidenceIds: evidenceId ? [...s.evidenceIds, evidenceId] : s.evidenceIds, attempts: status === "running" ? s.attempts + 1 : s.attempts } : s)), updatedAt: new Date().toISOString() };
  return next;
}

export function addEvidence(g: TaskStateGraph, kind: string, ref: string, note?: string): { graph: TaskStateGraph; id: string } {
  const id = createId("ev");
  const ev: EvidenceRef = { id, kind, ref, note, createdAt: new Date().toISOString() };
  return { graph: { ...g, evidence: [...g.evidence, ev], updatedAt: new Date().toISOString() }, id };
}

export function checkpoint(g: TaskStateGraph, label: string): TaskStateGraph {
  return { ...g, checkpoints: [...g.checkpoints, { id: createId("ckpt"), at: new Date().toISOString(), label }], updatedAt: new Date().toISOString() };
}

export function serializeCheckpoint(g: TaskStateGraph): string { return JSON.stringify(g); }
export function restoreCheckpoint(json: string): TaskStateGraph {
  const g = JSON.parse(json) as TaskStateGraph;
  if (!g.taskId || !Array.isArray(g.subgoals) || !Array.isArray(g.acceptance)) throw new Error("Invalid checkpoint");
  return g;
}

export function acceptanceSatisfied(g: TaskStateGraph): boolean {
  return g.acceptance.length > 0 && g.acceptance.every((a) => a.satisfied === true && a.evidenceIds.length > 0);
}
