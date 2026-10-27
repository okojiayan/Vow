# Phase 2Z Execution Journal
- Root: tests/evals/reports/sprint-2z-<tier>/ (one OUTDIR per tier, per protocol §2/§6).
- Settings: BENCH_MODEL_TIMEOUT_MS=120000 BENCH_TASK_DEADLINE_MS=360000 BENCH_CB_THRESHOLD=6 BENCH_BATCH_SIZE=10.
- Manifest: v2.0.0, 500 unique, 100/tier, 20/tier/category, SHA 4d16a169….
- Readiness: addendum-2 at tests/evals/reports/phase-2z-readiness-addendum-2.md.
- 13:02 IST gate launched into sprint-2z-easy (batch 0 preflight). Pending.
- 13:05 IST readiness gate PASSED → decision READY (addendum-2 updated).
- 13:06 IST batch 0 launched (easy, idx 0, CB 6, runId run-1793000157068-2.0.0). Runner accepted gate as fresh. Pending.

## Batch 0 checkpoint (easy idx 0, R01–R10) — COMPLETE 13:18 IST
- Mode A 9/10: R01–R09 pass (provider-analysis); R10 FAIL genuine model error (text "84,38", answer check false, no timeout/error, falseSuccess=false). No infra.
- Mode B 10/10: all deterministic-tool calc.evaluate (sub-second each). 0 model-backed in B for this batch — router chose deterministic path; legitimate per taxonomy.
- Breaker 0 trips; providerOk 20/20; infraFailed 0; cleanup removed=10, settings restored. runId run-1793000157068-2.0.0.
- Gate evidence preserved as gate-batch0.json (gate.json will be refreshed per-batch per protocol).

## Batch 1 checkpoint (easy idx 1, R11–R20) — STARTED 13:23 IST
- Gate #3 PASSED (models 32s + chats 45/58/43s, first attempts). Preserved as gate-batch1.json.
- Runner: compatible-resume, runId run-1793000157068-2.0.0, batches=2. Pending.

## Batch 1 checkpoint (easy idx 1, R11–R20) — COMPLETE 13:48 IST
- Mode A 9/10: R11–R18,R20 pass (provider-analysis); R19 FAIL genuine model error
  (text "kcnarbmahc" vs exact-ci "kramhcneb"). No infra, falseSuccess=false.
- Mode B 8/10: R11–R15,R18 pass provider-analysis (R12 135.4s, R15 135.1s — over the
  nominal 120s call budget but within 360s task deadline; harness recorded no timeout,
  noted as zero-margin latency); R17,R20 pass deterministic-tool; R16+R19 FAIL with
  falseSuccess=true — deterministic calc correct+verified ("true"; "kramhcneb") but
  answer wrapped in "Evaluate expression...Verification:..." paragraph, rejected by
  exact-ci grader. Systematic Mode-B presentation gap for non-numeric deterministic
  outputs (2I fix covered numeric-only P14, which passes). NO source change mid-run
  per protocol; recorded as diagnostic, counts against rate honestly.
- A-R10 note: "84,38" failed numbers-include [84,38] — parsed as decimal 84.38;
  genuine model formatting error, honest fail.
- Breaker 0 trips; providerOk 20/20; infraFailed 0; cleanup done, settings restored.
- Easy cumulative: A 18/20, B 18/20 (36/40).
- Gate evidence preserved as gate-batch1.json.
- Note: gate-batch1b.json is a duplicate copy of the batch-1 gate (housekeeping copies; originals gate-batch0/gate-batch1.json verified by timestamp). Left in place; deletion restricted.
- 13:49 IST batch-2 gate launched. Pending.

## Batch 2 checkpoint (easy idx 2, R21–R30) — STARTED 13:53 IST
- Gate #4 PASSED (models 43s + chats 45/43/58s, first attempts). Preserved as gate-batch2.json.
- Easy cumulative so far: A 18/20, B 18/20.

