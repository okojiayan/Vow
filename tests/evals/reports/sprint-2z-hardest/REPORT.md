# Nemotron vs Full VOW benchmark (matched, n=10)

- Live model: `nvidia/nemotron-3-ultra-550b-a55b` (verified via /v1/models and per-run provider field). Decoding: temperature 0.2, max_tokens 1200, timeout 120000ms.
- Timeout policy: per-model-call 120000ms shared by gate, preflight, Mode A and Mode B; task deadline 360000ms for full VOW tasks; gate file timeoutMs=120000ms; METERLESS_TIMEOUT_MS=120000ms.
- Mode A pass rate: 50% (5/10). Mode B pass rate: 100% (10/10).
- Provenance (observed, not configured): Mode A paths {"provider-analysis":7,"not-invoked":3} passed-by-path {"provider-analysis":5}.
- Provenance (observed, not configured): Mode B paths {"provider-analysis":2,"heuristic-fallback":7,"tool-grounded":1} passed-by-path {"provider-analysis":2,"heuristic-fallback":7,"tool-grounded":1}.
- Deterministic-tool and tool-grounded passes are VOW system successes via real tool evidence, not provider-backed inference successes.
- Provenance-aware task completion (non-refusal passes with proven evidence): A 0/10 (0%) | B 0/10 (0%).
- Proven model-backed passes (recorded provider evidence, heuristic-demo excluded): A 0/10 (0%; eligible-only 0% at 100% coverage) | B 0/10 (0%; eligible-only 0% at 100% coverage).
- Fallback/unproven passes (heuristic-demo, missing, or unknown provenance): A 0 | B 0. Refusal passes (safety, not completion): A 5 | B 10. Not executed: A 0 | B 0.
- Paired: B wins 5, A wins 0, ties 5; difference 50pp, 95% CI [6.2, 93.8] (paired Wald on discordant pairs).
- Latency median/p95: A 4387/13887ms; B 5667/22602ms.
- Errors/timeouts: A 3/0; B 0/0.
- Staged batch: index 9, size 10, cases 10; circuit breaker: not tripped (11 infra observations). See transport-summary.json for end-to-end vs provider-conditional rates.
- False success (B completed but wrong): 0. Unsupported claims: A 0, B 0. Unsafe actions: A 0, B 0.
## Per-category pass rates
- safety: A 50% (5/10) | B 100% (10/10)
## Per-tier pass rates
- hardest: A 50% (5/10) | B 100% (10/10)
