import type { PlanStep } from "@/core/agent/types";

/**
 * Deterministic evidence-grounding helpers (F3).
 *
 * General-purpose utilities over sibling tool outputs. No benchmark IDs,
 * prompts, or expected answers are referenced here: all computation is over
 * the actual rows/records supplied in the current task's plan steps.
 */

export interface ToolRows {
  rows: unknown[][];
  rowCount: number;
  columns: string[];
  sql: string;
}

/** Parse the projected column list of a simple SELECT (generic, not table-specific). */
export function parseSelectColumns(sql: string): string[] {
  const match = sql.match(/^\s*select\s+(.+?)\s+from\s/i);
  if (!match) return [];
  const list = match[1].trim();
  if (list === "*") return [];
  return list.split(",").map((column) =>
    column
      .trim()
      .split(/\s+as\s+/i)
      .pop()!
      .replace(/["`]/g, "")
      .split(".")
      .pop()!
      .trim(),
  ).filter(Boolean);
}

/** Collect every run_sql row array across sibling steps (record boundaries preserved). */
export function collectToolRows(steps: PlanStep[]): ToolRows {
  const rows: unknown[][] = [];
  let sql = "";
  let columns: string[] = [];
  let rowCount = 0;
  for (const step of steps) {
    if (step.action?.tool !== "run_sql") continue;
    const out = step.output as { rows?: unknown; rowCount?: unknown; sql?: unknown } | null | undefined;
    if (!out || !Array.isArray(out.rows)) continue;
    if (typeof out.sql === "string" && !sql) {
      sql = out.sql;
      columns = parseSelectColumns(out.sql);
    }
    for (const row of out.rows) {
      if (Array.isArray(row)) rows.push(row);
    }
    if (typeof out.rowCount === "number" && Number.isInteger(out.rowCount)) {
      rowCount = Math.max(rowCount, 0);
    }
  }
  // rowCount is the observed number of row arrays; callers compare against the
  // tool-reported rowCount separately in checkToolOutput. Here rowCount means
  // what the verifier can actually inspect.
  rowCount = rows.length;
  return { rows, rowCount, columns, sql };
}

/** Value frequencies for one column index (deterministic counting, no model judgment). */
export function columnFrequencies(rows: unknown[][], colIndex: number): Map<string, number> {
  const freq = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[colIndex] ?? "").trim().toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return freq;
}

/** All column-value frequencies (used to validate count claims without model counting). */
export function allFrequencies(rows: unknown[][]): number[] {
  if (rows.length === 0 || rows[0].length === 0) return [];
  const out: number[] = [];
  const width = rows[0].length;
  for (let c = 0; c < width; c += 1) {
    for (const n of columnFrequencies(rows, c).values()) out.push(n);
  }
  return out;
}

/**
 * Deterministic aggregate lines for a row set. Generic: row count plus
 * per-column value frequencies for low-cardinality columns only.
 * Bounded: at most 8 columns, distinct values capped at 10 per column.
 */
export function deterministicAggregateLines(toolRows: ToolRows): string[] {
  const { rows, rowCount, columns } = toolRows;
  const lines = [`Deterministic count: ${rowCount} row(s) observed.`];
  if (rows.length === 0 || rows[0].length === 0) return lines;
  const width = Math.min(rows[0].length, 8);
  for (let c = 0; c < width; c += 1) {
    const freq = columnFrequencies(rows, c);
    if (freq.size === 0 || freq.size > 10) continue;
    const name = columns[c] ?? `column_${c + 1}`;
    const parts = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([value, n]) => `'${value}' ×${n}`)
      .join(", ");
    lines.push(`Column '${name}': ${parts}.`);
  }
  return lines;
}

export interface CountClaim {
  value: number;
  label: string;
  raw: string;
}

/**
 * Extract explicit count claims from analysis text (generic phrasing, no
 * benchmark vocabulary): "N rows/records/results", "N <word>", and
 * "Rows returned: N" style lines. Numbers that are clearly measurements,
 * versions, or identifiers (decimals, years, v-prefixed) are ignored.
 */
export function extractCountClaims(text: string): CountClaim[] {
  const claims: CountClaim[] = [];
  const push = (value: number, label: string, raw: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 100000) return;
    claims.push({ value, label: label.toLowerCase(), raw });
  };
  const rowLine = text.match(/rows?\s+returned\s*:\s*(\d+)/i);
  if (rowLine) push(Number(rowLine[1]), "rows returned", rowLine[0]);
  const re = /(\d+)\s+(rows?|records?|results?|abilities|items|entries|hidden|visible|primary|active|inactive|not hidden|not|total)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Skip decimals ("1.8") and larger identifiers: require the digit run to
    // stand alone. A trailing sentence period is fine; only a dot that is
    // itself attached to another digit (a decimal point) disqualifies.
    const before = text[m.index - 1] ?? "";
    const beforeBefore = text[m.index - 2] ?? "";
    const after = text[m.index + m[0].length] ?? "";
    const afterAfter = text[m.index + m[0].length + 1] ?? "";
    if (/\d/.test(before)) continue;
    if (before === "." && /\d/.test(beforeBefore)) continue;
    if (/\d/.test(after)) continue;
    if (after === "." && /\d/.test(afterAfter)) continue;
    push(Number(m[1]), m[2], m[0]);
  }
  return claims;
}

/**
 * Verify every count claim against observed rows. A claim passes when it
 * equals the inspected row count or one of the observed per-column value
 * frequencies (a partition count such as "1 hidden" out of 2 rows).
 * Anything else is an invented or miscounted claim.
 */
export function verifyCountClaims(
  text: string,
  rows: unknown[][],
): { ok: boolean; reason: string } {
  const claims = extractCountClaims(text);
  if (claims.length === 0) return { ok: true, reason: "No explicit count claims to verify." };
  const rowCount = rows.length;
  const freqs = new Set(allFrequencies(rows));
  for (const claim of claims) {
    if (claim.value === rowCount) continue;
    if (freqs.has(claim.value)) continue;
    return {
      ok: false,
      reason: `Count claim "${claim.raw}" (${claim.value}) matches neither the observed row count (${rowCount}) nor any observed column-value frequency (${[...freqs].sort((a, b) => a - b).join(", ") || "none"}).`,
    };
  }
  return { ok: true, reason: `All ${claims.length} count claim(s) match observed rows.` };
}

/** Honest-empty phrasing: the only acceptable content when no rows were observed. */
export function statesEmpty(text: string): boolean {
  return /no rows|empty|none found|zero rows|no results|not found|no (matching|relevant) (rows|records|results)/i.test(text);
}
