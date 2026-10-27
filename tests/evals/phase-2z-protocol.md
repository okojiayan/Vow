# Phase 2Z Protocol — 500-Case Benchmark Execution (50 x 10-Case Batches)

Offline planning document. No provider calls were made to produce it. All
duration figures below are extrapolated from recorded artifacts; assumptions
are stated explicitly.

## 1. Manifest and harness under test

- Manifest: `tests/evals/cases/nemotron-vs-full-500.difficulty-v2.json`
  (`version` 2.0.0, 500 cases: 5 tiers x 5 categories x 20).
- The v1 manifest (`tests/evals/cases/nemotron-vs-full-100.json`, v1.0.0) is
  carried unchanged inside v2 (byte-identical modulo the added `tier` field;
  enforced by the generator's own validator).
- Runner: `tests/evals/nemotron-vs-full-100.test.ts` with tier support
  (`BENCH_MANIFEST` override, optional `tier` on cases/run records,
  `BENCH_TIER` selector, per-tier aggregate/report sections, CSV `tier`
  column appended).
- Helpers: `parseBenchTier` / `filterCasesByTier` in
  `tests/evals/bench-protocol.ts`. Selection helpers are pure; grading and
  scoring logic is untouched by the tier work.

## 2. Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `BENCH_MANIFEST` | yes (2Z) | Path to the v2 manifest. Default is the v1 path (backward compatible). |
| `BENCH_TIER` | yes (2Z) | One of `easy`, `easy-medium`, `medium`, `intermediate-hard`, `hardest`. Mutually exclusive with `SMOKE=1` and `BENCH_CASES` (runner refuses otherwise). Selects the tier slice; staged batching applies on top. |
| `BENCH_OUTDIR` | yes | Fresh unique directory per tier, e.g. `tests/evals/reports/sprint-2z-<tier>/`. Never reuse a directory holding another manifest's or tier's artifacts. |
| `BENCH_BATCH_SIZE` | yes (2Z) | `10` — ten cases per batch. |
| `BENCH_BATCH_INDEX` | yes (2Z) | `0`..`9` within the selected tier (manifest order, sequential slices). |
| `BENCH_MODEL_TIMEOUT_MS` | yes | `120000` — per-model-call budget shared by gate, preflight, Mode A and Mode B. |
| `BENCH_TASK_DEADLINE_MS` | yes | `360000` — full-task deadline for Mode B. |
| `BENCH_CB_THRESHOLD` | yes | `6` (validated Phase 2N value). |
| `SMOKE` / `BENCH_CASES` | no | Must be **unset** for 2Z batches. The runner refuses `SMOKE=1` together with `BENCH_TIER` or `BENCH_CASES`, and `BENCH_TIER` together with `BENCH_CASES`. |

No other environment overrides are authorized. `.env`, production settings,
and timeout defaults stay untouched.

## 3. Preflight per batch (mandatory, no exceptions)

Before every batch, with the batch's own OUTDIR:

1. `node scripts/bench-stability-gate.mjs --outdir=<tier-outdir> --chats=3 --timeout-ms=120000`
2. The gate must pass with three consecutive identity-matched inference
   probes. The runner additionally requires the gate file to be newer than
   any existing runs/breaker records in that OUTDIR and its `timeoutMs` to
   cover the run's per-model-call budget.
3. If the gate fails (timeout, HTTP 503, identity mismatch, abort-settlement
   overrun), stop: no evaluation, no retry of the gate, no next batch.
   Preserve the evidence and report.

Reference gate cost: the Phase 2N gate (`sprint-2n-ten-case-confirmation/gate.json`)
passed with `timeoutMs: 120000` after 1 retry; its `/v1/models` probe took
~36s and each chat probe is budget-capped at 120s. Budget **5-12 minutes**
per gate; a gate that cannot complete inside ~10 minutes is itself a stop
signal.

## 4. Batch command (validated Phase 2N shape)

```sh
BENCH_MANIFEST=tests/evals/cases/nemotron-vs-full-500.difficulty-v2.json \
BENCH_TIER=<tier> \
BENCH_OUTDIR=tests/evals/reports/sprint-2z-<tier> \
BENCH_MODEL_TIMEOUT_MS=120000 \
BENCH_TASK_DEADLINE_MS=360000 \
BENCH_CB_THRESHOLD=6 \
BENCH_BATCH_SIZE=10 \
BENCH_BATCH_INDEX=<0..9> \
npx vitest run tests/evals/nemotron-vs-full-100.test.ts --testTimeout=1800000
```

Sequence: tiers in manifest order (`easy`, `easy-medium`, `medium`,
`intermediate-hard`, `hardest`); within a tier, batch index 0..9. That is
50 staged batches, 10 cases x 2 modes each.

## 5. Duration estimate (assumptions stated)

Recorded evidence:

- Phase 2N (10 cases, both modes, retry pass): `wallTotalMs` 1622319
  (~27 min). Mode B median 119037ms ~= the 120s model-call budget, i.e. the
  run was budget-dominated, not overhead-dominated.
- Phase 2Q (7 cases, both modes): `wallTotalMs` 1150538 (~19 min).
- Phase 2P (3 cases, both modes): `wallTotalMs` 486414 (~8 min).
- Gate (2N): ~36s models probe + up to 3 x 120s chat probes + retry.

Linear extrapolation at 2N throughput (~2.7 min per case including both
modes, retry pass, and seeding/cleanup):

- One 10-case batch: ~27 min evaluation + 5-12 min gate = **30-40 min**.
- One 100-case tier (10 batches): **5-7 hours** of wall time.
- Full 500-case suite (50 batches): **25-35 hours** of wall time, plus
  operator gaps between batches (gates are manual checkpoints).

Assumptions: provider latency stays near 2N levels (median Mode B ~119s);
no breaker trips; no `engine_not_running` recurrence (Phase 2K showed six
consecutive inference failures after a passing gate — any recurrence stops
the suite); batch overhead (gate, seeding, cleanup) does not grow with
tier. Harder tiers may run slower (longer generations, more retries), so
treat the upper bound as soft.

## 6. Checkpointing, resume, and recovery

- Every batch writes `runs_A.json` / `runs_B.json`, `transport-summary.json`,
  and `checkpoint-batch-<index>.json` into its tier OUTDIR incrementally
  (per-case persistence). A killed batch resumes by re-issuing the same
  command after a fresh gate: completed cases are skipped, other batches'
  valid records are preserved, never clobbered.
- Circuit-breaker trip: the run aborts with results preserved. Recovery is a
  fresh gate followed by the identical resume command — never a different
  case set, never an edited manifest.
- `checkOutdirCompatibility` refuses to mix manifest versions in one OUTDIR;
  one OUTDIR per tier keeps the five 100-case runs isolated.
- `cleanupBenchMemory` removes seeded facts after each batch and restores
  the prior settings mode; memory is re-seeded per batch from that batch's
  targets only.

## 7. Scoring (95% target)

Per `tests/evals/grading-metrics-v2.md`:

- Headline metric: ordinary (non-refusal) passes / assigned cases, per mode.
  Target: >= 95% on each tier slice and overall. Refusal passes are reported
  separately and never count as task completion.
- Infrastructure failures (timeouts, transport errors, 503s, breaker trips)
  count against the rate — they are not excluded and not retried beyond the
  single authorized transport/timeout retry pass.
- `falseSuccess` (completed + verified but independently wrong) is reported
  as a diagnostic and investigated, never silently counted as success.
- Provenance-aware metrics (model-backed vs deterministic-tool vs
  fallback/unproven) are supplementary: they explain a pass rate, they do
  not change it.

## 8. Stop conditions (binding on 2Z execution)

- Gate failure, `engine_not_running`, model-identity mismatch, or repeated
  breaker trips: stop the suite, preserve partial evidence, report.
- Any temptation to retune prompts, relax grading, shrink timeouts to game
  latency, or hand-pick easier batches: prohibited. The manifest is frozen;
  the generator is deterministic and reproducible
  (`node tests/evals/cases/generate-difficulty-v2.mjs`).
- 50 batches are the full suite. No additional ad-hoc runs into the 2Z
  outdirs.

## Amendment A1 — gate cadence every two batches (2026-10-26, effective easy-medium tier batch 0)

Section 3 is amended as follows; everything else in this protocol is unchanged.
Full 3-probe gates stay mandatory at every tier transition, after any
prior-batch infrastructure failure (503, provider timeout,
`engine_not_running`, or other infra marker, recovered or not), under
`BENCH_GATE_FULL=1`, and on even batch indexes. Odd batches with a clean
prior batch need only a light 1-probe gate (`--chats=1`); the cheap
`/models` preflight still runs on every batch. The runner derives the
required depth from durable OUTDIR state (`run.json` batches, previous
`checkpoint-batch-N.json` case IDs, `runs_A/B.json` markers) and enforces it
against the gate file's honestly recorded `minChats`; gate freshness
(newer than protected runs) is unchanged. No case, mode, order, grading,
timeout, retry, breaker, or run-identity rule is altered, and no historical
record is rewritten. Record: `sprint-2z-easy/gate-policy.json`.
