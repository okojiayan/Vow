# Sandbox Boundaries (accurate as of this build)

VOW implements **logical isolation only**. No OS-level sandbox exists in this
build. This document states exactly what is enforced, what is absent, and the
minimum safe next step. It must not be read as a claim of process, filesystem,
or network isolation.

## Enforced today (by Warden + executor)

- **Deny-by-default tool authorization.** Every tool call passes through
  `executeTool` → `authorizeTool` → `evaluatePolicy`. Tools without a
  permission entry are denied (`default-deny.unknown-tool`); `shell.exec` is
  permanently denied in every mode and `http.fetch`/`fs.delete` are denied
  unless explicitly approved.
- **Delegation scope allowlists.** A child task with `allowedTools` can invoke
  only those tools. Out-of-scope calls are refused before Warden evaluation
  (`deny.subagent.tool-scope`) and audited.
- **Workspace path guards.** File tools resolve paths under
  `VOW_WORKSPACE_DIR` via `assertSafeWorkspacePath`; escapes are rejected.
- **Approval gates.** `require_approval` effects pause execution until a
  matching grant is consumed; stale approvals expire (`expireStaleApprovals`).
- **Bounded execution.** Delegation depth (2), fan-out (8/parent), concurrency
  (2), per-tool timeouts, retry policies (`maxAttempts: 2`, timeout-only
  retry), and child wall-clock budgets (`runChildWithTimeout`, best-effort
  cancellation) cap blast radius.
- **Audit trail.** Every allow/deny/approval/execution outcome is recorded via
  `recordAudit`/`recordExecutionOutcome` and is queryable with `listAudit`.
- **Model output is data.** Planner output is sanitized (`sanitizeModelPlan`
  allowlist); plugin/child outputs are schema-validated and never interpreted
  as permissions. Injected instructions in tool output do not change policy.

## Absent (not claimed)

- No OS process isolation: tools and child tasks run **in-process** in Node.
- No filesystem sandbox beyond the workspace path guard (no chroot, no
  read-only mounts, no seccomp/bubblewrap).
- No network egress filtering at the OS level; network tools are gated by
  policy only.
- No memory/CPU quotas per task and no separate UID per execution.
- Secrets are resolved server-side and scrubbed from traces, but there is no
  hardware-backed secret isolation.

## Minimum safe next step (preserving deny-by-default)

Run tool handlers that carry `network`, `command`, or `destructive` risk in a
separate OS process with no ambient authority: one unprivileged UID, a
read-only bind of nothing but the task workspace, no network except for
explicitly approved calls, stdio/JSON-RPC transport, and a wall-clock kill.
Keep the current Warden gateway as the single policy decision point — the
sandbox would only enforce confinement, never grant permissions. Until that
lands, high-risk tools stay denied or approval-gated, and receipts report
`sandbox.osIsolation: false`.
