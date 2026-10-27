import { z } from "zod";
import { createTask, runTask } from "./orchestrator";
import { getTask, listTasks, saveTask } from "./task-store";
import { getTrace } from "@/core/traces/trace-store";
import { appendTrace } from "@/core/traces/trace-store";
import { appendLedger } from "@/core/reasoning/ledger";
import { getTool } from "@/core/execution/tool-registry";
import { effortLevelSchema } from "@/lib/schemas";
import type { AgentTask, TerminalOutcome } from "./types";

/**
 * Genuine subagent delegation on top of the existing AgentTask lifecycle.
 *
 * A child is a full AgentTask (same store, state machine, traces, ledger,
 * verification, Warden gateway) with two extra fields: parentTaskId and an
 * explicit tool allowlist enforced by the executor. No second lifecycle, no
 * OS sandbox: isolation is logical (allowlist + conversation scopes +
 * Warden), executed in-process. High-risk operations stay governed by the
 * same deny-by-default policy as parent tasks.
 */

export const MAX_DELEGATION_DEPTH = 2;
export const MAX_CHILDREN_PER_PARENT = 8;
export const MAX_CONCURRENT_SUBAGENTS = 2;
export const DEFAULT_CHILD_TIMEOUT_MS = 120000;

export const subagentSpecSchema = z.object({
  role: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(4000),
  /** Scoped data handed to the child. Recorded in traces; never secrets. */
  input: z.record(z.string(), z.unknown()).default({}),
  /** Registered tools the child may invoke. Enforced by the executor. */
  allowedTools: z.array(z.string().min(1)).min(1).max(24),
  effortCeiling: effortLevelSchema.optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(DEFAULT_CHILD_TIMEOUT_MS),
  maxRetries: z.number().int().min(0).max(2).default(0),
});

export type SubagentSpec = z.infer<typeof subagentSpecSchema>;

export interface SubagentEvidence {
  tool: string;
  summary: string;
}

export interface SubagentResult {
  childTaskId: string;
  status: Exclude<TerminalOutcome, never>;
  deliverable: string;
  evidence: SubagentEvidence[];
  attempts: number;
  usage: { promptTokens: number; completionTokens: number };
  error?: string;
}

export interface SubagentVerification {
  accepted: boolean;
  reasons: string[];
}

// Bounded concurrency across all delegations in this process.
let activeChildren = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(limit: number): Promise<void> {
  if (activeChildren < limit) {
    activeChildren += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeChildren += 1;
}

function releaseSlot(): void {
  activeChildren = Math.max(0, activeChildren - 1);
  const next = waiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`Subagent timed out after ${ms}ms.`)), ms));
}

async function delegationDepth(task: AgentTask): Promise<number> {
  let depth = 0;
  let current: AgentTask | undefined = task;
  const seen = new Set<string>();
  while (current?.parentTaskId && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = await getTask(current.parentTaskId);
    if (depth > MAX_DELEGATION_DEPTH + 2) break;
  }
  return depth;
}

function collectEvidence(task: AgentTask): SubagentEvidence[] {
  const out: SubagentEvidence[] = [];
  for (const step of task.plan?.steps ?? []) {
    if (step.action?.tool && step.output !== undefined && step.status === "verified") {
      out.push({ tool: step.action.tool, summary: JSON.stringify(step.output).slice(0, 200) });
    }
  }
  return out;
}

function mapOutcome(task: AgentTask): { status: SubagentResult["status"]; error?: string } {
  const structured = task.outcome?.outcome;
  if (task.status === "cancelled" || structured === "cancelled") {
    return { status: "cancelled", error: task.error ?? task.cancelReason ?? "Cancelled." };
  }
  if (task.status === "blocked" || structured === "blocked") {
    return { status: "blocked", error: task.error ?? "Blocked by policy or approval." };
  }
  if (task.status === "failed" || structured === "failed") {
    return { status: "failed", error: task.error ?? "Child task failed." };
  }
  if (structured === "partial") return { status: "partial", error: task.error ?? undefined };
  if (structured === "unverified") return { status: "unverified", error: task.error ?? undefined };
  if (task.status === "completed") {
    if (task.verification?.passed === true) return { status: "completed" };
    return { status: "unverified", error: task.verification?.explanation ?? "Completed without passing verification." };
  }
  return { status: "failed", error: task.error ?? `Child ended in non-terminal status ${task.status}.` };
}

