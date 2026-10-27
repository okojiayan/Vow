export interface TraceEventLike {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
}

export interface ActivitySummary {
  toolCalls: number;
  plans: number;
  verifications: number;
  denials: number;
  headline: string;
  subline: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function summarizeActivity(
  events: TraceEventLike[],
  audit: Array<{ decision: string }>,
  status: string | null,
): ActivitySummary {
  let toolCalls = 0;
  let plans = 0;
  let verifications = 0;
  for (const e of events) {
    if (e.kind === "tool_call") toolCalls += 1;
    else if (e.kind === "planning" || e.kind === "plan_ready") plans += 1;
    else if (e.kind === "verification") verifications += 1;
  }
  const denials = audit.filter((a) => a.decision === "deny").length;
  const done = status !== null && TERMINAL.has(status);
  const label = status ? status.replace(/_/g, " ") : "idle";
  const headline = events.length === 0 && !status
    ? "No activity yet"
    : done
      ? `Run ${label} · ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`
      : `Working · ${label} · ${toolCalls} tool call${toolCalls === 1 ? "" : "s"} so far`;
  const parts: string[] = [];
  if (verifications > 0) parts.push("verified");
  else if (done) parts.push("unverified");
  if (denials > 0) parts.push(`${denials} denied`);
  const subline = parts.length ? parts.join(" · ") : plans > 0 ? "plan ready" : "waiting for plan";
  return { toolCalls, plans, verifications, denials, headline, subline };
}
