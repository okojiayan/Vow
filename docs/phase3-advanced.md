# VOW Phase 3 — Advanced Capabilities, Remote Trust & Personal Assistance

Baseline: 365 unit/integration tests, clean tsc/eslint, successful production build (Phase 2).

## Status per capability
- **Pocket Approval — PARTIALLY IMPLEMENTED (local foundation; remote transport BLOCKED BY INFRASTRUCTURE).** `src/core/remote/pocket.ts` + `/api/pocket/issue|decide`. Short-lived single-use task-bound tokens, exact plan-version binding, atomic consume, replay/expiry/race protection, revalidation of kill switch + Task Pass + hard denials. Issuing requires the existing worker-token bearer when configured. No phone/push channel exists in this repo, so nothing is sent to a phone; UI states this explicitly.
- **Trusted Contact — PARTIALLY IMPLEMENTED (consent + local preview; delivery DOCUMENTED ONLY).** `src/core/remote/contacts.ts` + `/api/contacts`. Opt-in per-purpose consent (`view_report` vs `approve_delegated`), narrow delegated-action scope, expiry, revocation, data-minimized reports (no history/memories/credentials), redacted summaries. No SMS/push/email service exists, so reports are labelled local previews.
- **Trust Budget — IMPLEMENTED AND TESTED.** `src/core/remote/budget.ts` + `/api/budget`. Bounded max/expiry/revocation, eligible low-risk categories only, atomic consumption from real execution records, concurrency-safe, fail-closed, audited. Money movement, deletion, network, shell, and mandatory-approval/cooling paths are never eligible.
- **Model Swap Guard — IMPLEMENTED AND TESTED (NVIDIA-only).** `src/core/models/swap-guard.ts` + `/api/swap-guard`. Candidates restricted to `nvidia/...` (plus `mock-1` for offline tests), bounded user-approved sample, sanitized inputs, measured latency/timeout/structured-output correctness, mock-vs-live labelling, active model never mutated, explicit confirmation + fallback required to switch.
- **Deadline Guardian — IMPLEMENTED AND TESTED (read-only).** `src/core/time/deadlines.ts` + `/api/deadlines`. Explicit ISO dates from accessible memory/tasks with provenance, explicit-vs-inferred flag, stale marking, dedup, dismissal. No writes, no messages, no calendar actions.
- **Language Mode — IMPLEMENTED AND TESTED.** `src/core/i18n/explain.ts` (en/hi/hinglish) + settings selector (persisted locally). Policy IDs/tool names/audit states stay in English; English fallback; translation never changes permissions.
- **Tricks Radar community sharing — DOCUMENTED ONLY.** No suitable privacy-preserving sharing infrastructure exists in the repo; no external service was contacted or created. Personal component unchanged; community remains explicitly simulated in code and UI.

Scope Packs + Subscription Hunter: NOT IMPLEMENTED (explicitly out of scope; no approval given).

## GUI
- `src/components/phase3/Phase3Panels.tsx` mounted as a new settings tab "Remote & assistance": pocket status (local-only), contacts, budget, deadlines with sources + dismiss, language selector, Radar simulated notice. All states derive from live APIs; simulated/unavailable states are labelled.

## Tests (all isolated temp data, no live sponsor calls)
- `tests/unit/phase3/pocket.test.ts` (4): exact-plan binding, expiry, replay, concurrent approve/deny, forged tokens.
- `tests/unit/phase3/contacts-budget.test.ts` (3): per-purpose consent, revocation, report minimization, narrow delegation, atomic consume, exhaustion, ineligible-tool rejection.
- `tests/unit/phase3/swap-deadline-lang.test.ts` (4): candidate restriction, mock labelling, no auto-switch, timeout honesty, deadline provenance/dedup/dismiss, language consistency + fallback.

## Validation
- `tests/unit + tests/integration`: 64 files, 376 tests pass (365 + 11 new).
- `npx tsc --noEmit`: exit 0.
- ESLint on changed files: 0 errors.
- `npm run build`: see final report (run after docs).

## Limitations
- Remote phone delivery and contact delivery need a real authenticated channel + configured delivery service; not claimed.
- Swap guard measures only the configured adapter; frozen benchmarks untouched.
- Deadlines cover explicit ISO dates only; inferred dates are flagged, not trusted.
