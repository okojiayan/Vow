# Intelligence Repair Pass (post-100-pair baseline)

## Baseline (frozen, untouched)
- Snapshot: `tests/evals/reports/nemotron-vs-full-100-baseline-v1.0/` (manifest, runs, aggregate, REPORT, harness snapshot).
- Original scores: Mode A (Nemotron alone) 64/100; Mode B (full VOW) 33/100; paired VOW wins 8 / losses 39 / ties 53.
- 50 Mode-B false successes; memory category 0/20.
- Failure matrix: `docs/evals/nemotron-vs-full-100-failure-matrix.md`. Sensitivity (not applied): `docs/evals/baseline-sensitivity-analysis.md`.

## Root causes fixed (general, no case-specific logic)
1. **Plan-envelope answers**: provider returned `{"analysis":"1... 2... 3..."}` describing how to answer instead of the artifact; `expectGrounding:"none"` verification passed any non-empty provider text (H09-H12 pattern).
   - `src/core/verification/checks.ts`: new `isPlanEnvelope(text, goal)` — rejects JSON objects with plan-envelope keys (`analysis/steps/plan/reasoning/thought/...`), exempt when the goal itself requests JSON. Hooked into `checkAnalysis`.
   - `src/core/reasoning/runner.ts`: one budget-checked re-ask demanding the artifact alone; ledger-logged; never loops.
   - `src/core/agent/orchestrator.ts`: `summarize()` (now exported) emits only the `analysis` deliverable for analysis steps; evidence stays in traces/ledger.
2. **Decimal-measurement grounding**: `hasDistinctiveOverlap` split `0.5` into `0`/`5` (both dropped), so correct numeric answers failed memory grounding (H15 pattern). Decimal numbers and digit-bearing tokens (>=2 chars) are now preserved whole.
3. **Usage blindness**: Mode-B token usage was never recorded (harness limitation note). `ReasoningModelPort.complete` now optionally returns usage; the runner accumulates per-run totals (`ReasoningRunResult.usage`); the orchestrator passes provider usage through and stamps cumulative `AgentTask.usage` (new optional field, backward compatible).

## Validation (offline, deterministic)
- Full suite: 218/218 pass (was 213; +5 new). `tsc` clean. `eslint` clean on touched files. Production build fresh.
- New tests: `isPlanEnvelope` accept/reject incl. JSON-goal exemption; decimal grounding; runner single re-ask (2 calls, usage totals); no re-ask for requested JSON; `summarize` deliverable-only output.

## Holdout-20 (frozen harness/rules, run BEFORE the fixes above — do not re-tune)
- B: 4/20 (reasoning 0/4, extraction 0/4, planning 0/4*, memory 1/4, safety 3/4). *Planning 0/4 with verificationTrue=4/falseSuccess=4 — the envelope pattern, fixed after measurement.
- 12/20 B outcomes honestly failed/unverified (incl. 4 storm-driven heuristic fallbacks); 0 unsafe; memory.search issued on all memory cases.
- A: 5/20 completed (14 transport 502s during storm window); paired diff -5pp, 95% CI [-34.4, +24.4] — no conclusion possible on paired superiority.

## Confirmatory preflight (2026-10-24 ~02:55-03:05 IST) — GATE FAILED, run not started
- Stability gate: `/v1/models` 200 once (59 models, 5.2s) then 8s-timeout aborts; minimal inference 200 @ 17.8s / 2.2s / 13.1s with `nvidia/nemotron-3-ultra-550b-a55b` + real usage, interleaved with a 45s-timeout abort. Gate initially passed (3 consecutive 200s), then service degraded.
- Launch attempts into `tests/evals/reports/nemotron-vs-full-100-postfix/` aborted at the harness probe: (1) /models 8s timeout; (2) probe reachable but model-list fetch empty (`models=0` → `toContain` assertion). A later direct check returned **HTTP 503 in 24ms** — server shedding load, not a transport or auth problem.
- Diagnosis (evidence, not hypothesis): same key succeeds intermittently → not auth; /models 200s occur → not endpoint/config; harness records/resumes faithfully → not orchestration. Ring-fenced cause: **Nightshift serving saturation — overloaded workers (502s), explicit 503 shedding, slow control plane**. No benchmark calls burned beyond ~8 bounded probes; no code/case/grader changes during measurement.
- Next: rerun `BENCH_OUTDIR=tests/evals/reports/nemotron-vs-full-100-postfix npx vitest run tests/evals/nemotron-vs-full-100.test.ts` once 3 consecutive fast 200s are observed and no other batch is running.

## Resilient staged protocol (added, offline-validated)
- `tests/evals/bench-protocol.ts`: batch slicing, infra-failure classification, circuit breaker, end-to-end vs provider-conditional rate split (supplementary; scoring untouched).
- `scripts/bench-stability-gate.mjs`: pre-run gate (models listing + N sequential chats, writes gate.json, exit 0/1, no secrets).
- Harness (100-case only): `BENCH_BATCH_SIZE/INDEX/COOLDOWN_MS/CB_THRESHOLD`, breaker interlock vs gate.json, per-case checkpoints, `checkpoint-batch-<i>.json`, `transport-summary.json`, fail-fast trip with history. Live-validated once: gate passed (models 200/59, 2x chat 200 with correct identity+usage); a staged batch correctly refused to start when the probe flapped seconds later — nothing burned, no partial writes. Full 200-run execution still awaits a stable window.

## 100-case re-run (post-fix) — BLOCKED by Nightshift instability
- Attempted 2026-10-24 ~02:10 IST during a live-model storm (HTTP 502s, then probe timeout). A-side: 100 runs saved, mostly transport failures. B-side: R01-R05 saved 5/5 pass with the fixes live (calc.evaluate, completed). Relaunch aborted at the harness probe (`reachable=false`, timeout); no aggregate overwrite occurred.
- The storm-polluted full run is preserved at `tests/evals/reports/nemotron-vs-full-100-storm-20261024/`; the live dir retains the prior aggregate (01:51) plus resumable `runs_A/B.json`. Re-run when Nightshift is stable (2 consecutive 200s, no concurrent batches).
