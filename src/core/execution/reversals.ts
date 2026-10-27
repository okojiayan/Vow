import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import { assertSafeWorkspacePath } from "@/core/warden/path-guard";
import { getEnv } from "@/lib/env";
import { scanPayload } from "@/core/warden/leak-check";
import { recordAudit } from "@/core/warden/audit";

export interface ActionReceipt {
  id: string;
  taskId: string;
  /** Plan-step whose action produced this receipt, when known. */
  stepId?: string;
  tool: string;
  target?: string;
  argsRedacted: Record<string, unknown>;
  outcome: "ok" | "denied" | "error" | "blocked";
  reversible: boolean;
  reversalKind?: "delete-created-file" | "restore-backup";
  backupId?: string;
  createdAt: string;
  undone?: boolean;
}

export interface ReversalPreview {
  eligible: Array<{ receiptId: string; tool: string; target?: string }>;
  skipped: Array<{ receiptId: string; reason: string }>;
}

const RECEIPTS = () => dataPath("action-receipts.json");
const BACKUPS = () => dataPath("reversal-backups.json");

type BackupMap = Record<string, string>;

const SECRET_KEY = /key|token|secret|password|authorization|api[_-]?key/i;

export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_KEY.test(k)) { out[k] = "[redacted]"; continue; }
    if (typeof v === "string") {
      let s = v.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
      // Defense in depth: credential/PII patterns inside free-text values
      // (e.g. a file body containing api_key=...) must not reach receipts.
      // leak-check is dependency-free, so a static import cannot cycle.
      try {
        const findings = scanPayload(s);
        if (findings.length > 0) {
          s = `[redacted] [withheld ${findings.map((f) => f.kind).join(",")}: ${findings.map((f) => f.masked).join("; ").slice(0, 200)}]`;
        }
      } catch { /* masking best-effort; key-name redaction above already applied */ }
      out[k] = s.length > 500 ? `${s.slice(0, 500)}…[truncated]` : s;
    } else out[k] = v;
  }
  return out;
}

export const SUPPORTED_REVERSALS = new Set(["notes.create", "fs.write"]);

export function isReversibleTool(tool: string): boolean {
  return SUPPORTED_REVERSALS.has(tool);
}

export async function recordReceipt(input: Omit<ActionReceipt, "id" | "createdAt" | "argsRedacted"> & { args: Record<string, unknown> }): Promise<ActionReceipt> {
  const full: ActionReceipt = {
    id: createId("rcpt"),
    taskId: input.taskId,
    stepId: input.stepId,
    tool: input.tool,
    target: input.target,
    argsRedacted: redactArgs(input.args),
    outcome: input.outcome,
    reversible: input.reversible,
    reversalKind: input.reversalKind,
    backupId: input.backupId,
    createdAt: new Date().toISOString(),
  };
  await mutateJsonFile<ActionReceipt[]>(RECEIPTS(), [], (c) => [full, ...c].slice(0, 500));
  return full;
}

export async function listReceipts(taskId?: string): Promise<ActionReceipt[]> {
  const all = await readJsonFile<ActionReceipt[]>(RECEIPTS(), []);
  return taskId ? all.filter((r) => r.taskId === taskId) : all;
}

export async function captureBackup(backupId: string, content: string | null): Promise<void> {
  await mutateJsonFile<BackupMap>(BACKUPS(), {}, (c) => ({ ...c, [backupId]: content ?? "" }));
}

export async function readBackup(backupId: string): Promise<string | null> {
  const all = await readJsonFile<BackupMap>(BACKUPS(), {});
  if (!(backupId in all)) return null;
  return all[backupId] === "" ? null : all[backupId];
}

