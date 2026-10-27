/** Structured failure records + evidence-based classification. */
export type FailureClass =
  | "routing" | "model-quality" | "memory" | "tool-execution" | "policy"
  | "plan-lock" | "approval" | "verification" | "persistence" | "concurrency"
  | "provider-infra" | "harness";

export interface FailureRecord {
  scenarioId: string; expected: string; observed: string;
  route: string; inferenceMode?: string; toolCalls?: Array<{ tool: string; ok: boolean }>;
  status: string; latencyMs: number; failureClass: FailureClass; remediation: string;
}

const REMEDIATION: Record<FailureClass, string> = {
  routing: "Adjust intent classification or deterministic fast-path guards.",
  "model-quality": "Improve planning prompt or deterministic fallback for the class.",
  memory: "Fix retrieval query construction, ranking, or scope handling.",
  "tool-execution": "Fix tool handler, args mapping, or timeout policy.",
  policy: "Correct Warden policy mapping or approval UX messaging.",
  "plan-lock": "Tighten lock comparison or surface the diff to the user.",
  approval: "Fix grant matching, expiry, or replay checks.",
  verification: "Strengthen acceptance criteria or evidence checks.",
  persistence: "Fix store round-trip or receipt durability.",
  concurrency: "Lower ceilings, serialize shared writes, or add backpressure.",
  "provider-infra": "Provider-side; retry with backoff, preserve evidence, do not rescore as capability.",
  harness: "Fix the test expectation or fixture; not a product defect.",
};

export function classifyFailure(input: {
  scenarioId: string; expected: string; observed: string; route: string;
  status: string; latencyMs: number; inferenceMode?: string;
  toolCalls?: Array<{ tool: string; ok: boolean }>;
}): FailureRecord {
  const t = `${input.scenarioId} ${input.observed}`.toLowerCase();
  let failureClass: FailureClass = "harness";
  if (/status .* not in|missing required text/.test(input.observed)) failureClass = /calc|12 times|percent|power|train/i.test(input.scenarioId) ? "routing" : "model-quality";
  if (/denied|approval|expir|replay|forg/i.test(t)) failureClass = "approval";
  if (/lock|scope expansion/.test(t)) failureClass = "plan-lock";
  if (/verif|evidence/.test(t)) failureClass = "verification";
  if (/receipt|persist|recall|stor|forget/.test(t)) failureClass = "memory";
  void REMEDIATION;
  return { ...input, failureClass, remediation: REMEDIATION[failureClass] };
}