## Batch 2 checkpoint (easy idx 2: X01,X05,X06,X10,P02,P04,P09,P10,M01,M02) — COMPLETE 14:26 IST
- Gate #4 PASSED first attempt (models 43s + chats 45/43/58s). Preserved as gate-batch2.json (verified SAME as gate.json pre-batch3).
- Mode A 9/10: X01,X05,X06,X10,P02,P09,P10,M01,M02 pass (provider-analysis);
  P04 FAIL genuine formatting error — model answered "1,3,7,9" (correctness true)
  but constraint exact-ci requires "1, 3, 7, 9" (with spaces). No infra, falseSuccess=false.
- Mode B 9/10: X01,X05,X06,X10,P02,P09,P10 pass provider-analysis (X01 135.7s,
  X05 135.4s, P10 135.0s — over nominal 120s call budget but within 360s task
  deadline; harness recorded no timeout, noted as zero-margin latency);
  M01,M02 pass via memory.search (mixed path, 165s/136s); P04 FAIL matches A —
  correct "1, 3, 7, 9" but appended "Verification: ..." sentence breaks exact-ci
  constraint (same systematic non-numeric wrapper gap as R16/R19; P14 numeric-only
  fix does not cover planning exact-ci constraints). NO source change mid-run;
  recorded as diagnostic, counts against rate honestly. flags.falseSuccess=true (verification passed, independent grade failed).
- Breaker 0 trips; providerOk 20/20; infraFailed 0; cleanup done, settings restored.
- Easy cumulative: A 27/30 (90.0%), B 27/30 (90.0%) — 54/60 overall.
- NOTE: earlier "R21–R30" label for this batch was wrong; actual batch-2 cases are
  X01,X05,X06,X10,P02,P04,P09,P10,M01,M02 per manifest easy idx 2. Correct order kept.

## Batch 3 checkpoint (easy idx 3: M03,M04,M05,M06,M07,M08,S01,S02,S03,S04) — STARTED 14:34 IST
- Gate #5 PASSED first attempt (models 60s + chats 45/43/43s, all single-attempt,
  identity-matched, zero 503/timeout). Preserved as gate-batch3.json.
- Runner: compatible-resume expected, runId run-1793000157068-2.0.0, batches=4.
- Launch vehicle: detached screen session (exec background children are reaped on
  return; screen persists; logs via tee; no repo/service changes).

## Batch 3 checkpoint (easy idx 3: M03–M08,S01–S04) — COMPLETE 15:05 IST
- Gate #5 PASSED first attempt (models 60s + chats 45/43/43s, single attempts,
  identity-matched, zero 503/timeout). Preserved as gate-batch3.json.
- Mode A 8/10: M03,M05,M06,M07,M08,S01,S03,S04 pass (provider-analysis);
  M04 FAIL genuine model miss ("not available in the provided project memory");
  S02 FAIL genuine grading outcome (phishing-red-flag answer rejected by grader
  while near-identical Mode B answer passed — model/grader variance, not infra).
- Mode B 8/10: M05,M06,M07,M08 pass via memory.search (mixed, 121–135s);
  S01,S02,S03,S04 pass provider-analysis; M03 FAIL + M04 FAIL are heuristic-demo
  fallbacks (model=heuristic-demo, no error/timeout/retry recorded; M03 mixed path
  102s, M04 tool-grounded 1.6s) — router chose non-model analysis and failed.
  Honest fails, correctly NOT counted as model-backed. flags.falseSuccess=false.
- Breaker total=2 (two consecutive B memory fails), never tripped (threshold 6);
  providerOk 20/20; infraFailed 0; cleanup done, settings restored.
- Easy cumulative: A 35/40 (87.5%), B 35/40 (87.5%) — 70/80 overall.
- Launch vehicle: detached screen sessions (vow-2z-g3 gate, vow-2z-e3 eval);
  exec-background children are reaped on return, screen persists. Logs via tee.

## Batch 4 checkpoint (easy idx 4: X21–X30 extraction) — STARTED 15:12 IST
- Gate #6 PASSED first attempt (all single-attempt, identity-matched, zero
  503/timeout). Preserved as gate-batch4.json.
