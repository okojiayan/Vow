import type { MemoryKind } from "./types";

export const MAX_CONTENT_LENGTH = 2000;
const MIN_CONTENT_LENGTH = 1;

const SECRET_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,}['"]?/i,
  /\b(secret|password|passwd|pwd|private[_-]?key|auth[_-]?token|access[_-]?token|bearer)\s*[:=]\s*['"]?\S{4,}['"]?/i,
  /\bsk-(live|test)-[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_\-]{8,}/,
  /\bxox[baprs]-[A-Za-z0-9\-]{8,}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z\-_]{20,}/,
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{16}\b/,
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all )?previous instructions/i,
  /disregard (all )?(prior|previous|system) (instructions|rules|policies)/i,
  /you are now (a|an|in)\b/i,
  /new (system|developer) (instruction|prompt|rule)/i,
  /jailbreak/i,
  /bypass (the )?warden/i,
  /grant (yourself|me) (admin|permission|access)/i,
  /call (the|this|any) tool/i,
];

export type RejectReason =
  | "empty"
  | "too_long"
  | "secret"
  | "memory_disabled";

export interface ValidationResult {
  ok: boolean;
  reason?: RejectReason;
  message?: string;
  sensitive: boolean;
  injectionSuspect: boolean;
}

export function validateCandidate(content: string): ValidationResult {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) {
    return { ok: false, reason: "empty", message: "Memory content is empty.", sensitive: false, injectionSuspect: false };
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      reason: "too_long",
      message: `Memory content exceeds ${MAX_CONTENT_LENGTH} characters.`,
      sensitive: false,
      injectionSuspect: INJECTION_PATTERNS.some((re) => re.test(trimmed)),
    };
  }
  if (SECRET_PATTERNS.some((re) => re.test(trimmed))) {
    return { ok: false, reason: "secret", message: "Content looks like a credential and cannot be stored as ordinary memory.", sensitive: true, injectionSuspect: false };
  }
  return {
    ok: true,
    sensitive: SENSITIVE_PATTERNS.some((re) => re.test(trimmed)),
    injectionSuspect: INJECTION_PATTERNS.some((re) => re.test(trimmed)),
  };
}

const ALLOWED_KINDS: MemoryKind[] = [
  "observation",
  "inference",
  "decision",
  "failure",
  "preference",
  "working",
  "episodic",
  "semantic",
  "project",
  "procedural-learning",
];

export function normalizeKind(kind: unknown): MemoryKind | null {
  return typeof kind === "string" && (ALLOWED_KINDS as string[]).includes(kind) ? (kind as MemoryKind) : null;
}

/** Deterministic normalisation: trim, collapse whitespace, keep meaning. */
export function normaliseContent(content: string): string {
  return content.trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

export function contentFingerprint(content: string): string {
  return normaliseContent(content).toLowerCase();
}
