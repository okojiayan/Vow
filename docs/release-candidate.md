# VOW Release Candidate — Integration Audit & Benchmark Reconciliation

## 1. Benchmark evidence reconciliation (authoritative)

Authoritative manifest: `tests/evals/cases/nemotron-vs-full-100.json` (version 1.0.0, 100 cases).
Authoritative scorers: `tests/evals/nemotron-vs-full-100.test.ts` + `tests/evals/bench-protocol.ts` (unchanged).

The two reported numbers are DIFFERENT RUNS with the SAME graders, not conflicting metrics:

- `tests/evals/reports/nemotron-vs-full-100-baseline-v1.0/aggregate.json` (2026-10-23T19:01, healthy provider, errors A=0/B=0):
  Mode A (Nemotron alone) 64/100, Mode B (full VOW) 33/100. Paired: B wins 8, A wins 39, ties 53 (−31pp).
  Failure analysis (`failure-analysis.md`) attributes the gap to VOW-side routing/verification/memory defects (F1–F5), since repaired and regression-tested offline.
- `tests/evals/reports/nemotron-vs-full-100/aggregate.json` (2026-10-23T20:21, provider storm, Mode A errors=89, only 11 completed):
  Mode A 10/100, Mode B 12/100. The denominator INCLUDES infrastructure failures, so neither 10 nor 12 measures capability.
  `progress.log` shows repeated HTTP 502s from ~11:12 onward; `storm-20261024` backup preserves the pre-storm state.

Scoring definition (unchanged): per-case `pass` from deterministic graders (correctness/constraint/grounded/tool + verification + outcome-completed); paired wins/losses/ties on the same 100 IDs; failed/timed-out/unverified cases stay in the denominator; infra failures reported separately.

## 2. Cross-system integration validation (this audit)

- Full suite: 65 files, 382 tests pass (365 baseline + 11 Phase-3 + 6 new cross-system). `tsc` clean, ESLint 0 errors, `npm run build` passes.
- New `tests/unit/phase3/cross-system.test.ts` (6, isolated): shell.exec denied in autonomous; expired approval unconsumable; 5-way concurrent budget race consumes exactly 2 of 5; non-reversible receipt undo refused + rewind preview skips; forget tombstones content (status deleted, canary absent, retrieval empty, history reflects deletion); tool-only success claim does not verify.
- Pre-existing coverage reused (not duplicated): hostile tool output as data (subagents, capability-chain), plan-lock/deviation denials, cooling, house-rules/leak at the real boundary, memory isolation, swap/deadline/language, pocket replay/expiry/races.

## 3. Live comparison (rc1)

- Stability gate passed twice against `nvidia/nemotron-3-ultra-550b-a55b` (59 models listed, 3/3 consecutive inference probes with matching model identity; usage metadata recorded; no secrets in gate.json).
- Smoke (SMOKE=1, 4 matched pairs) in fresh `tests/evals/reports/nemotron-vs-full-100-rc1/`: A=0% (3× 60s timeouts + 1 answered-but-wrong), B=50% (deterministic calc pass in 1.1s + safety-refusal pass; 2 honest fails via labelled heuristic fallback, zero false success).
- Provider is SLOW (successes take 43–73s; 60s budget times out intermittently). A second gate into the same OUTDIR (required: gate newer than runs) FAILED at 11:27 UTC: `models:ok, chat0:ok, chat1:ok, chat2:FAIL` — HTTP 503 load-shedding on the third probe AND its retry (41.6s then 6ms). Per protocol the full 200-measurement run was NOT launched. No repeated hammering, no mock substitution.

Final rc1 evidence (all under ignored `tests/evals/reports/nemotron-vs-full-100-rc1/`, frozen artifacts untouched):
- `gate.json` (11:09 pass) + `gate.json` (11:27 fail): provider went from slow-but-working to load-shedding within ~20 minutes.
- Smoke (4 matched pairs, exit 0): A=0% (3x 60s timeouts + 1 answered-but-wrong), B=50% (deterministic calc pass 1.1s + safety-refusal pass; 2 honest fails via labelled heuristic fallback, zero false success, residueSuspect A=1 flagged).
- `REPORT.md`/`aggregate.json`/`results.csv`/`runs_A|B.json`/`progress.log`/`checkpoint-batch-0.json`/`transport-summary.json` from the smoke run.

Resume requirements: fresh passing gate in rc1 OUTDIR, then the same `BENCH_OUTDIR=... vitest run` command resumes from 4 saved pairs via checkpoint (no duplication).

## 4. Outstanding risks

- Provider latency dominates: any full-run score mixes capability with timeout luck; report infra-failure rates separately (done in aggregate).
- No overall-superiority claim is made until the matched full comparison completes with a healthy provider.
