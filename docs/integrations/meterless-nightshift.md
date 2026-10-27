# Meterless Nightshift + NVIDIA Nemotron (live-model path)

VOW's live reasoning path is:

- Entry point: `src/integrations/meterless/client.ts` → `completeChat(messages)`
- Callers: `src/core/agent/planner.ts` (`planTask`) and
  `src/core/agent/orchestrator.ts` (Markovian `generator` + planning context)
- Health: `GET /api/health` via `probeMeterless()` → `GET {BASE}/models`
- Inference labels: `live-model` | `deterministic` | `heuristic-demo`
  (`src/core/agent/planner.ts`: `inferenceLabel()`)

## Contract

- `POST {METERLESS_BASE_URL}/chat/completions` (OpenAI-compatible) with headers
  `Authorization: Bearer <key>`, `meterless-app: vow-open-agent-hackathon`,
  `meterless-scope: user` and body `{ model, messages, temperature: 0.2, max_tokens: 1200 }`.
- Success requires HTTP 200 **and** non-empty `choices[0].message.content`.
  Empty completions return `invalid_response` — never treated as success.
- Failure codes: `not_configured` (no key, no fetch), `timeout` (AbortError),
  `unavailable` (network or 5xx), `invalid_response` (4xx or malformed).
  Error strings never include the key.
- `probeMeterless()`: `GET {BASE}/models` with `Authorization` + `meterless-app`;
  `reachable:true` only on HTTP 2xx. Timeout is the configured `METERLESS_TIMEOUT_MS` (no short ceiling: cold listings observed at 35-49s).

## Required environment

```sh
METERLESS_BASE_URL=http://127.0.0.1:8088/v1
METERLESS_API_KEY=<server-side only, never commit>
METERLESS_MODEL=nvidia/nemotron-3-ultra-550b-a55b
METERLESS_TIMEOUT_MS=60000
```

## Live verification (2026-10-23, updated 2026-10-24)

- Prior probe: `curl -m 5 http://127.0.0.1:8088/v1/models` → connection refused.
  Runtime was not running then.
- 2026-10-24: Nightshift M1-M4.app (installed in /Applications) was launched; port 8088
  opened. No-auth `GET /v1/models` → HTTP 401 `authentication_error` (auth is real).
  With the configured key → HTTP 200, 59 model ids, including routing modes
  `meterless/auto|fast|deep|cheap|local|fusion` and
  `nvidia/nemotron-3-ultra-550b-a55b` (the configured id is live-listed).
- Smallest real inference via VOW's `completeChat` ("Reply with exactly: ok") →
  HTTP 200 in ~2 s, response `model` field `nvidia/nemotron-3-ultra-550b-a55b`,
  usage `{prompt_tokens:116, completion_tokens:44, total_tokens:160}`.
  Model identity comes from the live `/models` listing plus the provider-echoed
  response `model` field — not from the config string alone.
- Mocked unit tests prove the adapter logic only; the results above are live.

To verify live when the runtime exists:

```sh
curl -sS "$METERLESS_BASE_URL/models" -H "Authorization: Bearer $METERLESS_API_KEY" -H "meterless-app: vow-open-agent-hackathon" | head -c 2000
curl -sS -w '\n%{http_code} %{time_total}s\n' "$METERLESS_BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $METERLESS_API_KEY" \
  -H "meterless-app: vow-open-agent-hackathon" -H "meterless-scope: user" \
  -d '{"model":"nvidia/nemotron-3-ultra-550b-a55b","messages":[{"role":"user","content":"Say ok"}],"temperature":0.2,"max_tokens":32}'
```

Expect HTTP 200, non-empty `choices[0].message.content`, echoed `model`, and `usage`.
Record latency and keep the key out of logs.

## Fallback labelling

Missing/unreachable Meterless never blocks VOW: planner and orchestrator fall back to
`heuristic-demo` (generic tasks) or `deterministic` (policy-routed Zetaris SQL), and the
UI prefixes `[Demo mode]` / `[Deterministic plan]`. Only `live-model` means a real
Nightshift/Nemotron completion contributed. Do not present heuristic output as a model response.
