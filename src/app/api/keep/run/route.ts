import { currentAdapterName, getAdapter } from "@/core/keep/adapter";
import { checkGate } from "@/core/keep/gate";
import { detectInjection, wrapUntrusted } from "@/core/keep/injection";
import { findRecurring, parseStatementCsv } from "@/core/keep/money";
import { appendReceipt } from "@/core/keep/receipts";
import { getTaskPass, parkAction } from "@/core/keep/task-pass";
import { readFile } from "node:fs/promises";
export const dynamic = "force-dynamic";
// Demo Money task: deterministic detector does the finding; model only explains. Never cancels/pays.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pass = await getTaskPass(body.task_id);
    if (!pass) return Response.json({ error: "pass not found" }, { status: 404 });
    const verdict = await checkGate({ tool: "fs.read", target: "demo/statement_oct.csv" }, pass);
    if (!verdict.allowed) {
      await appendReceipt({ task_id: pass.task_id, action: "block:fs.read", target: "demo/statement_oct.csv", result: "blocked", reversible: false });
      return Response.json({ blocked: true, reason: verdict.reason }, { status: 403 });
    }
    const csv = await readFile("demo/statement_oct.csv", "utf8");
    const inj = detectInjection(csv);
    const rows = parseStatementCsv(csv);
    const recurring = findRecurring(rows);
    if (/(cancel|pay|send)/i.test(body.instruction ?? "")) {
      const parked = await parkAction({ task_id: pass.task_id, action: "money.cancel", consequence: "Cancelling moves money and cannot be undone automatically. It is parked for you to approve." });
      await appendReceipt({ task_id: pass.task_id, action: "block:money.cancel", target: "money", result: "blocked", reversible: false });
      return Response.json({ parked: true, item: parked, recurring, injection: inj });
    }
    const adapter = getAdapter(body.adapter ?? currentAdapterName());
    const wrapped = wrapUntrusted(`Found ${recurring.length} recurring merchants. Top: ${recurring.slice(0, 3).map((r) => `${r.merchant} x${r.count} total $${r.total}`).join("; ")}`, "demo/statement_oct.csv");
    const gen = await adapter.generate(
      [{ role: "user", content: `Summarize these recurring charges for the user. Do not act. Data:\n${wrapped}` }],
      [],
    );
    await appendReceipt({ task_id: pass.task_id, action: "allow:money summarize", target: "demo/statement_oct.csv", result: "success", reversible: false });
    return Response.json({ recurring, explanation: gen.text, adapter: gen.adapter, model: gen.model, usage: gen.usage, latency_ms: gen.latency_ms, injection: inj, note: "VOW only finds and drafts; it never cancels or pays." });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