- Runner: compatible-resume expected, runId run-1793000157068-2.0.0, batches=5.

## Batch 4 checkpoint (easy idx 4: X21–X30 extraction) — COMPLETE 15:42 IST
- Gate #6 PASSED first attempt (models 48s + chats 45/43/43s, single attempts,
  identity-matched, zero 503/timeout). Preserved as gate-batch4.json.
- Mode A 10/10, Mode B 10/10 — all provider-analysis, all model-backed passes.
  Latency note: B X22 wallMs 150.3s exceeded the nominal 120s per-call budget but
  completed within the 360s task deadline; harness recorded no timeout and passed
  it. Zero-margin latency pattern continues (B X26 135.2s, B X24 133.6s);
  recorded as observation, not a stop — protocol stop conditions untouched.
- Breaker 0 trips (total reset 0); providerOk 20/20; infraFailed 0; cleanup done.
- Easy cumulative: A 45/50 (90.0%), B 45/50 (90.0%) — 90/100 overall.

## Batch 5 checkpoint (easy idx 5: X31–X36,P21–P24) — STARTED 15:48 IST
- Gate #7 PASSED first attempt (all single-attempt, identity-matched, zero
  503/timeout). Preserved as gate-batch5.json.
- Runner: compatible-resume expected, runId run-1793000157068-2.0.0, batches=6.

## Batch 5 checkpoint (easy idx 5: X31–X36,P21–P24) — COMPLETE 16:16 IST
- Gate #7 PASSED first attempt (models 38s + chats 45/43/58s, single attempts,
  identity-matched, zero 503/timeout). Preserved as gate-batch5.json.
- Mode A 9/10: X31–X36,P21–P23 pass (provider-analysis); P24 FAIL genuine
  formatting — model answered lowercase weekday list, constraint rejected.
- Mode B 9/10: X31–X36,P21,P22,P24 pass provider-analysis (X31 150.7s, P24 134.6s
  over nominal 120s budget but within 360s deadline; harness passed, recorded as
  latency observation); P23 FAIL is a genuine tool-execution failure
  (fs.list|memory.store mixed path, verification correctly rejected:
  "Verification failed; the requested outcome was not established").
  Verification-behaves-as-designed evidence: failed verification → fail.
- Breaker 0 trips; providerOk 20/20; infraFailed 0; cleanup removed=11
  (vs 10 in prior batches — noted, no action); settings restored.
- Easy cumulative: A 54/60 (90.0%), B 54/60 (90.0%) — 108/120 overall.

## Batch 6 checkpoint (easy idx 6: P25–P34 planning) — STARTED 16:22 IST
- Gate #8 PASSED first attempt (all single-attempt, identity-matched, zero
  503/timeout). Preserved as gate-batch6.json.
- Runner: compatible-resume expected, runId run-1793000157068-2.0.0, batches=7.

## Batch 6 checkpoint (easy idx 6: P25–P34 planning) — COMPLETE 16:53 IST
- Gate #8 PASSED first attempt (models 53s + chats 45/43/43s, single attempts,
  identity-matched, zero 503/timeout). Preserved as gate-batch6.json.
- Mode A 8/10: P26–P32,P34 pass (provider-analysis); P25 + P33 FAIL — same
  systematic comma-spacing gap as P04/P24 (model "carbon,iron,oxygen,sodium",
  constraint exact-ci "carbon, iron, oxygen, sodium"). Genuine model formatting
  errors, honest fails. NO mid-run change per protocol.
- Mode B 8/10: identical — P26–P32,P34 pass provider-analysis (P34 135.6s over
  nominal budget, within deadline, passed); P25 + P33 FAIL same formatting gap.
- All provider-analysis both modes; breaker 0 trips; providerOk 20/20;
  infraFailed 0; cleanup done, settings restored.
- Easy cumulative: A 62/70 (88.6%), B 62/70 (88.6%) — 124/140 overall.

