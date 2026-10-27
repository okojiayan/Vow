import path from "node:path";
import { isPassExpired, type TaskPass } from "./task-pass";
import { isKilled } from "./task-pass";

export interface GateCall {
  tool: string;
  target?: string;
  args?: Record<string, unknown>;
}

export interface GateVerdict {
  allowed: boolean;
  reason: string;
  parked?: boolean;
}

const IRREVERSIBLE = new Set(["pay", "cancel", "send", "fs.delete", "money.pay", "money.cancel", "money.send"]);

function canonicalize(p: string): string {
  // Normalize separators, resolve .. lexically, reject null bytes, UNC, encoded tricks.
  if (p.includes("\0")) throw new Error("Null byte in path.");
  let v = p.replace(/\\/g, "/").trim();
  if (v.startsWith("\\\\") || v.startsWith("//")) throw new Error("UNC paths are not allowed.");
  try {
    v = decodeURIComponent(v);
    if (/[%<>:"|?*]/.test(v) && v.includes("%")) throw new Error("Encoded path trick.");
  } catch {
    // if decode fails, keep original and continue checks
  }
  if (path.isAbsolute(v)) throw new Error("Absolute paths are not allowed. Use a workspace-relative path.");
  const norm = path.posix.normalize(v);
  if (norm === ".." || norm.startsWith("../") || norm.includes("\0")) throw new Error("Path escapes the allowlisted workspace.");
  return norm;
}

function insideAny(candidate: string, roots: string[]): boolean {
  const c = canonicalize(candidate);
  for (const r of roots) {
    const root = canonicalize(r === "" ? "." : r);
    if (c === root || c.startsWith(root === "." ? "" : `${root}/`) || root === ".") return true;
  }
  return false;
}

export async function checkGate(call: GateCall, pass: TaskPass): Promise<GateVerdict> {
  if (await isKilled(pass.task_id)) return { allowed: false, reason: "Kill switch active for this task." };
  if (pass.revoked) return { allowed: false, reason: "Task pass revoked." };
  if (isPassExpired(pass)) return { allowed: false, reason: "Task pass expired." };
  if (IRREVERSIBLE.has(call.tool)) {
    return { allowed: false, parked: true, reason: `Irreversible action "${call.tool}" is never executed directly; it is parked for explicit approval in every mode.` };
  }
  if (pass.mode === "turbo") return { allowed: true, reason: "Turbo mode enforces nothing else (unprotected baseline); hard irreversible block still applies." };
  if (!pass.allowed_actions.includes(call.tool)) {
    return { allowed: false, reason: `Tool "${call.tool}" is not in the Task Pass allowlist.` };
  }
  if (call.tool === "http.fetch" && !pass.network) {
    return { allowed: false, reason: "Network is disabled for this Task Pass." };
  }
  if (call.target && (call.tool.startsWith("fs.") || call.tool === "run_sql" || call.tool.startsWith("money."))) {
    const roots = [...pass.allowed_read_paths, ...pass.allowed_write_paths];
    try {
      if (!insideAny(call.target, roots.length ? roots : ["demo/sandbox"])) {
        return { allowed: false, reason: `Target "${call.target}" is outside the allowed roots.` };
      }
    } catch (e) {
      return { allowed: false, reason: e instanceof Error ? e.message : "Path check failed." };
    }
  }
  return { allowed: true, reason: "Allowed by Task Pass." };
}
