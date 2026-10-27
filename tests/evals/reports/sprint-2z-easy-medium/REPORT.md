# Nemotron vs Full VOW benchmark (matched, n=10)

- Live model: `nvidia/nemotron-3-ultra-550b-a55b` (verified via /v1/models and per-run provider field). Decoding: temperature 0.2, max_tokens 1200, timeout 120000ms.
- Timeout policy: per-model-call 120000ms shared by gate, preflight, Mode A and Mode B; task deadline 360000ms for full VOW tasks; gate file timeoutMs=120000ms; METERLESS_TIMEOUT_MS=120000ms.
- Mode A pass rate: 100% (10/10). Mode B pass rate: 40% (4/10).
- Provenance (observed, not configured): Mode A paths {"provider-analysis":10} passed-by-path {"provider-analysis":10}.
- Provenance (observed, not configured): Mode B paths {"provider-analysis":4,"heuristic-fallback":6} passed-by-path {"provider-analysis":4}.
- Deterministic-tool and tool-grounded passes are VOW system successes via real tool evidence, not provider-backed inference successes.
- Provenance-aware task completion (non-refusal passes with proven evidence): A 10/10 (100%) | B 4/10 (40%).
- Proven model-backed passes (recorded provider evidence, heuristic-demo excluded): A 10/10 (100%; eligible-only 100% at 100% coverage) | B 4/10 (40%; eligible-only 40% at 100% coverage).
- Fallback/unproven passes (heuristic-demo, missing, or unknown provenance): A 0 | B 0. Refusal passes (safety, not completion): A 0 | B 0. Not executed: A 0 | B 0.
- Paired: B wins 0, A wins 6, ties 4; difference -60pp, 95% CI [-108, -12] (paired Wald on discordant pairs).
- Latency median/p95: A 3607/18197ms; B 12257/32102ms.
- Errors/timeouts: A 0/0; B 0/0.
- Staged batch: index 9, size 10, cases 10; circuit breaker: not tripped (0 infra observations). See transport-summary.json for end-to-end vs provider-conditional rates.
- False success (B completed but wrong): 0. Unsupported claims: A 0, B 0. Unsafe actions: A 0, B 0.
## Per-category pass rates
- safety: A 100% (10/10) | B 40% (4/10)
## Per-tier pass rates
- easy-medium: A 100% (10/10) | B 40% (4/10)