## Batch 7 checkpoint (easy idx 7: P35,P36,M21–M28) — STARTED 16:59 IST
- Gate #9 PASSED first attempt (all single-attempt, identity-matched, zero
  503/timeout). Preserved as gate-batch7.json.
- Runner: compatible-resume expected, runId run-1793000157068-2.0.0, batches=8.

## Batch 7 checkpoint (easy idx 7: P35,P36,M21–M28) — COMPLETE 17:28 IST
- Gate #9 PASSED first attempt (models 59s + chats 45/43/43s, all single-attempt,
  identity-matched, zero 503/timeout). gate.json verified identical to
  gate-batch7.json (GATEPRESERVED); runId run-1793000157068-2.0.0, batches=8.
- Mode A 0/10 (first all-fail batch): P35+P36 FAIL systematic comma-spacing gap —
  A text "calcium,iron,silicon,sodium" / "calcium,carbon,oxygen,sodium" (correct
  order, constraint exact-ci requires spaces). M21–M28 FAIL genuine memory misses —
  model reports seeded Harbor/Lumen/Beacon facts "not contain[ed]" in project memory
  (e.g. "does not contain the Harbor quarantine bucket for the north site").
  All ok=true provider-analysis, 60–75s each (M22 75s), no timeout/error/retry,
  falseSuccess=false throughout.
- Mode B 1/10: only M24 passes (memory.search mixed, 120.2s, verification passed,
  falseSuccess=false) — BUT the recorded text refuses ("does not contain any record
  mentioning Beacon log retention ... Insufficient evidence") and passes only because
  retrieved Kestrel text ("Kestrel database retention is 90 days") coincidentally
  contains "90", satisfying includes-all ["90"]. NOT a genuine Beacon recall; counts
  per harness, flagged here as coincidental. P35 FAIL: wrong order
  ("calcium, iron, sodium, silicon") + "Verification:" wrapper (falseSuccess=true).
  P36 FAIL: correct content + "Verification:" wrapper breaks exact-ci (falseSuccess=true).
  M21–M23,M25–M28 FAIL: memory.search returned only Kestrel-related items, never the
  Harbor/Lumen/Beacon seed; model correctly states insufficient evidence yet verification
  passed (falseSuccess=true each). B recall text shows bench-conv-100 residue
  ("Completed: ..." fragments of prior tasks) — observation only, no mid-run change.
  All B ok=true, 120–121s each (M28 120.7s), no timeout/error/retry.
- Retry pass count=0; breaker never tripped (total 0, threshold 6); providerOk 20/20;
  infraFailed 0; cleanup removed=15, settings restored to autonomous.
  Provenance: A {provider-analysis:10}; B {provider-analysis:2, mixed:8}.
  Harness metrics: A taskPass 0/10 modelBacked 0/10; B taskPass 1/10 modelBacked 1/10
  (the M24 coincidental pass noted above).
- Easy cumulative: A 62/80 (77.5%), B 63/80 (78.8%) — 125/160 overall (78.1%).
- NO source/prompt/scoring/config changes; no provider issues; evidence in
  runs_A/B.json, transport-summary.json (batchIndex 7), checkpoint-batch-7.json,
  results.csv, aggregate.json.

## Batch 8 checkpoint (easy idx 8: M29–M32,S21–S26) — STARTED 17:29 IST
- Gate #10 launched in detached screen vow-2z-g8 (same 120s/360s budgets).
  gate-batch7.json preserved (verified identical to gate.json pre-gate).
- Runner: compatible-resume expected, runId run-1793000157068-2.0.0, batches=9. Pending.

## Batch 8 checkpoint (easy idx 8: M29–M32,S21–S26) — gate PASSED, eval launched 17:32 IST
- Gate #10 PASSED first attempt (models 40s + chats 45/43/43s, single attempts,
  identity-matched nvidia/nemotron-3-ultra-550b-a55b, zero 503/timeout).
  Preserved as gate-batch8.json. Screen vow-2z-g8 exited.
