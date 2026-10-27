import { appendTrace } from "@/core/traces/trace-store";
import type { TraceEventKind } from "@/core/traces/trace-types";
import type { AgentTask } from "@/core/agent/types";
import { verifySteps } from "@/core/verification/verifier";
import { isPlanEnvelope } from "@/core/verification/checks";
import {
  acceptanceSatisfied, addEvidence, buildGraphFromTask, checkpoint, markSubgoal,
  type EvidenceRef, type TaskStateGraph,
} from "./task-graph";
import { clampToCeiling, createBudget, recordModelCall, recordToolCall, suggestEffort, type EffortBudget, type EffortLevel } from "./effort";
import { appendLedger } from "./ledger";
import { decideNext, type Operation } from "./controller";
import { applyReplan, classifyFailure, decideRecovery, finalOutcome, MAX_REPLANS } from "./recovery";
import { buildStructuredOutcome } from "./outcome";
import type { StructuredOutcome, TerminalOutcome } from "@/core/agent/types";

/** Provider abstraction: reasoning never calls a model directly. */
export interface ReasoningModelPort {
  complete(prompt: string): Promise<{
    text: string;
    provenance: string;
    usage?: { promptTokens?: number; completionTokens?: number };
    /** Structured diagnosis when this call fell back instead of returning
     *  provider-backed text. Absent on genuine provider answers. */
    fallback?: import("@/core/traces/trace-types").ProviderFallbackDiagnosis;
  }>;
}
/** Memory port: uses existing JSON-backed Memory Engine interfaces, no competing store. */
export interface ReasoningMemoryPort { search(query: string, limit?: number): Promise<{ id: string; content: string }[]>; }
/** Tool port: delegates to execution engine behind Warden policy. */
export interface ReasoningToolPort {
  exec(input: { taskId: string; tool: string; args: Record<string, unknown> }): Promise<{ ok: boolean; output?: unknown; error?: string; needsApproval?: boolean; approvalId?: string; provenance: string }>;
}

export interface ReasoningRunnerOpts {
  task: AgentTask;
  acceptance: string[];
  ceiling: EffortLevel;
  model: ReasoningModelPort;
  memory: ReasoningMemoryPort;
  tools: ReasoningToolPort;
  maxCycles?: number;
  isCancelled?: () => boolean | Promise<boolean>;
  onTrace?: (kind: TraceEventKind, title: string, detail: string, data?: unknown) => Promise<void> | void;
}

export interface ReasoningRunResult { graph: TaskStateGraph; outcome: TerminalOutcome; cycles: number; ops: Operation[]; budget: EffortBudget; provenance: string[]; pendingApprovalId: string | null; cancelled: boolean; structured: StructuredOutcome; usage: { promptTokens: number; completionTokens: number }; /** Structured fallback diagnoses recorded this run (investigation stage). Empty when every model call was provider-backed. */ fallbacks: import("@/core/traces/trace-types").ProviderFallbackDiagnosis[]; }

async function trace(taskId: string, kind: TraceEventKind, title: string, detail: string, data: unknown, onTrace?: ReasoningRunnerOpts["onTrace"]) {
  if (onTrace) await onTrace(kind, title, detail, data);
  else await appendTrace(taskId, { kind, title, detail, data }).catch(() => undefined);
}

