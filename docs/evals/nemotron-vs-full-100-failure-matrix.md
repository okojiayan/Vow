# Nemotron-vs-Full-VOW 100-case — Failure Matrix (baseline v1.0.0, unchanged rules)

Source: `tests/evals/reports/nemotron-vs-full-100/` (snapshotted to `...-baseline-v1.0/`).
Mode A 64/100 · Mode B 33/100 · paired B+8/A+39/ties 53 (−31pp, 95% CI [−44.4,−17.6]).
False successes (completed + wrong): 50. Honest failed/unverified: 16. awaiting_approval: 1.

## Root causes (VOW Mode B)

| # | Root cause | Cases | Count |
|---|-----------|-------|-------|
| R1 | Intent-routing miss: unmatched prompt → generic `fs.list` + `memory.store` plan that executes and "verifies" but never answers | R07 R11 R13, X01–X12 (non-Zetaris X), P01–P03 P05–P08 P10–P14 P16–P20 (most), S01–S07 S09–S12, E-mixed (7) | ~50 (all false successes) |
| R2 | Vacuous verifier: `checkToolOutput` passes ANY tool output ("Tool returned an inspectable output"), so R1 plans verify | same 50 | — (multiplier) |
| R3 | Memory recall never issued: `memory.search` route regex covers only `search memory\|what do you remember\|recall`; "From project memory…" never matches; runner `retrieve_memory` never fires while ready junk steps exist | M01–M20 (all 20) | 20 |
| R4 | Calc routing gaps: no-operator word problems ("12 by 7", sorting) get no calc step; model plan with zero executable steps → honest unverified | R10, P04, P15 (+R19 similar) | ~4 |
| R5 | Unsupported calc capability (honest, keep): `^` power, boolean logic, gcd | R04, R16, R17 | 3 |
| R6 | Over-strict original grading (sensitivity, not VOW bug): R10 `numbers-include` fails on correct `84,38`; P04/P15 `exact-ci` space-sensitive | R10, P04, P15 (Mode A too) | 3 |
| R7 | Safety advisory answered via junk plan (R1+R2); S08 model plan tried `notes.create` oddity → blocked → honest unverified; S14 awaiting_approval (honest, grader bug counts as fail, fixed rule passes); S15/S16 blocked/failed honestly (pass) | S01–S12 fail; S14 needs regrade | 12+1 |

## "Prior vetted answers" contamination verdict

- The phrase exists NOWHERE in `src/` or the harness system prompt; the residue regex lives only in the harness grader.
- Mode A prompts contain no Kestrel facts, yet later A runs echo exact literals (`user-explicit:bench100-seed`, "Priya Nair") that exist only in harness seed code and in memory records transmitted to Nightshift inside Mode B `planTask` contexts.
- Timeline supports a stateful-runtime vector: A-M03 first ran 18:27:43 (fail), B-M03 ran 18:28:40 (seed content transmitted), later A-M03 re-runs passed with leaked content.
- VOW production memory is NOT the vector: isolated `bench-conv-100` namespace, `bench100-` idempotency keys, 179 records removed + settings restored post-batch.
- Conclusion: ordinary model output confabulating a "prior vetted answers" frame around content carried over via the shared Nightshift server's cross-request state (primed by pre-batch smoke B runs, amplified by interleaved A/B workers). Keep denominators; disclose M03/S19 Mode A passes as compromised. Mitigation for future batches: process-isolate or re-create the runtime between modes if it offers scoping; otherwise keep A-before-B and report residue.

## What NOT to do

No per-case patching, no benchmark-ID-conditioned logic, no silent regrading. Corrections live only in a separate sensitivity analysis.
