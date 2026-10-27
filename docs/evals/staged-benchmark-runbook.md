# Staged Confirmatory Benchmark — Runbook

Frozen inputs (never modify): `tests/evals/cases/nemotron-vs-full-100.json`
(manifest v1.0.0, 100 case IDs), the graders in
`tests/evals/nemotron-vs-full-100.test.ts`, and the snapshots
`reports/nemotron-vs-full-100-baseline-v1.0/`,
`reports/nemotron-vs-full-100-storm-20261024/`,
`reports/nemotron-vs-full-100-interim-flap/`.

## 1. Stability gate (required before every batch and every resume)

```sh
node scripts/bench-stability-gate.mjs \
  --outdir=tests/evals/reports/nemotron-vs-full-100-postfix \
  --chats=3 --timeout-ms=60000 --retries=1 --retry-ms=1500
```

Timeout policy (benchmark-only, recorded in `aggregate.json`/`REPORT.md`):
per-model-call `BENCH_MODEL_TIMEOUT_MS=60000` shared by the gate
(`--timeout-ms`), preflight probe + inline `/models` fetch, Mode A
`completeChat`, and Mode B (orchestrator → `completeChat`); full-task
deadline `BENCH_TASK_DEADLINE_MS=300000` for Mode B. Rationale: Nightshift
showed healthy `/models` in ~5.2s and chats in ~13–45s, so the old
4s probe / 8s fetch / 30s chat ceilings turned slow successes into infra
failures. 60s keeps a bounded margin; 300s allows ~4–5 sequential calls.
`gate.json` now stores `timeoutMs`. Retries, breaker, identity, and
checkpoint rules are unchanged.

Exit 0 writes `gate.json` (`passed: true`, 3 identity-matched probes).
Any other exit means Nightshift is unhealthy — do not launch cases.
`--chats` values below 3 are raised to 3. No secrets are printed or stored.

## 2. Staged batches (sequential, checkpointed)

```sh
BENCH_OUTDIR=tests/evals/reports/nemotron-vs-full-100-postfix \
BENCH_BATCH_SIZE=10 BENCH_BATCH_INDEX=0 \
npx vitest run tests/evals/nemotron-vs-full-100.test.ts
```

`--chats=3` gate must be newer than any existing `runs_*.json` /
`circuit-breaker.json` in the OUTDIR, or the harness refuses to start.
Each completed run is checkpointed immediately; rerunning the same command
resumes (valid records reused, invalid ones quarantined with a log line,
other batches' records preserved). After an interruption, re-run the gate
first, then the same batch command.

Other knobs: `BENCH_BATCH_INDEX` (0-based slice), `BENCH_COOLDOWN_MS`
(pre-batch pause), `BENCH_CB_THRESHOLD` (default 6 consecutive infra
failures trip the breaker). `SMOKE=1` runs the 4-case smoke subset.

## 3. Mocked harness validation (no live inference)

```sh
npx vitest run tests/evals/staged-protocol.test.ts tests/evals/stability-gate.test.ts
```

Covers gate pass/fail modes, breaker, checkpoint recovery, pairing, and the
frozen-dir refusal — all against a localhost mock, never Nightshift.

## 4. Conventions and risks

- One OUTDIR per measurement campaign; never point a confirmatory run at a
  baseline/storm/interim/holdout dir (the harness refuses these).
- Infra failures (502/503, timeouts, empty listings, identity mismatch) stay
  in the denominator and are reported separately in `transport-summary.json`;
  they are never silently excluded.
- `aggregate.json` / `REPORT.md` per OUTDIR describe that batch only; the
  full 100-case verdict requires all batches complete with no trip.
- Run identity: the harness writes `run.json` (runId, manifestVersion, batches)
  on start and refuses an OUTDIR whose recorded manifest differs from the
  current one, or whose artifacts predate run identity. Resume the same
  manifest in place; a new manifest requires a fresh OUTDIR.
- Known risk: Nightshift load-shedding (HTTP 503 in ~24ms) and slow control
  plane; the gate + breaker turn this into waiting, not bad data.
