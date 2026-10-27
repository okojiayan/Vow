# Demo walkthrough

1. Start Meterless Runtime if you have it, then start VOW with `npm run dev`.
2. Open [http://localhost:3001](http://localhost:3001). Zetaris UI, if used, stays on port 3000.
3. Confirm the top bar shows **Demo mode (labelled)** or **Live Meterless**, and Settings shows Zetaris enabled only when credentials are present.
4. Run `Query Pikachu abilities from pokeapi.pikachu_abilities_table`. Inspect the trace for Markovian chunks (when Meterless is configured), the Warden `run_sql` decision, and verification against returned rows.
5. Run `Compute 21 * 2 + 8` and inspect the trace plus evidence.
6. Switch Warden to Supervised and create a note. Approve or deny the exact action.
7. Try `Run a shell command to cat /etc/passwd` and read the block reason.
8. Open Evaluation and run baseline vs VOW. Read individual case rows, not just totals.

Missing Meterless or Zetaris credentials keep VOW runnable. Heuristic plans are labelled **Demo mode**. Missing Zetaris keys fail `run_sql` honestly; they do not invent Pikachu rows.

---

# Sponsor demo runbook (Zetaris + Meterless/Nemotron, 2026-10-24)

## Strongest supported scenario

**"Grounded answers over live data."** VOW receives a natural-language
question, executes a permitted read-only Zetaris query through the existing
`run_sql` client + Warden policy, passes the *actually returned rows* as
structured evidence into NVIDIA Nemotron via Meterless/Nightshift, and the
evidence-grounded verifier accepts the answer only if it cites observed
values. Each sponsor's contribution is visible in one task trace: Zetaris =
real rows + request ID; Nemotron = provider-echoed model identity + analysis;
VOW = routing, Warden decisions, verification, structured outcome.

**Honest limitation:** the only dataset VOW is currently authorized to query
is the sample `pokeapi.pikachu_abilities_table` (ability names + hidden flags
for Pikachu). That demonstrates the *mechanism* truthfully but has thin
real-world impact. A stronger scenario needs a real business dataset/view
granted to the configured Zetaris org (e.g. telemetry, incidents, catalog);
no code changes are required — only dataset access and the existing SQL
policy unchanged. Do not fabricate a more impressive dataset.

## Exact demo request

`Query Pikachu abilities from pokeapi.pikachu_abilities_table`

Expected real-operation sequence in one VOW task:

1. Deterministic policy routing selects the restricted SELECT (no model SQL).
2. Warden `run_sql: allow`; Zetaris returns N rows + request ID into the trace.
3. Nemotron analyzes the returned rows (counts, hidden vs visible).
4. Verifier `zetaris-result` + analysis-grounding checks pass against rows.
5. Structured outcome `completed` with evidence IDs, model identity, usage,
   latency per stage.

## Prerequisites

- Zetaris instance reachable at `ZETARIS_REST_URL` with valid key/org and the
  Pikachu view present (see `docs/integrations/zetaris-setup.md`).
- Nightshift running at `METERLESS_BASE_URL` with the configured model listed
  by authenticated `GET /v1/models` (see
  `docs/integrations/meterless-nightshift.md`).

## Bounded preflight (read-only, no inference, never prints secrets)

```sh
node scripts/demo-preflight.mjs
```

Proceed only on exit 0. For full benchmark-grade stability evidence, run
`node scripts/bench-stability-gate.mjs --outdir=<dir>` and require
`passed=true`.

## Confirming both sponsors in the same task

In the task trace (`GET /api/traces/[taskId]`), require ALL of:

- `Tool ok: run_sql` with executed SQL, rowCount and request ID.
- A `model_response` event whose provenance is the provider-echoed model id
  (e.g. `nvidia/nemotron-3-ultra-550b-a55b`), never the configured name alone.
- `Verification passed` with `zetaris-result` evidence.
- Terminal `Outcome: completed` with `verificationPassed: true`.

If the analysis step shows `heuristic-demo` / `heuristic-fallback`, the model
did NOT contribute: label it fallback on stage, never Nemotron reasoning.

## Audience view

Show the user request, the trace (plan → Warden → rows → model analysis →
verification), and the final answer side by side. Point at the request ID,
row count, model identity and verification line as the trust story.

## Fallback if Nightshift is unavailable

1. Say so on stage; show the preflight/gate failure.
2. The task will complete Zetaris honestly but the analysis step verifies as
   failed (heuristic fallback is rejected by design) — present this as VOW
   refusing to fake a model answer, not as a Nemotron result.
3. Any recording must be introduced as prerecorded, never as live execution.
