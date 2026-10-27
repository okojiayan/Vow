# VOW Keep — trust layer (adapted to this repo)

VOW Keep sits between the user and ANY language model. Models change; the Keep stays.
Adapted to this stack: Next.js + TypeScript backend (no Python rewrite), file-backed stores under `VOW_DATA_DIR`, existing Warden gateway + memory + traces reused. Language: this repo limits damage and blocks known tricks (never "unhackable"). Simulated parts are marked.

## Architecture

- `src/core/keep/adapter.ts` — one interface `generate(messages, tools, options) -> {text, tool_calls, usage, latency_ms}`. Adapters: `mock` (deterministic, tests), `nvidia` (reuses `src/integrations/meterless/client.ts`), `llama` (`LLAMA_*`), `gemini` (`GEMINI_*`). Keys/model names from env only. Missing adapters fail with a clear message. Rest of system only talks to this interface; swap via `VOW_KEEP_ADAPTER=mock|nvidia|llama|gemini` with no other changes.
- `src/core/keep/task-pass.ts` — Task Pass `{task_id, mode, allowed_read_paths, allowed_write_paths, allowed_actions, network:false default, expires_at, max_files, revoked}`. Derived from user request + explicit grant, never expanded by model. Includes parked queue ("needs you" + consequence text) and kill switch (revokes pass). Money pack default actions exclude cancel/pay/send entirely.
- `src/core/keep/gate.ts` — `check(call, pass)`. Canonicalizes first (null bytes, `..`, absolute, UNC, encoded tricks), requires target inside allowed roots, checks allowlist + expiry + kill + irreversible-park. Turbo enforces nothing (unprotected baseline). Detector is helper only; gate is the real defense.
- `src/core/keep/injection.ts` — wraps untrusted content as `<untrusted-data>` (data, never instructions); pattern + zero-width detector flags and excludes; refusal logged.
- `src/core/keep/recall.ts` — file-backed single-file store (`keep-recall.json`, exportable, no vendor lock-in). Exchange + metadata row (keywords, topic, type, said_by, last_confirmed, supersedes, importance). Recall order: recent → metadata keyword/recency/importance rank → top 1–3 → source refs `Found in memory: <chat> · <date>` → else "couldn't find". Write gate: ONLY `source:"user"` writes; file/tool/model refused (tested). Freshness via `superseded_by` + edit/delete endpoints.
- `src/core/keep/receipts.ts` — append-only receipts `{time, task_id, action, target, result, reversible, undo_data+content_hash}`. `undo(action)` restores exactly and refuses if content changed; 7-day window; `undo_task`. Away summary counts safe/blocked/waiting.
- `src/core/keep/money.ts` — deterministic recurring-charge detector (pure code); model only explains. VOW only finds and drafts; never cancels/pays.
- API `src/app/api/keep/*` — pass, gate-check, adapter (swap), run (Money demo), receipts, undo, memory (search/list/edit/delete/export), blast, parked (list/approve/deny), kill, refusals (from Warden audit), metrics. Existing UI is not rewritten; these endpoints serve the existing ModeSelector, TaskBoard, MemoryExplorer, ExecutionTrace, ApprovalDialog with real backend data.
- Existing reuse: `src/core/warden/*` (policy/gateway/approvals/audit), `src/core/memory/*`, `src/core/traces/*`.

## What is real vs simulated

- Real: gate checks, pass expiry/revoke/kill, allowlist, path canonicalization, injection flagging, memory write-gate, receipts + hash-checked undo, deterministic detector, mock adapter, attack/recall/cost scripts (local, honest).
- Simulated: model text for explanations when `VOW_KEEP_ADAPTER=mock`; NVIDIA/LLAMA/Gemini text requires keys and network (not run here). Token counts in recall bench are estimates except local latency.

## Run demo + tests

```sh
npm run test -- tests/unit/keep
node scripts/keep-attack.mjs
node scripts/keep-recall-bench.mjs
node scripts/keep-cost-check.mjs
npm run typecheck && npm run lint && npm run build
```

Demo: create pass (`POST /api/keep/pass` with `grantPaths:["demo/sandbox"]`), then `POST /api/keep/run` with `task_id` + instruction. Try `instruction:"cancel everything"` → parked, never executed. Tryunauthorized `target:"../secret"` via `/api/keep/gate-check` → denied. Memory: `POST /api/keep/memory` with `source:"file"` → 403 refused.

## Results (real, including misses)

- Attack: turbo followed 10 of 10 vs warden followed 0 of 10 (mock measured; nvidia/llama/gemini missing keys so not run — see `results/attack_results.json/.md`).
- Recall: 14 of 20 correct, local rank 1ms; tokens full-history ~307 vs summary ~400 vs VOW-metadata ~800 on this 20-item toy (full history wins at tiny scale; VOW wins as history grows unbounded) — see `results/recall_bench.json/.md`.
- Cost: trivial hi ~12 tokens/6ms vs 60-row hard task ~900 tokens/2ms detector + mock explain — see `results/cost_check.json`.
- Keep unit tests: 11 passed (gate 5, injection/memory/undo 3, adapter/money 3).

## Known limitations

- Llama/Gemini/NVIDIA live text not exercised without keys; swap contract is code-identical but live behavior still needs keys.
- Recall store is JSON+in-code ranking (adapted; no native SQLite dep for Next build) — single-file export preserved, FTS5 semantics approximated.
- Blast radius uses granted-roots count vs indexed total; refine with real file indexer for large workspaces.
- No cancel/pay/send tools exist in Money pack by design; adding them would violate this spec.