/**
 * Validate a child's deliverable against its objective and execution
 * records. Child output is treated as untrusted data: acceptance requires
 * terminal child state plus real evidence, never a success claim alone.
 */
export async function verifySubagentResult(childId: string, result: SubagentResult): Promise<SubagentVerification> {
  const reasons: string[] = [];
  const child = await getTask(childId);
  if (!child) return { accepted: false, reasons: ["Child task record is missing."] };
  const terminal = ["completed", "failed", "blocked", "cancelled"].includes(child.status);
  if (!terminal) {
    reasons.push(`Child task is not terminal (status ${child.status}).`);
  }
  if ((result.status === "completed" || result.status === "partial") && !result.deliverable.trim()) {
    reasons.push("Completed/partial result carries no deliverable.");
  }
  const executedTools = (child.plan?.steps ?? []).filter((s) => s.action && s.status === "verified").length;
  if (executedTools > 0) {
    try {
      const trace = await getTrace(childId);
      const okTools = trace.events.filter((e) => e.title.startsWith("Tool ok: ")).length;
      if (okTools === 0) reasons.push("Child claims verified tool work but the trace shows no successful tool execution.");
    } catch {
      reasons.push("Child trace is unreadable; cannot confirm claimed tool work.");
    }
  }
  if (result.status === "failed" || result.status === "blocked" || result.status === "cancelled" || result.status === "unverified") {
    if (!result.error) reasons.push(`${result.status} result carries no error explanation.`);
  }
  return { accepted: reasons.length === 0, reasons };
}

