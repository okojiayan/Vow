# Phase 1 — Core Trust Foundation

## Autonomy modes (conservative, enforced)
- Manual → supervised: consequential actions require approval.
- Smart Use → assisted: routine in-scope work flows; scope expansion pauses for approval.
- Turbo → autonomous: runs independently BUT hard denials still apply (shell.exec denied, irreversible cancel/pay/send parked, never executed directly). Turbo is the unprotected baseline for reads, not a bypass for destruction. Risky use requires reviewing risks first.
- Warden → autonomous + evidence-first surfacing and strict scope enforcement UI.
- Enforcement lives at `executeTool → authorizeTool` for main tools, delegated subagents (tool-scope allowlist), skills (`skills/invoke` uses `executeTool` with task mode), and plugin tools via the same registry. Mode changes are audit-logged (`mode.change`) and never override an explicit denial.

## Task Pass + Blast Radius
- `buildTaskPass(task, plan)` uses the real planned actions: objective, per-action tool/target/redacted args summary/risk/reversibility, read/write scopes from targets, network effects from `http.fetch`, required approvals from `requiresApproval` steps, expected changes, uncertainties (unknown-risk tools, unverified network outcomes).
- `blastRadiusForPass`: score from destructive/shell presence (+50), network (+25), write scopes (+10..25), irreversible-without-undo (+5 each, cap 15), indexed file count (+0..10). Levels: ≥50 high, ≥20 medium, else low. Missing data is explicit (e.g. workspace file count unavailable) — never false precision. The indicator informs; enforcement stays in the gate.
- Served at `GET /api/warden/pass?taskId=` and surfaced in Task Inspector (plan version + link).

## Plan Lock
- `lockPlanVersion(plan)` hashes canonical plan; stored on task at plan time (`task.planLock`) and traced (`Task Pass locked`).
- `checkAgainstLock` runs before each consequential tool step: new fingerprints or version drift → blocked with reason, audit `plan-lock.deviation`, step marked blocked. Approval `consumeMatchingApproval` still requires exact fingerprint + same task + TTL, so replay across tasks/plans fails.

## Hidden instructions / refusal ledger / parked / kill
- Tool/subagent/plugin/file/row output is screened (`screenUntrusted` over Keep detector patterns); flagged output is kept as `<untrusted-data>` data, logged (`untrusted.hidden-instruction`), and never expands permissions.
- Refusals are real audit events (`outcome: blocked`), listed at `/api/keep/refusals`.
- Parked queue (`keep-parked.json` + approvals TTL 15min): irreversible or out-of-scope waits with consequence text; approve/deny/expiry/cancel supported; resume revalidates exact fingerprint + task state; one approval never covers unrelated actions.
- Kill: `requestCancellation` (queue) + Keep `killTask` revoke; `checkGate` and orchestrator re-check `cancelRequested` before planning, between steps, and in skill budgets. Reset requires explicit recommit (new run); reversal of completed external actions is never claimed.

## Receipts / Undo / Rewind (honest subset)
- Every authorized execution records a receipt (`action-receipts.json`) with redacted args, outcome, reversibility, and backup id. Secrets (`key|token|secret|password|authorization|api-key`, `Bearer …`) are redacted at write time.
- Supported: `notes.create` → delete-created-file (refuses if file changed since creation); `fs.write` → restore-backup from recorded pre-state. Everything else is non-reversible by design and `undo` refuses explicitly.
- Rewind = preview (eligible vs excluded with reasons) → confirm → reverse-order execution → per-item undone/failed/skipped report. Partial results are reported truthfully; full rewind is never claimed when items fail or are excluded.

## Model adapter (Phase 1 guardrails)
- `src/core/keep/adapter.ts`: `mock` (deterministic tests/local dev only, never labeled live) and `nvidia` (real Meterless/Nemotron, auth from env, timeouts/unavailable/malformed surfaced truthfully with usage+latency). `llama`/`gemini` classes exist but `getAdapter`/`currentAdapterName` reject them as not approved in Phase 1. Calc fast path still bypasses model calls for supported math.

## GUI + mascot
- Required states served by real data: idle/chat, active/working, monitor drawer (optional, toggleable, never steals workspace), approval/parked view (conversation + Warden panel), completed receipt view (`/api/receipts`), failed/blocked/partial/unverified states from the task lifecycle (never conflated), sidebar collapse, responsive layouts.
- Correctness: approvals render from backend grants (no pre-granted display), completion only from terminal task status, waiting/denied/unverified always explained via reason + policy, Task Pass + blast + receipts linked from the inspector.
- Warden transformation is now an explicit machine (`entering-ring → entering-orb → entering-wave → done`, `exiting-dissolve → exiting-return → done`): anchored mascot, reduced-motion/skip/Escape bypass, rapid toggles collapse to latest intent, asset failure hides image without touching policy, visuals never gate enforcement.

## Gaps (not claimed)
- No OS-level sandbox; enforcement is logical (path canonicalization, allowlists, approvals). A compromised server process is outside this boundary.
- Undo covers only the two local operations above; no generic undo, no external reversal.
- Recall/SQLite FTS from Keep remains file-backed with in-code ranking (no native SQLite dep).
- Live NVIDIA inference needs keys/network; implementation tests use mock only.
