// Sensitive-data detection for the outbound boundary. Regex-first triage with
// explicit honesty limits: this does not claim complete PII protection.
export type LeakKind = "aadhaar" | "pan" | "bank-account" | "ifsc" | "card" | "credential";

export interface LeakFinding {
  kind: LeakKind;
  masked: string;
}

const PATTERNS: Array<{ kind: LeakKind; re: RegExp; mask: (m: string) => string }> = [
  { kind: "aadhaar", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, mask: (m) => `${m.replace(/\D/g, "").slice(0, 2)}•• •••• ••${m.replace(/\D/g, "").slice(-2)} (Aadhaar-like)` },
  { kind: "pan", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, mask: (m) => `${m.slice(0, 2)}•••${m.slice(5, 9)}• (PAN-like)` },
  { kind: "ifsc", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, mask: (m) => `${m.slice(0, 4)}•••••• (IFSC-like)` },
  { kind: "bank-account", re: /\b\d{9,18}\b/g, mask: (m) => `••••${m.slice(-4)} (account-like)` },
  { kind: "card", re: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, mask: () => "•••• •••• •••• •••• (card-like)" },
  { kind: "credential", re: /(api[_-]?key|secret|password|passwd|pwd|private[_-]?key|auth[_-]?token|access[_-]?token|bearer|sk-(live|test)-[A-Za-z0-9]+|sk-[A-Za-z0-9_\-]{6,}|xox[baprs]-[A-Za-z0-9-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/gi, mask: () => "[credential-like — value withheld]" },
];

function maskAmbig(kind: LeakKind, m: string): string {
  const p = PATTERNS.find((x) => x.kind === kind);
  return p ? p.mask(m) : "[sensitive — withheld]";
}

export function scanPayload(raw: unknown): LeakFinding[] {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  const findings: LeakFinding[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = p.re.exec(text)) !== null && guard++ < 20) {
      const value = m[0];
      // Guard against obvious non-secrets: short digit runs inside words are
      // handled by \b; skip bank-account hits that are part of card hits.
      if (p.kind === "bank-account" && /(?:\d{4}[\s-]?){3}\d{4}/.test(value)) continue;
      findings.push({ kind: p.kind, masked: maskAmbig(p.kind, value) });
      if (m.index === p.re.lastIndex) p.re.lastIndex += 1;
    }
  }
  return findings;
}

/** Outbound verdict: network-bound payloads carrying leaks are blocked;
 *  non-network findings are redacted at the receipt/audit layer (handled by
 *  the caller). Explanations never echo the raw value. */
export function outboundVerdict(tool: string, findings: LeakFinding[]): { action: "allow" | "block"; reason?: string } {
  if (findings.length === 0) return { action: "allow" };
  const kinds = [...new Set(findings.map((f) => f.kind))].join(", ");
  const masked = findings.map((f) => f.masked).join("; ");
  if (tool === "http.fetch" || /^send|^pay|external/i.test(tool)) {
    return { action: "block", reason: `Outbound payload blocked: detected ${kinds}. Evidence: ${masked}. Remove the sensitive value or confirm an approved redacted path.` };
  }
  return { action: "allow", reason: `Local payload contains ${kinds}; recorded redacted (${masked}).` };
}
