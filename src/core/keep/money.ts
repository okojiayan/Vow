// Deterministic recurring-charge detector (pure code). The model only writes explanations.
export interface StatementRow {
  date: string;
  merchant: string;
  amount: number;
  memo?: string;
}

export interface RecurringGroup {
  merchant: string;
  count: number;
  avg_amount: number;
  total: number;
  unused_hint: boolean;
}

export function parseStatementCsv(csv: string): StatementRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines.shift() ?? "").split(",").map((s) => s.trim().toLowerCase());
  const di = header.indexOf("date");
  const mi = header.indexOf("merchant");
  const ai = header.indexOf("amount");
  const moi = header.indexOf("memo");
  return lines.filter(Boolean).map((line) => {
    // simple CSV split (demo data has no quoted commas)
    const cols = line.split(",").map((s) => s.trim());
    return {
      date: cols[di] ?? "",
      merchant: cols[mi] ?? "",
      amount: Number(cols[ai] ?? 0),
      memo: moi >= 0 ? cols[moi] : undefined,
    };
  });
}

export function findRecurring(rows: StatementRow[], minCount = 2): RecurringGroup[] {
  const by = new Map<string, StatementRow[]>();
  for (const r of rows) {
    const key = r.merchant.toLowerCase();
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(r);
  }
  const out: RecurringGroup[] = [];
  for (const [merchant, list] of by) {
    if (list.length < minCount) continue;
    const total = list.reduce((s, r) => s + r.amount, 0);
    const avg = total / list.length;
    // unused hint: same amount repeating + memo mentions trial/unused/free
    const memoText = list.map((r) => r.memo ?? "").join(" ").toLowerCase();
    const unused_hint = /trial|unused|free|forgot|cancel/i.test(memoText);
    out.push({ merchant, count: list.length, avg_amount: Math.round(avg * 100) / 100, total: Math.round(total * 100) / 100, unused_hint });
  }
  return out.sort((a, b) => b.total - a.total);
}
