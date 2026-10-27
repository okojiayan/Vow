# Markovian engine provenance + conformance gaps (VOW custom implementation)

`src/core/agent/markovian-engine.ts` is **VOW-owned custom logic** implementing the
public Meterless Markovian specification. It is not the official engine, not an SDK
import, and must never be labelled "Meterless Markovian" as a provider claim.
Correct label: `VOW custom Markovian implementation (spec-aligned, estimated accounting)`.

Spec source (fetched 2026-10-23):
`meterless/meterless/engines/markovian/{README.md, AGENTS.md, docs/*, reference/}` —
an implementation spec + runnable reference, provider-agnostic via injected generator.

## What VOW implements (aligned)

- Chunked loop with injected `generator(prompt, systemPrompt)`; ARCHITECT/RESEARCH modes.
- Marker protocol primary + compat: `[STATE_CHECKPOINT]` / `[TASK_COMPLETE]` plus
  `@@@STATE@@@`, `---STATE---`, `[STATE]`, `<CARRYOVER>`, `@@@FINAL@@@`, `[FINAL]`,
  `---FINAL---`, `<DONE>` handling with stripping of `<think>` and markers from display.
- Compression cascade: explicit state → LLM compressor → heuristic tail → truncation.
- First-step-only memory context; later steps get `[CARRYOVER STATE]`, not full history.
- Load-time config validation (typed `ConfigValidationError`, no silent truncation);
  `overlapTokens != 0` is rejected rather than ignored (spec-compliant choice).
- Run record with per-run config snapshot, chunk records, efficiency math, reflection pass,
  abort/stopWhen support, provider usage accumulation when `usage` is supplied.
- Accounting honesty: `tokenLabel: "estimated"` always; `providerReportedTokens` +
  `providerUsageComplete` flag distinguish measured vs estimated. Traces record both.

## Gaps vs the official spec (do not blindly replace the working engine)

1. **Demo profile ≠ reference defaults.** VOW `DEFAULT_CHUNK_CONFIG` is
   `4000/4/640/0`; orchestrator uses `4000/3/640/0`. Reference defaults are
   `8000/24/800/0` (bounds overlap). VOW is intentionally smaller/bounded for demo
   cost control. Changing to 8000/24/800 would alter cost/latency behaviour — needs
   explicit product decision, not silent alignment.
2. **`step` bounds granularity.** Spec says steps of 1000/1/128 for the three fields;
   VOW enforces min/max ranges but not step multiples. Minor; add step validation only
   if the reference conformance suite requires it.
3. **Overlap is reject-only.** Spec allows implementations to implement `[OVERLAP]`
   prepending or reject non-zero. VOW rejects — compliant, but feature-incomplete if
   overlap-assisted tasks are ever needed. Implement `[OVERLAP]` block only on demand.
4. **Pause markers not implemented.** Spec's `[NEEDS_TOOL]` / `[NEEDS_CLARIFICATION]`
   pause-resume semantics have no VOW equivalent; the engine treats unknown markers as
   content. Fine for current use (VOW tools run outside the engine), but required before
   claiming full marker-protocol conformance.
5. **No Engine-tab / cumulative stats service.** Spec includes `MarkovianCumulativeStats`
   + historical analytics + token-economics demo charting. VOW keeps per-run traces only.
   Add persistence only if product wants cross-run analytics.
6. **No official conformance suite run.** There is no vendored `reference/` runner or
   spec test vector in this repo. Conformance evidence is code-review + unit tests
   (`tests/unit/agent/markovian-engine.test.ts`), not a spec-suite pass. Label accordingly.

## Decision

Keep the current VOW engine. It is tested, bounded, and honestly labelled. If official
conformance is required later: vendor the reference suite, add `[OVERLAP]` + pause-marker
handling + step-multiple validation behind flags, and run the suite without touching the
Reasoning Orchestrator (`orchestrator.ts`) or JSON Memory Engine semantics.
