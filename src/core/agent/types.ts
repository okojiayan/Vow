export type TaskStatus =
  | "received"
  | "queued"
  | "claimed"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "interrupted"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type StepStatus = "pending" | "awaiting_approval" | "running" | "verified" | "failed" | "skipped" | "blocked";

export type InferenceMode = "live-model" | "heuristic-demo" | "deterministic";

export type TerminalOutcome = "completed" | "partial" | "blocked" | "failed" | "cancelled" | "unverified";

export interface StructuredOutcome {
  outcome: TerminalOutcome;
  reason: string;
  acceptanceSatisfied: number;
  acceptanceTotal: number;
  evidenceIds: string[];
  verificationPassed: boolean | null;
  providerProvenance: string[];
  decidedAt: string;
}

export interface PlannedAction {
  tool: string;
  args: Record<string, unknown>;
  target?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  instruction: string;
  action?: PlannedAction;
  /** True when this step must be completed by provider-backed model analysis of
   *  prior tool evidence (no tool of its own). Set only by the planner. */
  analysis?: boolean;
  /** What the analysis must be grounded in. Set only by the planner; the
   *  verifier enforces it. "tool-rows": sibling run_sql rows. "memory":
   *  retrieved memory records beyond the question text. "workspace": sibling
   *  fs.list entries observed in the workspace. "none": standalone
   *  provider-backed answer (still requires non-empty provider output). */
  expectGrounding?: "tool-rows" | "memory" | "workspace" | "none";
  requiresApproval: boolean;
  status: StepStatus;
  output?: unknown;
  error?: string;
}

export interface AgentPlan {
  summary: string;
  steps: PlanStep[];
  inferenceMode: InferenceMode;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  taskId?: string;
  createdAt: string;
}

export type AutonomyRequest = "supervised" | "assisted" | "autonomous";

export interface AgentTask {
  id: string;
  conversationId: string;
  request: string;
  status: TaskStatus;
  plan: AgentPlan | null;
  currentStepId: string | null;
  pendingApprovalId: string | null;
  resultSummary: string | null;
  verification: {
    passed: boolean | null;
    explanation: string;
    evidence: unknown[];
  } | null;
  error: string | null;
  inferenceMode: InferenceMode;
  autonomyMode: AutonomyRequest | null;
  queuedAt: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  cancelRequested: boolean;
  cancelReason: string | null;
  attempts: number;
  /** Set for delegated child executions: the delegating parent task id. */
  parentTaskId?: string | null;
  /** When set, execution is restricted to exactly these registered tools. */
  allowedTools?: string[] | null;
  lastHeartbeat: string | null;
  effortCeiling?: import("@/core/reasoning/effort").EffortLevel | null;
  outcome?: StructuredOutcome | null;
  /** Structured provider-fallback diagnoses recorded for this task
   *  (planner stage first, then investigation). Absent when every model
   *  call was provider-backed. Additive: older records simply lack it. */
  providerFallbacks?: import("@/core/traces/trace-types").ProviderFallbackDiagnosis[] | null;
  planLock?: { version: string; approvedAt: string; fingerprints: string[] } | null;
  reasoningRoute?: { route: "quick" | "deep"; reason: string; modelCalls: number; deterministic: boolean } | null;
  usage?: { promptTokens: number; completionTokens: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}
