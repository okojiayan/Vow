import { createHash } from "node:crypto";
import type { AgentPlan, AgentTask, PlannedAction } from "@/core/agent/types";
import { getToolPermission } from "./policy";

export interface TaskPassView {
  objective: string;
  actions: Array<{ tool: string; target?: string; argsSummary: string; risk: string; reversible: boolean }>;
  readScopes: string[];
  writeScopes: string[];
  networkEffects: string[];
  requiredApprovals: string[];
  expectedChanges: string[];
  uncertainties: string[];
  planVersion: string;
}

export function hashPlan(plan: AgentPlan): string {
  const normalized = {
    summary: plan.summary,
    steps: plan.steps.map((s) => ({ tool: s.action?.tool ?? null, args: s.action?.args ?? {}, target: s.action?.target ?? null, requiresApproval: s.requiresApproval })),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "no args";
  return keys.map((k) => {
    const v = args[k];
    const s = typeof v === "string" ? (v.length > 40 ? `${v.slice(0, 40)}…` : v) : JSON.stringify(v)?.slice(0, 40) ?? "?";
    return `${k}=${s}`;
  }).join(", ");
}

const REVERSIBLE_TOOLS = new Set(["notes.create", "fs.write", "memory.store"]);

export function buildTaskPass(task: AgentTask, plan: AgentPlan): TaskPassView {
  const actions = plan.steps.filter((s) => s.action).map((s) => {
    const a = s.action as PlannedAction;
    const perm = getToolPermission(a.tool);
    return {
      tool: a.tool,
      target: a.target,
      argsSummary: summarizeArgs(a.args),
      risk: perm?.risk ?? "unknown",
      reversible: REVERSIBLE_TOOLS.has(a.tool),
    };
  });
  const readScopes: string[] = [];
  const writeScopes: string[] = [];
  for (const a of actions) {
    if (!a.target) continue;
    if (a.tool.startsWith("fs.") || a.tool === "notes.create") { if (!writeScopes.includes(a.target)) writeScopes.push(a.target); }
    else if (!readScopes.includes(a.target)) readScopes.push(a.target);
  }
  const networkEffects = actions.filter((a) => a.tool === "http.fetch").map((a) => a.target ?? a.tool);
  const requiredApprovals = plan.steps.filter((s) => s.requiresApproval).map((s) => s.title);
  const expectedChanges = actions.filter((a) => !REVERSIBLE_TOOLS.has(a.tool) && (a.risk === "write" || a.risk === "destructive" || a.risk === "network")).map((a) => `${a.tool}${a.target ? ` → ${a.target}` : ""} (verify support before claiming undo)`);
  const uncertainties: string[] = [];
  if (actions.some((a) => a.risk === "unknown")) uncertainties.push("One or more tools have no registered permission; treated as unknown risk.");
  if (networkEffects.length === 0) uncertainties.push("No external network effects declared in this plan.");
  else uncertainties.push("Network effects declared; exact external outcome cannot be verified in advance.");
  return { objective: task.request, actions, readScopes, writeScopes, networkEffects, requiredApprovals, expectedChanges, uncertainties, planVersion: hashPlan(plan) };
}

export interface BlastRadius {
  level: "low" | "medium" | "high";
  score: number;
  factors: string[];
  missing: string[];
}

export function blastRadiusForPass(view: TaskPassView, totalFiles?: number): BlastRadius {
  let score = 0;
  const factors: string[] = [];
  const missing: string[] = [];
  const tools = view.actions.map((a) => a.tool);
  if (tools.includes("fs.delete") || tools.includes("shell.exec")) { score += 50; factors.push("Destructive or shell tool present."); }
  if (view.networkEffects.length > 0) { score += 25; factors.push(`${view.networkEffects.length} network effect(s) declared.`); }
  if (view.writeScopes.length > 0) { score += 10 + Math.min(15, view.writeScopes.length * 5); factors.push(`${view.writeScopes.length} write scope(s).`); }
  else factors.push("Read-only plan: no write scopes.");
  const irreversible = view.actions.filter((a) => !a.reversible);
  if (irreversible.length > 0) { score += Math.min(15, irreversible.length * 5); factors.push(`${irreversible.length} action(s) without a supported undo path.`); }
  if (typeof totalFiles !== "number") missing.push("Workspace file count unavailable; scope size estimated from declared scopes only.");
  else { factors.push(`${totalFiles} file(s) indexed in workspace.`); score += Math.min(10, Math.floor(view.writeScopes.length)); }
  if (view.requiredApprovals.length > 0) factors.push(`${view.requiredApprovals.length} approval gate(s) required.`);
  const level = score >= 50 ? "high" : score >= 20 ? "medium" : "low";
  return { level, score, factors, missing };
}
