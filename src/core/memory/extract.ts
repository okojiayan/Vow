import type { MemoryKind } from "./types";

export interface CandidateExtraction {
  /** The fact/event to remember, without the "remember this" wrapper. */
  content: string;
  explicit: boolean;
  temporary: boolean;
  preferenceHint: boolean;
}

const REMEMBER_PREFIXES: RegExp[] = [
  /^\s*(please\s+)?remember\s+(this\s+|that\s+)?[:\-]?\s*/i,
  /^\s*(please\s+)?don't forget\s+[:\-]?\s*/i,
  /^\s*commit\s+to\s+memory\s*[:\-]?\s*/i,
  /^\s*save\s+(this\s+)?(to\s+)?memory\s*[:\-]?\s*/i,
  /^\s*note\s+this\s+down\s*[:\-]?\s*/i,
];

const TEMPORARY_MARKERS: RegExp[] = [
  /\bjust (for|this) (now|once|today|this task|this conversation)\b/i,
  /\bfor now\b/i,
  /\btemporar(y|ily)\b/i,
  /\bthis (once|time only)\b/i,
  /\bdon't (save|remember|store) this\b/i,
];

const PREFERENCE_MARKERS: RegExp[] = [
  /\bi (always|usually|generally|prefer|like|love|hate)\b/i,
  /\bmy (preferred|favourite|favorite|default)\b/i,
  /\bprefer\b/i,
];

const PROJECT_HINTS: RegExp[] = [
  /\bproject\s+([A-Za-z][\w\- ]{1,60})/i,
  /\bthe\s+([A-Za-z][\w\-]+(?:\s+[A-Za-z][\w\-]+)?\s+(?:project|repo|repository|event|hackathon|workshop))\b/i,
  /\bthe\s+([A-Za-z][\w\-]+)\s+(project|repo|repository|event|hackathon)\b/i,
];

const PERSON_HINTS: RegExp[] = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(approved|organised|organized|runs?|leads?|owns?|decided)\b/,
];

/** Deterministic extraction. Never treats source text as instruction. */
export function extractCandidate(message: string): CandidateExtraction | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  let explicit = false;
  let content = trimmed;
  for (const re of REMEMBER_PREFIXES) {
    if (re.test(content)) {
      explicit = true;
      content = content.replace(re, "").trim();
      break;
    }
  }
  if (!explicit) return null;
  if (!content) return null;
  const temporary = TEMPORARY_MARKERS.some((re) => re.test(trimmed));
  const preferenceHint = PREFERENCE_MARKERS.some((re) => re.test(content));
  return { content, explicit, temporary, preferenceHint };
}

export function isTemporaryInstruction(message: string): boolean {
  return TEMPORARY_MARKERS.some((re) => re.test(message));
}

export function suggestedKind(extraction: CandidateExtraction): MemoryKind {
  if (extraction.temporary) return "working";
  if (extraction.preferenceHint) return "preference";
  return "semantic";
}

/** Entity-name hints from prose. Returned as plain strings for dictionary resolution. */
export function suggestEntityNames(content: string): string[] {
  const names = new Set<string>();
  for (const re of PROJECT_HINTS) {
    const match = content.match(re);
    if (match?.[1]) names.add(match[1].trim());
  }
  for (const re of PERSON_HINTS) {
    const match = content.match(re);
    if (match?.[1]) names.add(match[1].trim());
  }
  const quoted = content.match(/"([^"]{2,60})"/g);
  if (quoted) for (const q of quoted) names.add(q.replace(/"/g, "").trim());
  return [...names].filter((n) => n.length >= 2).slice(0, 8);
}

export function taskOutcomeContent(request: string, summary: string): string {
  return `Completed: ${request}. ${summary}`;
}
