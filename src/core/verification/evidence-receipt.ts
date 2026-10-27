import { z } from "zod";
import { getTask, listTasks } from "@/core/agent/task-store";
import { getTrace } from "@/core/traces/trace-store";
import { getLedger } from "@/core/reasoning/ledger";
import { listAudit } from "@/core/warden/audit";
import { verifySubagentResult } from "@/core/agent/subagents";

/**
 * Source-backed Evidence Receipt.
 *
 * A typed, validated summary generated deterministically from actual task,
 * trace, ledger, tool-execution and verification records. It never invents
 * provenance, never asks an LLM to certify correctness, and never labels a
 * task verified merely because a subagent reports success: the receipt
 * recomputes acceptance from the underlying records and surfaces
 * contradictions explicitly.
 */

export const RECEIPT_VERSION = "1.0.0" as const;

const SECRET_KEY = /(api[_-]?key|secret|token|password|auth|credential|bearer)/i;

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/Bearer\s+[^\s"']+/g, "Bearer <redacted>");
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "<redacted>" : scrub(entry);
    }
    return out;
  }
  return value;
}

export const evidenceReceiptSchema = z.object({
  version: z.literal("1.0.0"),
  generatedAt: z.string(),
  taskId: z.string(),
  requestExcerpt: z.string(),
  status: z.enum([
    "received", "queued", "claimed", "planning", "awaiting_approval",
    "executing", "verifying", "interrupted",
    "completed", "failed", "blocked", "cancelled",
  ]),
  structuredOutcome: z
    .object({
      outcome: z.string(),
      reason: z.string(),
      acceptanceSatisfied: z.number(),
      acceptanceTotal: z.number(),
      verificationPassed: z.boolean().nullable(),
      providers: z.array(z.string()),
    })
    .nullable(),
  verification: z
    .object({
      passed: z.boolean().nullable(),
      explanation: z.string(),
      evidenceCount: z.number(),
    })
    .nullable(),
  children: z.array(
    z.object({
      childTaskId: z.string(),
      status: z.string(),
      accepted: z.boolean().nullable(),
      deliverableExcerpt: z.string(),
    }),
  ),
  skills: z.array(
    z.object({
      skill: z.string(),
      version: z.string(),
      ok: z.boolean(),
    }),
  ),
  pluginTools: z.array(z.string()),
  toolCalls: z.array(
    z.object({
      tool: z.string(),
      decision: z.string(),
      policy: z.string(),
      outcome: z.string().nullable(),
    }),
  ),
  warden: z.object({
    allows: z.number(),
    denies: z.number(),
    approvals: z.number(),
    policies: z.array(z.string()),
  }),
  evidenceIds: z.array(z.string()),
  recovery: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  contradictions: z.array(z.string()),
  limitations: z.array(z.string()),
  observedVsInferred: z.object({
    observed: z.array(z.string()),
    inferred: z.array(z.string()),
  }),
  sandbox: z.object({
    osIsolation: z.literal(false),
    note: z.string(),
  }),
  provenance: z.object({
    providers: z.array(z.string()),
    inferenceMode: z.string().nullable(),
  }),
  recordCounts: z.object({
    traceEvents: z.number(),
    ledgerEvents: z.number(),
    auditEvents: z.number(),
  }),
});

export type EvidenceReceipt = z.infer<typeof evidenceReceiptSchema>;

export function parseEvidenceReceipt(data: unknown): { ok: true; receipt: EvidenceReceipt } | { ok: false; error: string } {
  const parsed = evidenceReceiptSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, receipt: parsed.data };
}

/**
 * Recompute internal consistency of a receipt from its own fields only.
 * Used to catch malformed, incomplete, contradictory or tampered receipts
 * without re-reading the source stores.
 */
