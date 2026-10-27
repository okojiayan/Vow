# VOW Phase 2 — Memory, Personal Trust & Safety Intelligence

## Scope
Phase 2 builds on Phase 1 (Warden, Plan Lock, Task Pass, mode enforcement, refusal ledger, parked queue, kill switch, receipts, limited Undo/Rewind). No new executor, policy engine, memory store, task lifecycle, or approval mechanism was created. Frozen evals, credentials, and sponsor connectors were untouched. No live Zetaris/Meterless calls in tests.

## Preflight (Turbo consistency)
Turbo permits greater autonomy but does not bypass hard-denied tools, Plan Lock/scope, kill switch, mandatory policies, or required approvals. Main-agent, subagent children (`runRemainingSteps`, `allowedTools` subset), skills (`skills/invoke` → `executeTool`), and plugins (same registry/executor) all funnel through `executeTool → authorizeTool`. No OS-sandbox claims.

## Increments
1. **Recall + Router** (`tests/unit/phase2/recall-router.test.ts`, 11/11): paraphrase/alias/morphology retrieval with conversation-scope isolation; stale/superseded transparency; `src/core/reasoning/router.ts` (quick/deep + truthful `routeLabel`); wired into orchestrator trace + `task.reasoningRoute`.
2. **House Rules + Leak Check** (`house-leak.test.ts`, 8/8): 4 categories (outside-project, pii-send, no-auto-delete, network), propose→stage→confirm, ambiguity/conflict honesty, rules-only-restrict, enforcement inside `executeTool` after Warden approval (mode-independent, covers Turbo/subagents/skills/plugins). Leak Check (PAN/Aadhaar/IFSC/credential) scans outbound payload at boundary, masks, blocks network exfil, never echoes raw values.
3. **Label / NotChecked / Receipt / Replay** (`label-receipt-replay.test.ts`, 4/4): `task-label.ts`, `use-receipt.ts`, `/api/warden/label`, `/api/receipts/use`, `/api/replay`. Labels derive from real receipts/plan; NotChecked non-vacuous; replay explains hypothetical without executing; receipt redacts secrets (free-text masking via leak-check, preserves `[redacted]` token for Phase 1 compat).
4. **Cooling** (`cooling-timetravel.test.ts` part, persisted, injectable clock): `src/core/warden/cooling.ts`, enforced in executor for consequential tools, survives restart, expiry never auto-executes, mode-proof, cancellable.
5. **Time Machine + Forget** (same file): `src/core/memory/time-machine.ts`, history/revert (force+reason guard), tombstone forget redacting content+keywords+entities+links+versions; `/api/memory/history`, `/api/memory/forget`, `/api/cooling`. Audit keeps content-free tombstone only. Conversation-history pairs and external backups honestly out of scope.
6. **Tricks / Dojo / Radar** (`safety-learning.test.ts`, 4/4): `src/core/safety/tricks.ts` + `/api/safety/{tricks,dojo,radar}`; distinguishes genuine attack-blocked from policy enforcement; Dojo synthetic-labelled and inert; community feed explicitly simulated.

## UI
- `SafetyPanel.tsx` (settings → Privacy & memory): rules, leak explainer, safety lessons, all from live APIs; no premature active/deleted claims.
- `TaskInspector`: truthful Quick answer / Thought deeply from `reasoningRoute` + `inferenceMode`, never tone-based.
- Settings privacy-tab JSX fragment fix (build-blocker).

## Test isolation fix (this session)
`house-leak` real-boundary tests shared `./data/approvals.json` across vitest workers (inter-process race → `Unknown approval`). Fixed with `isolatedEnv()` per real-boundary test; applied same isolation to `cooling-timetravel`, `label-receipt-replay`, `safety-learning`. Also fixed receipt masking to keep `[redacted]` token (`[redacted] [withheld …]`) so Phase 1 redaction test holds while free-text secrets stay masked.

## Build-blockers fixed (narrow, pre-existing)
- `routines/page.tsx`: `as any` → explicit union; `skills/page.tsx`: Lucide `title` → `aria-label`; `PersistentLiveActivity` + `tasks/page`: `task as any` → explicit TaskInspector shape mapping; `plugins/notion`: unescaped `'` → `&apos;`; `plugins/connect`: Suspense boundary for `useSearchParams` prerender.

## Validation
- `tests/unit/phase2`: 5 files, 31/31 pass.
- Full: `tests/unit + tests/integration`: 61 files, 365/365 pass.
- `npx tsc --noEmit`: exit 0.
- ESLint on touched files: exit 0.
- `npm run build`: passes (static prerender OK).

## Gaps / honesty
- Recall store still JSON file + in-code ranking (no FTS); relevance evidence via diagnostic suite, not production metrics.
- Conversation-history pairs + external backups out of Forget scope (documented in UI copy).
- Community feed simulated (labelled).
- No live sponsor calls; no benchmark reruns.
