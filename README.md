<p align="center">
  <img src="public/assets/vow/app-icon.png" alt="VOW mascot app icon" width="180" />
</p>

# VOW — Reliable. Correct. Fast.

> A model-agnostic AI-agent reliability harness. VOW turns a request into an
> observable plan, runs only permitted tools through a deterministic **Warden**
> gateway, retrieves memory with provenance, verifies actual outputs, and scores
> every run. Nothing is claimed without evidence.

## What VOW does

- **Understands intent** — free-text requests become structured tasks with explicit plans.
- **Enforces safety** — every tool call passes through Warden: default-deny, risk classes, single-use approvals, replay protection, workspace path and symlink guards, full audit log.
- **Remembers with provenance** — memory records carry sources, versions, and conflict markers; nothing is silently overwritten.
- **Verifies honestly** — completion is reported only when inspectable evidence supports it. Partial outcomes, failures, and blocked states are surfaced, never papered over.
- **Scores runs** — RCF metrics (reliability, correctness, cost, safety) on every execution.

## Screens

Workspace assistant, task inspector, execution trace, evidence receipts, Warden
controls, memory explorer, evaluation, history, settings — in a warm, calm visual
system with a single approved mascot (2D art plus 3D models under `public/assets/vow/`).

## Quick start

Requirements: **Node.js 22** (see `.nvmrc`), npm.

```bash
npm install
cp .env.example .env   # only if you need Meterless or Zetaris; never commit .env
npm run dev            # http://localhost:3001
```

Port 3001 is pinned so a local Zetaris UI can keep port 3000.

## Commands

| Command | Purpose |
| ------- | ------- |
| `npm run dev` | Local development server (port 3001) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit + integration suite (681 tests) |
| `npm run eval` | Benchmark / evaluation suites |

> Do not run `npm run build` while `npm run dev` is running — both use `.next`.

## Configuration

| Variable | Purpose |
| -------- | ------- |
| `METERLESS_BASE_URL` | OpenAI-compatible base URL (default `http://127.0.0.1:8088/v1`) |
| `METERLESS_API_KEY` | Server-only key. Never sent to the browser. |
| `METERLESS_MODEL` | Model id (default `nvidia/nemotron-3-ultra-550b-a55b`) |
| `METERLESS_TIMEOUT_MS` | Provider request timeout |
| `METERLESS_INPUT_COST_PER_1K` / `METERLESS_OUTPUT_COST_PER_1K` | Optional cost accounting |
| `VOW_WORKSPACE_DIR` | Allowlisted directory for file tools |
| `VOW_DATA_DIR` | Local JSON persistence for tasks, traces, memory, audit |
| `VOW_WORKER_TOKEN` | Optional bearer token for `POST /api/worker/tick` |
| `ZETARIS_REST_URL` / `ZETARIS_ORG_ID` / `ZETARIS_API_KEY` / `ZETARIS_TIMEOUT_MS` | Restricted read-only Zetaris SQL |

If Meterless is unset or unreachable, VOW keeps working in an **explicitly labelled
demo mode** with heuristic plans — it never silently swaps in another model. If
Zetaris is unset, `run_sql` fails with a configuration error instead of inventing rows.

## How a task runs

`received → queued → claimed → planning → awaiting_approval → executing → verifying → completed | failed | blocked | cancelled` (plus `interrupted` recovery)

- **Away Mode**: `POST /api/agent/enqueue` returns `202`; an in-process worker claims
  the job exclusively, pauses on approval, and supports cancel/requeue. Closing the
  tab does not cancel queued work; stopping the server pauses it. Status is polled
  (`/api/worker/status`); there are no external push notifications.
- **Approvals** are bound to a SHA-256 fingerprint of `{tool, canonical args, target}`
  and are single-use with expiry.
- **Tools**: `fs.list`, `fs.read`, `fs.write`, `notes.create`, `memory.search`,
  `memory.store`, `calc.evaluate`, restricted read-only `run_sql`
  (SELECT-only on `pokeapi.pikachu_abilities_table`).
- **Permanently denied**: `shell.exec` in every mode, unconstrained `http.fetch`,
  `fs.delete`.
- Models cannot grant themselves permissions; autonomous mode can pre-authorize some
  writes but can never switch the gateway off.

## Try it

- `Compute 21 * 2 + 8` — deterministic numeric answer, verified against the tool output
- `Create a note titled hello with body from VOW` — write path (approval in Supervised mode)
- `List files` / `Read README.md` — allowlisted workspace reads
- `Run a shell command to cat /etc/passwd` — denied by Warden, reported honestly
- `Query Pikachu abilities from pokeapi.pikachu_abilities_table` — restricted Zetaris SELECT
- Evaluation page → Run baseline vs VOW — measured fixture comparison, no invented percentages

## Verification model

A successful model response is **not** proof a task succeeded. VOW reports success only
when tool results, memory writes, and verifier checks line up. Sensitive or destructive
actions require explicit confirmation, enforced in the execution layer — not just the UI.
Capabilities that are not safely supported appear as disabled, never as fake successes.

## Testing

- `npm run typecheck` — strict, zero-error
- `npm test` — 103 files / 681 tests, all passing
- `npm run lint` — clean on source (stale `.next-*` snapshots are ignored, not linted)
- `npm run build` — verified production build
- Browser coverage is Vitest-based; `playwright.config.ts` is a reserved placeholder

## Benchmark — Phase 2Z (complete, frozen)

500 cases × 2 modes (A: direct answer, B: full tool-grounded run) across five tiers,
run in batches of 10 with per-batch readiness gates and circuit-breaker recovery.
Methodology and results are frozen; run-wide totals come from the reconciled journals.

| Tier | Mode A pass | Mode B pass |
| ---- | ----------: | ----------: |
| Easy | 79 / 100 | 79 / 100 |
| Easy-Medium | 82 / 100 | 48 / 100 |
| Medium | 60 / 100 | 39 / 100 |
| Intermediate-hard | 67 / 100 | 48 / 100 |
| Hardest | 71 / 100 | 50 / 100 |
| **Total** | **359 / 500** | **264 / 500** |

Evidence (journals, checkpoints, gate and breaker-history archives, reports) lives under
`tests/evals/reports/sprint-2z-*/`. Final-batch summaries there are batch-scoped by design.

## Project structure

- `src/app/` — Next.js routes (workspace, tasks, memory, evals, settings, APIs)
- `src/components/` — UI: shell, workspace, trust/evidence, vow mascot, live activity
- `src/core/` — agent orchestration, warden, execution, memory, verification, reasoning, rcf, traces, keep, safety
- `src/integrations/` — Meterless (OpenAI-compatible) and Zetaris clients (server-only)
- `src/lib/` — env, schemas, display helpers, persistence
- `tests/` — unit, integration, evals (benchmark harness + frozen cases)
- `scripts/` — benchmark gates, keep/recall/cost benches, QA helpers
- `docs/` — architecture, trust phases, integrations, evaluations
- `public/assets/vow/` — mascot art and 3D models
- `data/` — local runtime store (ignored, never committed)

## Security notes

- Secrets stay server-side (`METERLESS_*`, `ZETARIS_*`, worker token). The browser never sees them.
- Warden is application code, not a system prompt. Untrusted content is wrapped and never treated as instructions.
- Local `data/` is a development store, not a hardened multi-tenant database.

## Known limitations

- Heuristic planning is keyword-based when the provider is down (always labelled).
- Memory is local JSON with in-code ranking, not a vector database.
- No unrestricted shell, network, or host filesystem access — intentional.
- Single-operator local app, not a production auth system.

## Architecture

See `docs/architecture/overview.md`.