export async function runReasoningCycle(opts: ReasoningRunnerOpts): Promise<ReasoningRunResult> {
  let graph = buildGraphFromTask(opts.task, opts.acceptance);
  const budget = createBudget(opts.ceiling);
  const ops: Operation[] = [];
  const provenance: string[] = [];
  const fallbacks: import("@/core/traces/trace-types").ProviderFallbackDiagnosis[] = [];
  let replans = 0;
  let lastFailureSig: { stepId: string; kind: string; error: string } | null = null;
  let sameSignatureFailures = 0;
  const maxCycles = opts.maxCycles ?? 12;
  let cycles = 0;
  let verificationPassed: boolean | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let toolFailed = false;
  let needsApproval = false;
  let pendingApprovalId: string | null = null;
  let cancelled = false;

  graph = checkpoint(graph, "reasoning-start");
  appendLedger(opts.task.id, { kind: "decision", title: "Reasoning started", detail: `Ceiling ${opts.ceiling}; ${graph.subgoals.length} subgoals.` });

  while (cycles < maxCycles) {
    cycles += 1;
    if (opts.isCancelled && (await opts.isCancelled())) { cancelled = true; appendLedger(opts.task.id, { kind: "transition", title: "Cancelled", detail: "Cancellation observed by reasoning loop." }); break; }
    const hasEvidence = graph.evidence.length > 0;
    const { op, reason, subgoalId } = decideNext({ graph, budget, needsApproval, toolFailed, verificationPassed, hasEvidence, userHelpAvailable: true });
    ops.push(op);
    appendLedger(opts.task.id, { kind: "decision", title: `Controller → ${op}`, detail: reason });
    await trace(opts.task.id, "planning", `Controller → ${op}`, reason, { op, subgoalId }, opts.onTrace);

    if (op.startsWith("finish_")) break;

    if (op === "retrieve_memory") {
      if (!recordModelCall(budget)) break;
      const hits = await opts.memory.search(graph.goal, 5);
      for (const h of hits) {
        const r = addEvidence(graph, "memory", h.id, h.content.slice(0, 200));
        graph = r.graph;
        const acc = graph.acceptance.map((a) => a);
        void acc;
      }
      provenance.push("memory:json-engine");
      appendLedger(opts.task.id, { kind: "evidence", title: "Memory evidence", detail: `${hits.length} records via Memory Engine.`, evidenceIds: graph.evidence.map((e: EvidenceRef) => e.id) });
      await trace(opts.task.id, "memory", "Memory evidence", `${hits.length} records via Memory Engine.`, undefined, opts.onTrace);
      if (hits.length === 0) { // avoid infinite memory loop: move to plan
        graph = checkpoint(graph, "no-memory");
        appendLedger(opts.task.id, { kind: "transition", title: "No memory hits", detail: "Proceeding to plan/investigate." });
        break;
      }
    } else if (op === "investigate" || op === "plan" || op === "test_hypothesis") {
      if (!recordModelCall(budget)) break;
      const target = subgoalId ? graph.subgoals.find((s) => s.id === subgoalId) : undefined;
      const level = clampToCeiling(suggestEffort({ ambiguous: true, retries: target?.attempts ?? 0 }), opts.ceiling);
      // Handoff: prior TOOL evidence (e.g. real query rows) is passed as structured
      // context so the model analyzes observed data, never invented data. Bounded.
      const toolContext = graph.evidence
        .filter((e) => e.kind === "tool")
        .map((e) => `Evidence(${e.ref}): ${(e.note ?? "").slice(0, 1200)}`)
        .join("\n")
        .slice(0, 2000);
      // Memory evidence is structured context for memory-grounded analysis so
      // the model answers from retrieved records, never invented facts. Bounded.
      const memoryContext = graph.evidence
        .filter((e) => e.kind === "memory")
        .map((e) => `Memory(${e.ref}): ${(e.note ?? "").slice(0, 500)}`)
        .join("\n")
        .slice(0, 2000);
      // Full retrieved records from memory.search steps (the evidence notes
      // above are truncated). Bounded per record and in total.
      const memStepContext = (opts.task.plan?.steps ?? [])
        .filter((st) => st.action?.tool === "memory.search" && Array.isArray(st.output))
        .flatMap((st) => (st.output as Array<{ id?: unknown; content?: unknown }>).slice(0, 5)
          .map((r) => `Record(${String(r.id ?? "?")}): ${String(r.content ?? "").slice(0, 500)}`))
        .join("\n")
        .slice(0, 2000);
      // Full structured rows from run_sql steps (the evidence notes above are
      // truncated to 300 chars). Record boundaries and critical field values
      // must reach the model intact so counts and exact values are observed,
      // never mentally reconstructed. Bounded: 20 rows, 200 chars per cell.
      const toolStepContext = (opts.task.plan?.steps ?? [])
        .filter((st) => st.action?.tool === "run_sql" && st.output && typeof st.output === "object")
        .flatMap((st) => {
          const out = st.output as { sql?: unknown; rows?: unknown; rowCount?: unknown };
          if (!Array.isArray(out.rows)) return [];
          const lines = (out.rows as unknown[][]).slice(0, 20).map(
            (row, i) => `Row ${i + 1}: ${Array.isArray(row) ? row.map((cell) => String(cell ?? "").slice(0, 200)).join(" | ") : String(row).slice(0, 200)}`,
          );
          return [`Table evidence (${out.rows.length} row(s))${typeof out.sql === "string" ? ` for ${out.sql.slice(0, 160)}` : ""}:`, ...lines];
        })
        .join("\n")
        .slice(0, 3000);
      // Planner-explicit standalone steps (expectGrounding "none") answer
      // from the request and general knowledge by construction: the plan
      // carries no tool or memory steps, so there is no evidence to analyze.
      // Sending the evidence-analysis instruction (and its "(no tool
      // evidence available)" marker) contradicts the step and invites the
      // provider to echo the marker back as the answer instead of answering.
      // Ask for the direct answer instead; grounded steps keep the existing
      // evidence instruction unchanged.
      const targetStep = target ? opts.task.plan?.steps.find((st) => st.id === target.stepId) : undefined;
      const standaloneDirect = target?.kind === "analysis" && targetStep?.expectGrounding === "none";
      const prompt = `${op}: goal=${graph.goal} subgoal=${target?.title ?? "n/a"} effort=${level}. Return ONLY the final answer to the user's request as plain text: no JSON envelope, no preamble, no reasoning notes.` +
        (target?.kind !== "analysis" ? "" : standaloneDirect
          ? `\nAnswer the request directly from the request itself and general knowledge. No tool evidence is expected for this step; provide the requested explanation or answer as plain text, never a statement that evidence is missing.`
          : `\nAnalyze ONLY the evidence below. Report observed field values exactly as shown; count rows by counting the listed Row N lines, never by guessing. Distinguish observed facts from any inference (label inferences as inference). If the evidence is empty, conflicting, or insufficient, say so honestly instead of inventing values. Do not invent identifiers, counts, or citations.\n${toolStepContext ? `${toolStepContext}\n` : ""}${toolContext || "(no tool evidence available)"}`);
      const retrieved = [memoryContext, memStepContext].filter(Boolean).join("\n");
      const fullPrompt = retrieved ? `${prompt}\nRetrieved memory:\n${retrieved}` : prompt;
      const res = await opts.model.complete(fullPrompt);
      // Never store hidden chain-of-thought: drop paired <think> blocks and,
      // for reasoning models that emit only a closer, keep just the text after
      // the last </think>. The visible answer is the deliverable, not the trace.
      const stripThink = (t: string) => {
        const w = t.replace(/<think>[\s\S]*?<\/think>/g, "");
        const c = w.lastIndexOf("</think>");
        return (c >= 0 ? w.slice(c + "</think>".length) : w).trim();
      };
      let cleaned = stripThink(res.text);
      let finalProvenance = res.provenance;
      // The diagnosis belongs to the call whose output is actually used: the
      // re-ask supersedes the first call whenever it runs.
      let finalFallback = res.fallback;
      promptTokens += res.usage?.promptTokens ?? 0;
      completionTokens += res.usage?.completionTokens ?? 0;
      // Bounded envelope repair (one re-ask): a provider answer shaped as a
      // plan/JSON envelope is not the artifact. Ask once more for the artifact
      // alone. Budget-checked via recordModelCall; never loops.
      if (target?.kind === "analysis" && isPlanEnvelope(cleaned, graph.goal) && recordModelCall(budget)) {
        appendLedger(opts.task.id, { kind: "decision", title: "Envelope re-ask", detail: "Provider returned a plan envelope; requesting the artifact alone (1 bounded retry)." });
        const retry = await opts.model.complete(
          `Your previous output was a plan or JSON envelope describing how to answer, not the answer itself. Output ONLY the requested artifact as plain text: no JSON envelope, no enumerated steps, no preamble. Report observed values exactly; count the listed Row N lines deterministically.\nOriginal request: ${graph.goal}` +
            (toolStepContext ? `\nEvidence table:\n${toolStepContext}` : "") +
            (toolContext ? `\nEvidence:\n${toolContext}` : "") +
            (retrieved ? `\nRetrieved memory:\n${retrieved}` : ""),
        );
        cleaned = stripThink(retry.text);
        finalProvenance = retry.provenance;
        finalFallback = retry.fallback;
        promptTokens += retry.usage?.promptTokens ?? 0;
        completionTokens += retry.usage?.completionTokens ?? 0;
        appendLedger(opts.task.id, { kind: "evidence", title: "Re-ask evidence", detail: `Provider ${retry.provenance}.` });
      }
      const r = addEvidence(graph, "model", finalProvenance, cleaned.slice(0, 300));
      graph = r.graph;
      provenance.push(finalProvenance);
      // A heuristic result without attached failure metadata is recorded as
      // `unknown`, never as success: the provenance already says
      // heuristic-demo, and the diagnosis makes the missing cause explicit.
      let evidenceFallback = finalFallback;
      if (!evidenceFallback && finalProvenance === "heuristic-demo") {
        const { unknownFallbackDiagnosis } = await import("@/core/agent/fallback-diagnosis");
        evidenceFallback = unknownFallbackDiagnosis("investigation");
      }
      if (evidenceFallback) {
        fallbacks.push(evidenceFallback);
      }
      appendLedger(opts.task.id, { kind: "evidence", title: `${op} evidence`, detail: `Effort ${level}; provider ${finalProvenance}.`, evidenceIds: [r.id] });
      await trace(opts.task.id, "model_response", `${op} evidence`, `Effort ${level}; provider ${finalProvenance}.`, { provenance: finalProvenance, sourceEvidenceIds: graph.evidence.filter((e) => e.kind === "tool").map((e) => e.id), ...(evidenceFallback ? { fallback: evidenceFallback } : {}) }, opts.onTrace);
      if (target?.kind === "analysis") {
        const step = opts.task.plan?.steps.find((st) => st.id === target.stepId);
        if (step) {
          // Provenance linkage: which retrieved records ground this analysis.
          const memoryRefs = graph.evidence
            .filter((e) => e.kind === "memory")
            .map((e) => `${e.ref}: ${e.note ?? ""}`.slice(0, 500));
          const sourceRecordIds = graph.evidence.filter((e) => e.kind === "memory").map((e) => e.ref);
          step.output = {
            analysis: cleaned.slice(0, 2000),
            provenance: finalProvenance,
            evidenceId: r.id,
            memoryRefs,
            sourceRecordIds,
          };
          step.status = "running";
        }
        graph = markSubgoal(graph, target.id, "succeeded", r.id);
      }
      toolFailed = false;
    } else if (op === "execute_tool") {
      const sg = graph.subgoals.find((s) => s.id === subgoalId) ?? null;
      if (!sg) { toolFailed = true; continue; }
      if (sg.kind === "analysis") { graph = markSubgoal(graph, sg.id, "skipped"); continue; }
      const level = clampToCeiling(sg.effort, opts.ceiling);
      void level;
      if (!recordToolCall(budget)) break;
      graph = markSubgoal(graph, sg.id, "running");
      // Tool name/args come from the existing plan step; reasoning never invents consequential actions.
      const step = opts.task.plan?.steps.find((s) => s.id === sg.stepId);
      if (!step?.action) { graph = markSubgoal(graph, sg.id, "skipped"); continue; }
      const res = await opts.tools.exec({ taskId: opts.task.id, tool: step.action.tool, args: step.action.args });
      provenance.push(res.provenance);
      if (res.needsApproval) { needsApproval = true; pendingApprovalId = res.approvalId ?? null; graph = markSubgoal(graph, sg.id, "pending"); appendLedger(opts.task.id, { kind: "escalation", title: "Approval required", detail: step.action.tool }); await trace(opts.task.id, "approval", "Approval required", step.action.tool, { approvalId: pendingApprovalId }, opts.onTrace); continue; }
      if (!res.ok) {
        toolFailed = true;
        graph = markSubgoal(graph, sg.id, "failed");
        const kind = classifyFailure(res.error ?? "error");
        const sig = { stepId: sg.stepId ?? sg.id, kind, error: res.error ?? "error" };
        if (lastFailureSig && lastFailureSig.stepId === sig.stepId && lastFailureSig.kind === sig.kind && lastFailureSig.error === sig.error) {
          sameSignatureFailures += 1;
        } else {
          lastFailureSig = sig;
          sameSignatureFailures = 0;
        }
        const rec = decideRecovery({ subgoal: { ...sg, attempts: sg.attempts + 1 }, kind, replans, budget, sameSignatureFailures });
        appendLedger(opts.task.id, { kind: "tool_outcome", title: `Tool failed: ${step.action.tool}`, detail: `${res.error} → ${rec.action}: ${rec.reason}` });
        await trace(opts.task.id, "retry", `Tool failed: ${step.action.tool}`, `${res.error} → ${rec.action}: ${rec.reason}`, { tool: step.action.tool, stepId: step.id, outcome: "failed" }, opts.onTrace);
        if (rec.action === "replan" && replans < MAX_REPLANS) { replans += 1; graph = applyReplan(graph, sg.id, `${sg.title} (alternative)`); toolFailed = false; }
        else if (rec.action === "escalate") { graph = { ...graph, blockers: [...graph.blockers, { id: `b${Date.now()}`, reason: rec.reason, subgoalId: sg.id, resolved: false, createdAt: new Date().toISOString() }] }; }
        else if (rec.action === "stop") break;
      } else {
        toolFailed = false; needsApproval = false;
        lastFailureSig = null;
        sameSignatureFailures = 0;
        const r = addEvidence(graph, "tool", step.action.tool, JSON.stringify(res.output)?.slice(0, 300));
        graph = r.graph;
        graph = markSubgoal(graph, sg.id, "succeeded", r.id);
        appendLedger(opts.task.id, { kind: "tool_outcome", title: `Tool ok: ${step.action.tool}`, detail: `Evidence ${r.id}.`, evidenceIds: [r.id] });
        await trace(opts.task.id, "tool_call", `Tool ok: ${step.action.tool}`, `Evidence ${r.id}.`, { tool: step.action.tool, stepId: step.id, evidenceId: r.id, outcome: "ok" }, opts.onTrace);
      }
    } else if (op === "verify") {
      if (!recordModelCall(budget)) break;
      const steps = opts.task.plan?.steps ?? [];
      const v = await verifySteps(steps.length > 0 ? steps : [{ id: "sg-0", title: graph.goal, instruction: graph.goal, status: "pending", requiresApproval: false } as never], graph.goal);
      verificationPassed = v.passed;
      // Evidence-linked completion: mark acceptance satisfied only with real evidence.
      if (v.passed && graph.evidence.length > 0) {
        graph = { ...graph, acceptance: graph.acceptance.map((a) => ({ ...a, satisfied: true as const, evidenceIds: graph.evidence.map((e) => e.id) })) };
      }
      provenance.push(v.passed ? "verifier:evidence-checks" : "verifier:failed");
      appendLedger(opts.task.id, { kind: "verification", title: v.passed ? "Verified" : "Verification failed", detail: v.explanation });
      await trace(opts.task.id, "verification", v.passed ? "Verified" : "Verification failed", v.explanation, undefined, opts.onTrace);
      if (!v.passed && graph.evidence.length === 0) toolFailed = true;
      if (v.passed && acceptanceSatisfied(graph)) break;
      if (!v.passed) { const r = decideRecovery({ subgoal: { id: "verify", title: "verification", instruction: "", kind: "tool", dependsOn: [], status: "failed", effort: "Light", attempts: 1, evidenceIds: [] }, kind: "verification_failed", replans, budget }); if (r.action === "stop" || r.action === "escalate") break; }
    } else if (op === "ask_user" || op === "delegate") {
      appendLedger(opts.task.id, { kind: "escalation", title: op === "ask_user" ? "Escalated to user" : "Delegated", detail: reason });
      break;
    }
    if (acceptanceSatisfied(graph) && verificationPassed === true) break;
  }

  graph = checkpoint(graph, "reasoning-end");
  const outcome: TerminalOutcome = cancelled ? "cancelled" : finalOutcome(graph, verificationPassed);
  const structured = buildStructuredOutcome({
    outcome,
    reason: `Outcome: ${outcome} after ${cycles} cycles.`,
    acceptanceSatisfied: graph.acceptance.filter((a) => a.satisfied === true && a.evidenceIds.length > 0).length,
    acceptanceTotal: graph.acceptance.length,
    evidenceIds: graph.evidence.map((e) => e.id),
    verificationPassed,
    providerProvenance: [...new Set(provenance)],
  });
  appendLedger(opts.task.id, { kind: "transition", title: `Outcome: ${outcome}`, detail: `${cycles} cycles, ${graph.evidence.length} evidence refs.` });
  await trace(opts.task.id, outcome === "completed" || outcome === "partial" ? "completed" : outcome === "blocked" ? "blocked" : outcome === "cancelled" ? "cancelled" : "failure", `Reasoning outcome: ${outcome}`, `${cycles} cycles; evidence: ${graph.evidence.length}; verification: ${String(verificationPassed)}`, { outcome: structured, cycles }, opts.onTrace);
  return { graph, outcome, cycles, ops, budget, provenance: [...new Set(structured.providerProvenance)], pendingApprovalId, cancelled, structured, usage: { promptTokens, completionTokens }, fallbacks };
}