export function verifyReceiptConsistency(receipt: EvidenceReceipt): { consistent: boolean; problems: string[] } {
  const problems: string[] = [];
  if (receipt.taskId.trim().length === 0) problems.push("Receipt has no task id.");
  const verified = receipt.verification?.passed === true;
  const outcome = receipt.structuredOutcome?.outcome;
  if (verified && receipt.toolCalls.length === 0 && receipt.children.length === 0 && receipt.skills.length === 0) {
    problems.push("Receipt claims verification passed with no recorded tool, skill, or child execution.");
  }
  if ((outcome === "completed" || receipt.status === "completed") && receipt.verification && receipt.verification.passed === false) {
    problems.push("Receipt reports completion with failing verification.");
  }
  if (outcome === "completed" && receipt.verification?.passed !== true) {
    problems.push("Receipt reports a completed outcome without passing verification.");
  }
  for (const child of receipt.children) {
    if (child.accepted === false && outcome === "completed") {
      problems.push(`Receipt reports completion while child ${child.childTaskId} was not accepted.`);
    }
  }
  if (receipt.sandbox.osIsolation !== false) {
    problems.push("Receipt must never claim OS isolation.");
  }
  return { consistent: problems.length === 0, problems };
}

/** Build a receipt deterministically from source records. No model calls. */
export async function buildEvidenceReceipt(taskId: string): Promise<EvidenceReceipt> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Unknown task "${taskId}".`);
  const trace = await getTrace(taskId).catch(() => ({ taskId, events: [] as never[] }));
  const ledger = getLedger(taskId);
  const allTasks = await listTasks();
  const children = allTasks.filter((t) => t.parentTaskId === taskId);
  const relevantIds = new Set([taskId, ...children.map((c) => c.id)]);
  const audits = (await listAudit(500)).filter((a) => a.taskId && relevantIds.has(a.taskId));

  const toolCalls = audits
    .filter((a) => a.tool)
    .map((a) => ({
      tool: a.tool as string,
      decision: scrub(String(a.decision)) as string,
      policy: a.policy,
      outcome: a.outcome ?? null,
    }));

  const allows = audits.filter((a) => a.decision === "allow" || a.decision === "allowed").length;
  const denies = audits.filter((a) => a.decision === "deny").length;
  const approvals = audits.filter((a) => a.kind === "approval").length;
  const policies = [...new Set(audits.map((a) => a.policy))].sort();

  const skills: EvidenceReceipt["skills"] = [];
  for (const event of trace.events) {
    const started = event.title.match(/^Skill started \(([a-z][a-z0-9-]*) v([^)]+)\)/);
    if (started) {
      const verified = ledger.some(
        (e) => e.kind === "verification" && e.title === `Skill verified (${started[1]})`,
      );
      if (!skills.some((s) => s.skill === started[1])) {
        skills.push({ skill: started[1], version: started[2], ok: verified });
      }
    }
  }

  const pluginTools = [
    ...new Set(
      toolCalls.filter((t) => t.tool.startsWith("plugin.")).map((t) => t.tool),
    ),
  ].sort();

  const childrenOut: EvidenceReceipt["children"] = [];
  for (const child of [...children].sort((a, b) => a.id.localeCompare(b.id))) {
    let accepted: boolean | null = null;
    try {
      const check = await verifySubagentResult(child.id, {
        childTaskId: child.id,
        status:
          child.status === "completed"
            ? "completed"
            : child.status === "blocked"
              ? "blocked"
              : child.status === "cancelled"
                ? "cancelled"
                : "failed",
        deliverable: child.resultSummary ?? "",
        evidence: [],
        attempts: 1,
        usage: child.usage ?? { promptTokens: 0, completionTokens: 0 },
        error: child.error ?? undefined,
      });
      accepted = check.accepted;
    } catch {
      accepted = null;
    }
    childrenOut.push({
      childTaskId: child.id,
      status: child.status,
      accepted,
      deliverableExcerpt: String(child.resultSummary ?? child.error ?? "").slice(0, 300),
    });
  }

  const evidenceIds = Array.isArray(task.outcome?.evidenceIds)
    ? task.outcome.evidenceIds.filter((id): id is string => typeof id === "string")
    : [];

  const recovery: string[] = [];
  for (const event of trace.events) {
    if (event.kind === "retry" || event.kind === "recovered") {
      recovery.push(`${event.kind}: ${event.title}`);
    }
  }
  for (const entry of ledger) {
    if (entry.kind === "escalation" || entry.kind === "transition") {
      recovery.push(`${entry.kind}: ${entry.title}`);
    }
  }

  const missingEvidence: string[] = [];
  if (!task.verification) missingEvidence.push("No verification record on the task.");
  if (!task.outcome) missingEvidence.push("No structured outcome on the task.");
  if (evidenceIds.length === 0) missingEvidence.push("No evidence references recorded.");
  if (ledger.length === 0) missingEvidence.push("No ledger events in memory (persisted ledger is best-effort).");
  if (toolCalls.length === 0 && childrenOut.length === 0) {
    missingEvidence.push("No tool executions or child tasks linked to this task.");
  }

  const contradictions: string[] = [];
  if (task.status === "completed" && task.verification && task.verification.passed === false) {
    contradictions.push("Task status is completed but verification failed.");
  }
  if (task.outcome?.outcome === "completed" && task.outcome.verificationPassed === false) {
    contradictions.push("Structured outcome is completed but verification did not pass.");
  }
  if (task.outcome?.outcome === "completed" && task.verification?.passed !== true) {
    contradictions.push("Structured outcome claims completed without passing verification.");
  }
  for (const child of childrenOut) {
    if (child.accepted === false && task.outcome?.outcome === "completed") {
      contradictions.push(`Outcome is completed while child ${child.childTaskId} was not accepted.`);
    }
  }

  const limitations = [
    "Ledger state is in-memory; durable persistence is best-effort via the trace-store conventions.",
    "No OS-level process, filesystem, or network sandbox is implemented; isolation is logical only (see docs/reasoning/sandbox-boundaries.md).",
    "Receipt reflects recorded evidence only; gaps are listed under missingEvidence, never filled in.",
  ];
  if (task.outcome?.outcome === "unverified" || task.status === "failed") {
    limitations.push("Task did not complete; the receipt preserves the honest terminal state.");
  }

  const observed = [
    `Tool calls recorded in audit: ${toolCalls.length}`,
    `Warden decisions: ${allows} allow, ${denies} deny, ${approvals} approval`,
    `Trace events: ${trace.events.length}; ledger events: ${ledger.length}`,
    `Children linked: ${childrenOut.length}; skills invoked: ${skills.length}`,
  ];
  const inferred = [
    "Result summaries and deliverable excerpts are model-authored text, not measurements.",
    "Verification explanations interpret recorded evidence; they are not independent proof.",
  ];

  const providers = [...new Set(task.outcome?.providerProvenance ?? [])];

  return {
    version: RECEIPT_VERSION,
    generatedAt: new Date().toISOString(),
    taskId: task.id,
    requestExcerpt: String(scrub(task.request)).slice(0, 500),
    status: task.status,
    structuredOutcome: task.outcome
      ? {
          outcome: task.outcome.outcome,
          reason: task.outcome.reason,
          acceptanceSatisfied: task.outcome.acceptanceSatisfied,
          acceptanceTotal: task.outcome.acceptanceTotal,
          verificationPassed: task.outcome.verificationPassed,
          providers,
        }
      : null,
    verification: task.verification
      ? {
          passed: task.verification.passed,
          explanation: task.verification.explanation,
          evidenceCount: Array.isArray(task.verification.evidence) ? task.verification.evidence.length : 0,
        }
      : null,
    children: childrenOut,
    skills,
    pluginTools,
    toolCalls,
    warden: { allows, denies, approvals, policies },
    evidenceIds,
    recovery,
    missingEvidence,
    contradictions,
    limitations,
    observedVsInferred: { observed, inferred },
    sandbox: {
      osIsolation: false,
      note: "No OS sandbox is implemented. Enforcement is logical: Warden deny-by-default policy, delegation tool allowlists, workspace path guards, and approval gates, all executed in-process.",
    },
    provenance: { providers, inferenceMode: task.inferenceMode ?? null },
    recordCounts: { traceEvents: trace.events.length, ledgerEvents: ledger.length, auditEvents: audits.length },
  };
}
