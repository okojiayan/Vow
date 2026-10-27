# VOW — Reliable. Correct. Fast.

VOW is a model-agnostic AI-agent reliability harness. It turns a request into an observable plan, runs only permitted tools through a deterministic **Warden** gateway, retrieves memory with provenance, verifies actual outputs, and scores the run with RCF metrics (reliability, correctness, speed, cost, safety).

This repository is a locally runnable Next.js application. It is not a mockup.

## What is implemented

- Workspace UI: assistant, task inspector, execution trace, evidence, Warden controls, memory explorer, evaluation, history, settings
- Task lifecycle: `received → queued → claimed → planning → awaiting_approval → executing → verifying → completed | failed | blocked | cancelled`, plus `interrupted` for crash recovery
- Away Mode (Warden Autonomous Mode): `POST /api/agent/enqueue` returns `202` with a queued task; an in-process worker claims jobs exclusively, runs them through the same Warden gateway, pauses on approval, supports cancel (`POST /api/agent/[taskId]/cancel`) and interrupted requeue (`POST /api/agent/[taskId]/requeue`). Closing the browser tab does not cancel queued work, but stopping the server or sleeping the machine pauses it. No external push notifications; status is polled in the UI (`/api/worker/status`). `POST /api/worker/tick` is rate-limited per process and requires `Authorization: Bearer <VOW_WORKER_TOKEN>` when that token is configured.
- Warden: default-deny, risk classes, action-specific approvals, replay protection, workspace path/symlink guards, audit log
- Safe tools: `fs.list`, `fs.read`, `fs.write`, `notes.create`, `memory.search`, `memory.store`, `calc.evaluate`, `run_sql`
- Permanently denied or disabled: `shell.exec`, unconstrained `http.fetch`, `fs.delete`
- Restricted Zetaris read-only SQL against `pokeapi.pikachu_abilities_table`
- Bounded Markovian reasoning for long-running and Zetaris demo tasks when Meterless is configured
- Memory dictionary with retrieval, version history, and conflict marking
- Meterless OpenAI-compatible client (server-side only) with labelled heuristic **demo mode** when the provider is missing
- CSS/SVG mascot (no `.glb` asset is present under `public/assets/vow/models/`)
- Vitest unit, integration, and evaluation tests

## Requirements

- Node.js 22 (see `.nvmrc`)
- npm

## Install

```bash
npm install
```

Copy `.env.example` to `.env` locally if you need Meterless or Zetaris. **Do not commit `.env`.** This project will not overwrite an existing `.env` file.

```bash
cp .env.example .env
```

### Environment

| Variable | Purpose |
| --- | --- |
| `METERLESS_BASE_URL` | OpenAI-compatible base URL (default `http://127.0.0.1:8088/v1`) |
| `METERLESS_API_KEY` | Server-only key. Never sent to the browser. |
| `METERLESS_MODEL` | Model id (default `nvidia/nemotron-3-ultra-550b-a55b`) |
| `METERLESS_TIMEOUT_MS` | Request timeout |
| `METERLESS_INPUT_COST_PER_1K` / `METERLESS_OUTPUT_COST_PER_1K` | Optional cost accounting |
| `VOW_WORKSPACE_DIR` | Allowlisted directory for file tools |
| `VOW_DATA_DIR` | Local JSON persistence for tasks, traces, memory, audit |
| `ZETARIS_REST_URL` | Zetaris REST base (default `http://localhost:8888/api/v1.0`) |
| `ZETARIS_ORG_ID` | Organization header for Zetaris REST |
| `ZETARIS_API_KEY` | Server-only Zetaris key. Never sent to the browser. |
| `ZETARIS_TIMEOUT_MS` | Zetaris request timeout |

If Meterless is unset or unreachable, VOW keeps working in **explicitly labelled demo mode** using heuristic plans. It does not silently swap in another model. If Zetaris is unset, `run_sql` fails with a configuration error and does not invent rows.

