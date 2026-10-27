import { detectInjection } from "@/core/keep/injection";

export interface UntrustedCheck {
  flagged: boolean;
  reasons: string[];
  safeText: string;
}

export function screenUntrusted(raw: unknown, source: string): UntrustedCheck {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";
  const found = detectInjection(text);
  if (!found.matched) return { flagged: false, reasons: [], safeText: text };
  // Preserve factual content shape but mark clearly; the planner context
  // builder must treat this block as data only.
  return {
    flagged: true,
    reasons: found.reasons,
    safeText: `<untrusted-data source="${source}" blocked-instructions="flagged:${found.reasons.join(",")}">\n${text.slice(0, 4000)}\n</untrusted-data>`,
  };
}
