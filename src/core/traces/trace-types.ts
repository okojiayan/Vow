export type TraceEventKind =
  | "task_received"
  | "task_queued"
  | "task_claimed"
  | "planning"
  | "memory"
  | "plan_ready"
  | "model_request"
  | "model_response"
  | "tool_call"
  | "policy_decision"
  | "approval"
  | "verification"
  | "retry"
  | "failure"
  | "completed"
  | "blocked"
  | "cancelled"
  | "cancellation_requested"
  | "interrupted"
  | "recovered"
  | "worker_heartbeat";

export interface TraceEvent {
  id: string;
  taskId: string;
  kind: TraceEventKind;
  title: string;
  detail: string;
  data?: unknown;
  createdAt: string;
}

export interface ExecutionTrace {
  taskId: string;
  events: TraceEvent[];
}

/** Optional structured links for tool-execution traceability.
 *  All fields are optional: historical events predate them and remain valid.
 *  Consumers must handle their absence. IDs are never fabricated: a field is
 *  present only when the emitter actually knew the identifier. */
export interface ToolDispatchData {
  tool: string;
  args?: Record<string, unknown>;
  target?: string;
  /** Plan-step that authorized this invocation. */
  stepId?: string;
}

export interface ToolOutcomeData {
  tool: string;
  /** Plan-step whose action executed. */
  stepId?: string;
  /** Reasoning-graph evidence id recording this invocation's output. */
  evidenceId?: string;
  outcome: "ok" | "failed";
}

/** Pipeline stage where a provider-backed model call was replaced by a
 *  heuristic fallback (or deliberately not attempted). */
export type ProviderFallbackStage = "planner" | "investigation";

/** Controlled reason categories for a provider fallback. `unknown` is the
 *  safe default when no failure metadata is available; it must never be
 *  read as success. `deliberate_heuristic_route` marks a planner-selected
 *  heuristic route after a successful provider call (no provider failure). */
export type ProviderFallbackReason =
  | "timeout"
  | "http_error"
  | "network_error"
  | "parse_error"
  | "empty_response"
  | "not_configured"
  | "deliberate_heuristic_route"
  | "unknown";

/** Minimal structured diagnosis for a model-call fallback event.
 *  All fields except stage/reason are optional and recorded only when the
 *  emitter genuinely knew them. Never carries credentials, authorization
 *  headers, request bodies, prompts, or provider response bodies. */
export interface ProviderFallbackDiagnosis {
  stage: ProviderFallbackStage;
  reason: ProviderFallbackReason;
  /** Wall-clock duration of the failed model call, when measured. */
  elapsedMs?: number;
  /** HTTP status when the provider responded with an error status. */
  httpStatus?: number;
  /** Sanitized Meterless result code (timeout/unavailable/...), when known. */
  code?: string;
  /** True when the provider returned a response (even an error/empty one);
   *  false when the call failed before any response. */
  responded?: boolean;
  /** Configured model that was attempted. Never a secret. */
  modelExpected?: string;
  /** Provider-confirmed model identity. Recorded only when the provider
   *  actually returned one; never inferred. */
  modelReturned?: string;
  /** Short constructed summary. Never copies raw error text or bodies. */
  detail?: string;
}