## Development

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). Port 3001 is pinned so local Zetaris UI can remain on 3000.

Other commands:

```bash
npm run lint
npm run typecheck
npm test
npm run eval
npm run build
```

Do not run `npm run build` at the same time as `npm run dev`. Both use `.next`.

## Try these tasks

- `Query Pikachu abilities from pokeapi.pikachu_abilities_table` — restricted Zetaris SELECT through Warden
- `Compute 21 * 2 + 8` — completes and verifies a numeric result
- `Create a note titled hello with body from VOW` — write tool; needs approval in Supervised mode
- `List files` / `Read README.md` — workspace reads
- `Run a shell command to cat /etc/passwd` — Warden blocks it
- Evaluation page → **Run baseline vs VOW** — measured fixture comparison, not invented percentages

## Security boundary

Warden is application code, not a system prompt.

- Every tool call goes through `src/core/warden/tool-gateway.ts`
- Unknown tools are denied
- `shell.exec` is denied in every mode, including autonomous
- `run_sql` is SELECT-only against the approved Pikachu abilities view and columns
- Approvals are bound to a SHA-256 fingerprint of `{tool, canonical args, target}` and are single-use
- File tools resolve real paths, reject `..`, absolute paths, and escaping symlinks
- Autonomous mode may pre-authorize *some* writes; it cannot turn the gateway off
- Models cannot grant themselves permissions

Local data lives in `data/` (gitignored). Treat it as a development store, not a hardened multi-tenant database.

## Meterless

Development target:

- Base URL: `http://127.0.0.1:8088/v1`
- Model: `nvidia/nemotron-3-ultra-550b-a55b`

VOW calls `POST /chat/completions` with `Authorization: Bearer $METERLESS_API_KEY`. HTTP 200 without assistant text is treated as failure.

Zetaris demo tasks also run the Markovian engine when Meterless is configured. That reasoning is bounded and traced. The executable SQL for the approved Pikachu query is still selected by deterministic routing, not treated as a free-form model decision.

## Zetaris

`src/integrations/zetaris/` executes one restricted read-only query through Warden:

`SELECT ability_name, is_hidden FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu' ORDER BY ability_name LIMIT 100`

SQL is validated before execution. Other tables, writes, comments, and multi-statement input are denied. Successful results keep the returned rows, row count, and request identifier. Verification inspects those fields. Empty Pikachu results fail verification.

## Markovian engine

Custom implementation: `src/core/agent/markovian-engine.ts`.

VOW demo profile used by orchestration: `chunkSize = 4000`, `maxChunks = 3`, `carryoverTokens = 640`, `overlapTokens = 0`. Official Markovian reference defaults differ (`8000` / `24` / `800` / `0`). Non-zero overlap is rejected until overlap windows are implemented. Efficiency numbers from character estimates are labelled estimated; provider `usage` is stored separately when present.

Official Meterless conformance (`MARKOVIAN_IMPL=... npx tsx conformance/runner.ts`) is not vendored in this repository.

## RCF evaluation

The harness runs the same cases on:

1. **Baseline** — heuristic action, no Warden, no verification, no memory. Dangerous OS commands are still not executed on the host; they are recorded as unblocked intent.
2. **VOW** — plan, Warden, execution, verification, memory.

Reports are stored in `data/eval-report.json` and `tests/evals/reports/latest.json`. The UI labels measured vs simulated. This repository does not display fabricated improvement percentages.

## Known limitations

- Demo/heuristic planning is keyword-based when Meterless is down
- Memory is local JSON, not a vector database
- No unrestricted shell, network, or host filesystem access (intentional)
- No `.glb` mascot; SVG/CSS character is the fallback
- Playwright config is a stub; coverage is Vitest
- Single-operator local app, not a production auth system
- Official Markovian conformance suite is not run from this repo
- Traces record planner, Warden, tools, Meterless, and verifier events. This is a supervised single-harness workflow, not a claimed multi-agent product

## Architecture

See `docs/architecture/overview.md`.