export async function delegate(
  parent: AgentTask,
  specInput: unknown,
  opts?: { maxConcurrent?: number },
): Promise<{ result: SubagentResult; verification: SubagentVerification }> {
  const parsed = subagentSpecSchema.safeParse(specInput);
  if (!parsed.success) {
    const result: SubagentResult = {
      childTaskId: "",
      status: "failed",
      deliverable: "",
      evidence: [],
      attempts: 0,
      usage: { promptTokens: 0, completionTokens: 0 },
      error: `Invalid subagent spec: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
    return { result, verification: { accepted: false, reasons: ["Spec failed validation."] } };
  }
  const spec = parsed.data;
  const limit = Math.min(Math.max(opts?.maxConcurrent ?? MAX_CONCURRENT_SUBAGENTS, 1), MAX_CONCURRENT_SUBAGENTS * 2);

  const fail = async (
    error: string,
    status: SubagentResult["status"] = "blocked",
  ): Promise<{ result: SubagentResult; verification: SubagentVerification }> => {
    const result: SubagentResult = {
      childTaskId: "",
      status,
      deliverable: "",
      evidence: [],
      attempts: 0,
      usage: { promptTokens: 0, completionTokens: 0 },
      error,
    };
    await appendTrace(parent.id, { kind: "blocked", title: "Subagent delegation refused", detail: error });
    appendLedger(parent.id, { kind: "escalation", title: "Delegation refused", detail: error });
    return { result, verification: { accepted: false, reasons: [error] } };
  };

  const fresh = await getTask(parent.id);
  if (fresh?.cancelRequested) return fail("Parent is cancelled; delegation refused.", "cancelled");
  const unknownTools = spec.allowedTools.filter((t) => !getTool(t));
  if (unknownTools.length > 0) return fail(`Unknown tools in allowlist: ${unknownTools.join(", ")}.`);
  if ((await delegationDepth(fresh ?? parent)) + 1 > MAX_DELEGATION_DEPTH) {
    return fail(`Maximum delegation depth (${MAX_DELEGATION_DEPTH}) exceeded.`);
  }
  const siblings = (await listTasks()).filter((t) => t.parentTaskId === parent.id);
  if (siblings.length >= MAX_CHILDREN_PER_PARENT) {
    return fail(`Maximum child executions per parent (${MAX_CHILDREN_PER_PARENT}) exceeded.`);
  }

  await appendTrace(parent.id, {
    kind: "planning",
    title: `Subagent delegated (${spec.role})`,
    detail: spec.objective.slice(0, 500),
    data: { role: spec.role, allowedTools: spec.allowedTools, timeoutMs: spec.timeoutMs },
  });
  appendLedger(parent.id, { kind: "decision", title: `Delegated to subagent (${spec.role})`, detail: spec.objective.slice(0, 300) });

  let attempts = 0;
  let last: SubagentResult | null = null;
  while (attempts <= spec.maxRetries) {
    attempts += 1;
    const cancelled = (await getTask(parent.id))?.cancelRequested;
    if (cancelled) {
      const result: SubagentResult = {
        childTaskId: last?.childTaskId ?? "",
        status: "cancelled",
        deliverable: "",
        evidence: [],
        attempts,
        usage: last?.usage ?? { promptTokens: 0, completionTokens: 0 },
        error: "Parent cancellation observed before child attempt.",
      };
      return { result, verification: { accepted: false, reasons: ["Parent cancelled."] } };
    }
    await acquireSlot(limit);
    let child: AgentTask;
    try {
      const created = await createTask(
        `Subagent (${spec.role}): ${spec.objective}${Object.keys(spec.input).length > 0 ? `\nScoped input: ${JSON.stringify(spec.input).slice(0, 1000)}` : ""}`,
        parent.conversationId,
        spec.effortCeiling ?? parent.effortCeiling ?? undefined,
      );
      child = await saveTask({
        ...created.task,
        parentTaskId: parent.id,
        allowedTools: [...spec.allowedTools],
      });
      await appendTrace(child.id, {
        kind: "planning",
        title: `Spawned by parent ${parent.id}`,
        detail: `Role: ${spec.role}. Allowed tools: ${spec.allowedTools.join(", ")}.`,
      });
      let finished: AgentTask;
      try {
        finished = await runChildWithTimeout(child.id, spec.timeoutMs);
      } catch (timeoutError) {
        const message = timeoutError instanceof Error ? timeoutError.message : String(timeoutError);
        last = {
          childTaskId: child.id,
          status: "failed",
          deliverable: "",
          evidence: [],
          attempts,
          usage: { promptTokens: 0, completionTokens: 0 },
          error: message,
        };
        break;
      }
      const mapped = mapOutcome(finished);
      last = {
        childTaskId: finished.id,
        status: mapped.status,
        deliverable: finished.resultSummary ?? "",
        evidence: collectEvidence(finished),
        attempts,
        usage: finished.usage ?? { promptTokens: 0, completionTokens: 0 },
        error: mapped.error,
      };
    } finally {
      releaseSlot();
    }
    // Fail closed: policy denials and blocks are never retried.
    if (last.status !== "failed" || /denied|outside this delegated|Blocked by policy/i.test(last.error ?? "")) break;
    if (attempts > spec.maxRetries) break;
  }

  const result = last ?? {
    childTaskId: "",
    status: "failed" as const,
    deliverable: "",
    evidence: [],
    attempts,
    usage: { promptTokens: 0, completionTokens: 0 },
    error: "Delegation produced no result.",
  };
  const verification = await verifySubagentResult(result.childTaskId, result);
  const doneKind = result.status === "completed" && verification.accepted ? "completed"
    : result.status === "blocked" ? "blocked"
    : result.status === "cancelled" ? "cancelled" : "failure";
  await appendTrace(parent.id, {
    kind: doneKind,
    title: `Subagent ${result.status} (${spec.role})`,
    detail: (result.error ?? result.deliverable).slice(0, 500),
    data: { childTaskId: result.childTaskId, accepted: verification.accepted, reasons: verification.reasons },
  });
  appendLedger(parent.id, {
    kind: "transition",
    title: `Subagent ${result.status}`,
    detail: `Child ${result.childTaskId}; accepted: ${verification.accepted}.`,
  });
  return { result, verification };
}

export interface DelegationAggregate {
  status: "completed" | "partial" | "failed";
  children: SubagentResult[];
  conflicts: string[];
  note: string;
}

/**
 * Delegate several subtasks with bounded concurrency. A single failed child
 * never disappears: any non-completion degrades the aggregate to partial
 * (or failed when nothing completed), with per-child outcomes preserved.
 */
/**
 * Run a saved child task with a wall-clock budget. On timeout, request
 * cancellation best-effort (the run winds down at its next checkpoint) and
 * throw. Exported for testing the race and its side effects.
 */
export async function runChildWithTimeout(childId: string, timeoutMs: number): Promise<AgentTask> {
  try {
    return await Promise.race([runTask(childId), sleep(timeoutMs)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const stuck = await getTask(childId);
      if (stuck && !["completed", "failed", "blocked", "cancelled"].includes(stuck.status)) {
        await saveTask({ ...stuck, cancelRequested: true, cancelReason: message });
      }
    } catch { /* best effort */ }
    throw new Error(message);
  }
}

/**
 * Pure conflict detector for aggregate results: same objective with more
 * than one distinct non-empty deliverable must be reconciled by the parent.
 */
export function detectConflicts(entries: Array<{ objective: string; deliverable: string }>): string[] {
  const conflicts: string[] = [];
  const byObjective = new Map<string, Set<string>>();
  for (const { objective, deliverable } of entries) {
    const key = deliverable.trim().toLowerCase();
    if (!key) continue;
    if (!byObjective.has(objective)) byObjective.set(objective, new Set());
    byObjective.get(objective)?.add(key);
  }
  for (const [objective, variants] of byObjective) {
    if (variants.size > 1) {
      conflicts.push(`Conflicting deliverables for "${objective.slice(0, 120)}": ${variants.size} distinct results.`);
    }
  }
  return conflicts;
}

export async function delegateMany(
  parent: AgentTask,
  specs: unknown[],
  opts?: { maxConcurrent?: number },
): Promise<DelegationAggregate> {
  const limit = Math.min(Math.max(opts?.maxConcurrent ?? MAX_CONCURRENT_SUBAGENTS, 1), MAX_CONCURRENT_SUBAGENTS * 2);
  const indexed = specs.map((spec, index) => ({
    index,
    objective: (() => {
      const parsed = subagentSpecSchema.safeParse(spec);
      return parsed.success ? parsed.data.objective : `spec-${index} (invalid)`;
    })(),
    spec,
  }));
  const results: Array<{ objective: string; result: SubagentResult }> = [];
  // Semaphore is shared module-wide; run with bounded parallelism.
  const queue = [...indexed];
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      const { result } = await delegate(parent, item.spec, { maxConcurrent: limit });
      results.push({ objective: item.objective, result });
    }
  };
  const workers = Math.min(limit, Math.max(queue.length, 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const conflicts = detectConflicts(results.map(({ objective, result }) => ({ objective, deliverable: result.deliverable })));
  const ordered = results.sort((a, b) => a.result.childTaskId.localeCompare(b.result.childTaskId)).map((r) => r.result);
  const allOk = ordered.length > 0 && ordered.every((r) => r.status === "completed");
  return {
    status: allOk ? "completed" : ordered.some((r) => r.status === "completed" || r.status === "partial") ? "partial" : "failed",
    children: ordered,
    conflicts,
    note: allOk ? `${ordered.length} subagents completed and verified.` : "One or more children did not complete; see per-child outcomes.",
  };
}
