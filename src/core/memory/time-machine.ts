import { getMemory } from "./store-ops";
import { saveMemories } from "./source-store";
import { listMemories } from "./source-store";
import { recordAudit } from "@/core/warden/audit";

export interface VersionView {
  version: number;
  content: string;
  updatedAt: string;
  current: boolean;
}

/** Historical values as VOW believed them, with the live value marked. */
export async function history(id: string, accountId = "local"): Promise<{ recordId: string; status: string; versions: VersionView[]; currentContent: string }> {
  const record = await getMemory(id, accountId);
  if (!record) throw new Error("Memory not found.");
  const versions: VersionView[] = record.versions.map((v, i) => ({
    version: v.version,
    content: v.content,
    updatedAt: v.updatedAt,
    current: i === record.versions.length - 1,
  }));
  return { recordId: id, status: record.status ?? "active", versions, currentContent: record.content };
}

export interface RevertOutcome {
  ok: boolean;
  reason: string;
}

/**
 * Revert creates a NEW version with the historical content; history is never
 * rewritten. Refuses when newer changes exist unless force is explicitly set
 * with a recorded reason — a silent overwrite is never performed.
 */
export async function revertToVersion(id: string, version: number, opts: { accountId?: string; force?: boolean; reason?: string } = {}): Promise<RevertOutcome> {
  const accountId = opts.accountId ?? "local";
  const record = await getMemory(id, accountId);
  if (!record) return { ok: false, reason: "Memory not found." };
  if ((record.status ?? "active") === "deleted") return { ok: false, reason: "Memory was forgotten; historical content is unrecoverable by design. Revert refused." };
  const target = record.versions.find((v) => v.version === version);
  if (!target) return { ok: false, reason: `Version ${version} does not exist.` };
  const latest = record.versions[record.versions.length - 1];
  if (latest.content !== record.content) {
    // Store drifted outside the version chain; refuse silently overwriting it.
    if (!opts.force) return { ok: false, reason: "Newer changes exist outside the selected version. Revert refused; re-run with explicit force and a recorded reason." };
  } else if (latest.version !== version && !opts.force && record.versions.length > 1) {
    // There are newer versions than the target: require explicit force so the
    // operator acknowledges overwriting intermediate changes.
    if (!opts.force) return { ok: false, reason: `Version ${version} is not the latest (latest is ${latest.version}). Revert refused; confirm with force to supersede intermediate changes.` };
  }
  if (opts.force && !opts.reason) return { ok: false, reason: "Forced revert requires a recorded reason." };
  const now = new Date().toISOString();
  const all = await listMemories();
  const next = all.map((item) =>
    item.id === id
      ? { ...item, content: target.content, updatedAt: now, versions: [...item.versions, { version: item.versions.length + 1, content: target.content, updatedAt: now }] }
      : item,
  );
  await saveMemories(next);
  await recordAudit({
    kind: "execution",
    taskId: "memory",
    tool: "memory.revert",
    decision: opts.force ? "force-revert" : "revert",
    policy: "time-machine.revert",
    reason: `Reverted to version ${version}${opts.force ? ` (forced: ${opts.reason})` : ""}.`,
    outcome: "success",
    fingerprint: id,
  });
  return { ok: true, reason: `Reverted to version ${version}; recorded as version ${record.versions.length + 1}.` };
}

export interface ForgetOutcome {
  ok: boolean;
  reason: string;
}

/**
 * Explicit deletion semantics: content, keywords, entities, evidence excerpts,
 * access metadata, and every version body are irreversibly redacted in all
 * stores under VOW's control. The audit trail keeps a content-free tombstone
 * only. Dictionary entries shared with other memories are left intact, but
 * this record's links to them are removed so aliases cannot resurrect it.
 * Conversation-history pairs are a separate store (chat log, not memory) and
 * are called out as an external limitation, not silently claimed.
 */
const TOMBSTONE = "[forgotten at user request — content removed]";

export async function forgetMemory(id: string, opts: { accountId?: string; by?: string } = {}): Promise<ForgetOutcome> {
  const accountId = opts.accountId ?? "local";
  const all = await listMemories();
  const record = all.find((item) => item.id === id && (item.accountId ?? "local") === accountId);
  if (!record) return { ok: false, reason: "Memory not found." };
  const now = new Date().toISOString();
  const next = all.map((item) =>
    item.id === id
      ? {
          ...item,
          content: TOMBSTONE,
          keywords: [],
          entities: [],
          entityLinks: [],
          evidence: item.evidence ? { ...item.evidence, excerpt: TOMBSTONE } : item.evidence,
          versions: item.versions.map((v) => ({ ...v, content: TOMBSTONE })),
          status: "deleted" as const,
          verificationStatus: "unverified" as const,
          lastAccessedAt: undefined,
          supersededBy: undefined,
          conflictWith: [],
          updatedAt: now,
        }
      : item,
  );
  await saveMemories(next);
  await recordAudit({
    kind: "execution",
    taskId: "memory",
    tool: "memory.forget",
    decision: "forgotten",
    policy: "forget.tombstone",
    reason: `Memory forgotten at user request${opts.by ? ` by ${opts.by}` : ""}. Content redacted in all VOW-controlled stores.`,
    outcome: "success",
    fingerprint: id,
  });
  return {
    ok: true,
    reason: "Forgotten. Content, keywords, entities, links, excerpts, access metadata, and version bodies were removed from VOW-controlled stores. Limitation: conversation-history pairs (chat log, not memory) and external backups may still quote the text; dictionary entries shared with other memories were left intact but unlinked.",
  };
}
