import type { StructuredOutcome, TaskStatus, TerminalOutcome } from "@/core/agent/types";

export type { TerminalOutcome };

/** Honest mapping from the reasoning outcome to a legal TaskStatus.
 *  partial → completed: execution finished and real evidence exists; the
 *  summary and StructuredOutcome state the shortfall explicitly.
 *  unverified → failed: success must never be claimed without verification.
 *  Every branch is a transition the state machine already permits. */
export function taskStatusForOutcome(outcome: TerminalOutcome): TaskStatus {
  switch (outcome) {
    case "completed":
    case "partial":
      return "completed";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "unverified":
      return "failed";
  }
}

export function buildStructuredOutcome(args: {
  outcome: TerminalOutcome;
  reason: string;
  acceptanceSatisfied: number;
  acceptanceTotal: number;
  evidenceIds: string[];
  verificationPassed: boolean | null;
  providerProvenance: string[];
}): StructuredOutcome {
  return { ...args, decidedAt: new Date().toISOString() };
}
