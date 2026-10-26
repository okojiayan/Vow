// One-shot: void approvals (pending or approved-but-unconsumed) whose task is
// cancelled. Run: node scripts/migrate-orphan-approvals.mjs [dataDir]
// Backs up approvals.json to approvals.json.pre-orphan-migration.bak first.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2] ?? "data";
const file = path.join(dir, "approvals.json");
const tasksFile = path.join(dir, "tasks.json");
const backup = path.join(dir, "approvals.json.pre-orphan-migration.bak");
if (!existsSync(backup)) copyFileSync(file, backup);
const approvals = JSON.parse(readFileSync(file, "utf8"));
const tasksRaw = JSON.parse(readFileSync(tasksFile, "utf8"));
const tasks = Array.isArray(tasksRaw) ? tasksRaw : (tasksRaw.tasks ?? []);
const statusOf = new Map(tasks.map((t) => [t.id, t.status]));
const now = new Date().toISOString();
let pending = 0, approved = 0;
const next = approvals.map((a) => {
  if ((a.status === "pending" || a.status === "approved") && statusOf.get(a.taskId) === "cancelled") {
    if (a.status === "pending") pending += 1; else approved += 1;
    return { ...a, status: "cancelled", decidedAt: now, note: "Task cancelled — approval voided by orphan migration." };
  }
  return a;
});
writeFileSync(file, JSON.stringify(next, null, 2));
console.log(`approvals=${approvals.length} cancelledTasks=${[...statusOf.values()].filter(s=>s==="cancelled").length} voidedPending=${pending} voidedApproved=${approved}`);