export async function undoReceipt(receiptId: string): Promise<{ ok: boolean; reason: string }> {
  const all = await readJsonFile<ActionReceipt[]>(RECEIPTS(), []);
  const r = all.find((x) => x.id === receiptId);
  if (!r) return { ok: false, reason: "Receipt not found." };
  if ((r as ActionReceipt).undone) return { ok: false, reason: "Receipt already undone; refusing double undo." };
  if (!r.reversible || !r.reversalKind) return { ok: false, reason: `Tool "${r.tool}" has no supported reversal; refusing to pretend undo exists.` };
  const workspace = getEnv().VOW_WORKSPACE_DIR;
  try {
    if (r.reversalKind === "delete-created-file" && r.target) {
      const safe = await assertSafeWorkspacePath(workspace, r.target, { mustExist: true });
      const current = await readFile(safe, "utf8").catch(() => null);
      const backup = r.backupId ? await readBackup(r.backupId) : null;
      if (backup !== null && current !== null && backup !== "") {
        return { ok: false, reason: "File changed since creation; refusing to delete a modified file." };
      }
      await unlink(safe);
      await mutateJsonFile<ActionReceipt[]>(RECEIPTS(), [], (current) =>
        current.map((x) => (x.id === r.id ? { ...x, undone: true, reversible: false } : x)),
      );
      await recordAudit({ kind: "execution", taskId: r.taskId, tool: r.tool, decision: "undo", policy: "reversal.delete-created-file", reason: `Undid ${r.id}; deleted ${r.target}.`, outcome: "success", fingerprint: r.id });
      return { ok: true, reason: `Deleted created file ${r.target}.` };
    }
    if (r.reversalKind === "restore-backup" && r.target && r.backupId) {
      const prior = await readBackup(r.backupId);
      const safe = await assertSafeWorkspacePath(workspace, r.target);
      if (prior === null) {
        // File did not exist before: remove it if it still matches post-state is unknown → refuse unless it exists and we created it.
        await unlink(safe).catch(() => undefined);
      await mutateJsonFile<ActionReceipt[]>(RECEIPTS(), [], (current) =>
        current.map((x) => (x.id === r.id ? { ...x, undone: true, reversible: false } : x)),
      );
        await recordAudit({ kind: "execution", taskId: r.taskId, tool: r.tool, decision: "undo", policy: "reversal.restore-backup", reason: `Undid ${r.id}; removed ${r.target} (no prior content).`, outcome: "success", fingerprint: r.id });
        return { ok: true, reason: `Removed ${r.target}; no prior content existed.` };
      }
      await mkdir(path.dirname(safe), { recursive: true });
      await writeFile(safe, prior, "utf8");
      await mutateJsonFile<ActionReceipt[]>(RECEIPTS(), [], (current) =>
        current.map((x) => (x.id === r.id ? { ...x, undone: true, reversible: false } : x)),
      );
      await recordAudit({ kind: "execution", taskId: r.taskId, tool: r.tool, decision: "undo", policy: "reversal.restore-backup", reason: `Undid ${r.id}; restored ${r.target} from recorded pre-state.`, outcome: "success", fingerprint: r.id });
      return { ok: true, reason: `Restored ${r.target} from pre-state.` };
    }
    return { ok: false, reason: "Unsupported reversal configuration." };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function previewRewind(taskId: string, sinceIso: string): Promise<ReversalPreview> {
  const all = (await listReceipts(taskId)).filter((r) => r.createdAt >= sinceIso && r.outcome === "ok");
  const eligible: ReversalPreview["eligible"] = [];
  const skipped: ReversalPreview["skipped"] = [];
  for (const r of all) {
    if (r.reversible && r.reversalKind) eligible.push({ receiptId: r.id, tool: r.tool, target: r.target });
    else skipped.push({ receiptId: r.id, reason: `Tool "${r.tool}" is irreversible or unverified; excluded.` });
  }
  return { eligible, skipped };
}

export async function rewindSince(taskId: string, sinceIso: string): Promise<{ undone: string[]; failed: Array<{ id: string; reason: string }>; skipped: Array<{ id: string; reason: string }> }> {
  const preview = await previewRewind(taskId, sinceIso);
  // Safe reverse order: newest first (listReceipts returns newest first already).
  const undone: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const item of preview.eligible) {
    const res = await undoReceipt(item.receiptId);
    if (res.ok) undone.push(item.receiptId);
    else failed.push({ id: item.receiptId, reason: res.reason });
  }
  return { undone, failed, skipped: preview.skipped.map((s) => ({ id: s.receiptId, reason: s.reason })) };
}