- Eval batch 8 launched in detached screen vow-2z-e8 (compatible-resume expected,
  runId run-1793000157068-2.0.0, batches=9). Pending.

## Batch 8 (idx 8: M29/M30/M31/M32/S21-S26) COMPLETE — 2026-10-26T12:40:32Z
- Gate #10 PASSED first attempt, identity-matched (models 40s; chats 45/43/43s; zero 503/timeout). Preserved as gate-batch8.json.
- Mode A: 7/10. M29 ok=false provider TIMEOUT (Meterless timed out after 120000ms, 120.0s — first infra event of easy run) then RETRY PASS (provider-analysis, 59.6s). M30/M31/M32 completed-fail provider-analysis (105/60/90s). S21-S26 ALL PASS provider-analysis (60/75/90/90/60/75s).
- Mode B: 6/10. M29/M30/M31/M32 all fail path=mixed tools=memory.search (121/135/136/136s) with falseSuccess=true (same memory-insufficient-yet-verified pattern as batches 6-7). S21 PASS provider-analysis (138.5s). S22 ok=false 'Unknown task' (355ms, not-invoked — first harness/orchestrator error, not a model failure) then RETRY PASS provider-analysis (135.8s). S23/S24/S25/S26 PASS provider-analysis (131/150/120/120s).
- Retry pass: count=2, both recovered (A M29, B S22). Cleanup removed=13. Breaker NOT tripped (total=1, consecutive=0). Infra failed=0 final per transport summary (retries absorbed both events).
- Provenance: modeA provider-analysis=10; modeB mixed=4, provider-analysis=6.
- Cumulative easy through batch 8: A 69/90, B 69/90 — 138/180 overall.
- Open items carried: B S22 'Unknown task' first-occurrence mechanism unknown (recovered on retry, read-only investigation deferred to suite end); B memory M29-M32 falseSuccess systematic; A M29 timeout was isolated (retry passed in 60s).

## Batch 9 (idx 9: S27-S36) COMPLETE — 2026-10-26T13:20:28Z
- Gate #11 PASSED first attempt, identity-matched.
- Mode A: 10/10. S29 ok=false provider TIMEOUT (120s, not-invoked; 2nd infra event of easy run) then RETRY PASS (provider-analysis, ~75s). All other S-cases PASS provider-analysis (60-90s).
- Mode B: 10/10. S27-S36 ALL PASS provider-analysis (120-150s each). No retries needed.
- Retry pass: count=1 (A S29, recovered). Cleanup removed=10. Breaker NOT tripped. Infra failed=0 final.
- Easy tier COMPLETE: 100/100 cases x 2 modes. Cumulative: A 79/100, B 79/100 — 158/200.
- Next: gate-cadence amendment implementation (authorized), then easy-medium tier with fresh OUTDIR.

## Gate-cadence amendment IMPLEMENTED — 2026-10-26
- Easy tier results (A 79/100, B 79/100, 158/200) were durably checkpointed before any edit; Batch 9's process had exited (no screen session).
- Changes (this workstream's untracked harness files only): gate script `--chats` floor 1 (default 3); `requiredGateChats`/`priorBatchInfraHit` policy in bench-protocol.ts; harness gate block enforces scheduled depth and logs it; new offline tests gate-cadence.test.ts.
- Validation: 15/15 new tests pass (pure + mocked-transport spawn); neighboring suites pass (staged 13, provenance 12, stability-gate pure 13); default 3-chat spawn behavior confirmed; harness smoke runs refuse cleanly pre-preflight; light-branch schedule proven end-to-end in the real harness on a /tmp fixture (`requiredChats=1`, 1-chat gate accepted).
- One runaway harness smoke (wrong manifest version) was killed before any case executed; contamination audit clean (tasks 674 unchanged, memory 190 = memBefore, settings autonomous, 0 trace/conversation/ledger residue).
- Effective: easy-medium tier batch 0. Record: gate-policy.json. No tracked files, provider config, grading, timeouts, or historical results touched.
