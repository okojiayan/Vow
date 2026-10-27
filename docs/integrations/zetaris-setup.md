# Zetaris setup (read-only Pikachu demo)

VOW calls Zetaris through one narrow client:

- Entry point: `src/integrations/zetaris/client.ts` → `runReadOnlyZetarisQuery(sql)`
- Policy gate: `src/integrations/zetaris/sql-policy.ts` → `validateReadOnlyZetarisSql(sql)`
- Tool wiring: `src/core/execution/builtin-tools.ts` (`run_sql`) via `src/core/execution/tool-registry.ts`
- Verification: `src/core/verification/checks.ts` (`zetaris-result` check)

## API contract (validated 2026-10-23)

Against current `zetaris/getting-started` docs:

- Use your own instance (local bundle via Zetaris Cloud or AWS). The repo supplies recipes only.
- Recommended beginner path is SQL Editor; coding assistants use JDBC with the Zetaris driver;
  HTTP helpers in `scripts/` use UI proxy routes with `.env.local` auth, not the raw API URL.
- The raw REST route VOW uses is:
  `POST {ZETARIS_REST_URL}/sql-editor/sqls/run`
  with headers `Authorization: Bearer <key>`, `X-Org-ID: <org>`, `X-Request-ID: <uuid>`
  and body `{ queryId, sql, source: "SqlEditor", limit: 100 }`.
- Success shape VOW accepts: `{ data: unknown[][] }` (array of row-arrays), sliced to 100.
  Anything else is rejected as `unexpected response format` — no silent coercion.
- This matches the demo-dataset flow (`docs/guides/first-dataset.md`: minimal PokéAPI JSON subset,
  one complete statement at a time, inspect actual rows). VOW's demo table is
  `pokeapi.pikachu_abilities_table`.

Local probe on 2026-10-23: `localhost:8888` is reachable but returned
`HTTP 400 {"msg":"Not Allowed"}` for a dummy-key request, and `400 missing X-Org-ID`
without headers. That proves the route exists but no valid dataset/credential was
available in this environment. Live status is therefore **UNVERIFIED** until a real
instance + key + dataset is supplied. No rows were invented.

## Required environment

```sh
ZETARIS_REST_URL=http://localhost:8888/api/v1.0
ZETARIS_ORG_ID=1
ZETARIS_API_KEY=<server-side only, never commit>
ZETARIS_TIMEOUT_MS=15000
```

`getZetarisStatus()` reports `enabled:false` with the missing names when any of the
first three is blank. `run_sql` then fails honestly instead of inventing rows.

## Demo dataset requirement

Create (or onboard with `open_data/manifest.json` + `onboard.py`) a view/table named:

`pokeapi.pikachu_abilities_table(pokemon_name TEXT, ability_name TEXT, is_hidden BOOLEAN)`

with at least one row `('pikachu', <ability>, <bool>)`. The verification check fails
a Pikachu query with zero rows as `unverified` — empty results do not count as success.

Allowed SQL (enforced twice — Warden policy + client revalidation):

```sql
SELECT ability_name, is_hidden
FROM pokeapi.pikachu_abilities_table
WHERE pokemon_name = 'pikachu'
ORDER BY ability_name
LIMIT 100
```

Only `SELECT <approved cols> FROM pokeapi.pikachu_abilities_table [WHERE col OP value ...]
[ORDER BY ...] [LIMIT 1..100]`, ≤2000 chars, no `; -- /* */ #`, single statement.
Anything else is rejected before fetch.

## Reproducible demo

1. Set the four env vars above with a real key/org.
2. `npm run dev -- -p 3001`, open `http://localhost:3001`.
3. Run: `Query Pikachu abilities from pokeapi.pikachu_abilities_table`.
4. Expect: deterministic plan → Warden `run_sql: allow` → `zetaris-result: passed`
   with executed SQL, N rows, matching rowCount, and requestId in the trace.
