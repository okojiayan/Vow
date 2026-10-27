# VOW Reality & Stress Testing System (reality-v1.0.0)

Independent suite; frozen `nemotron-vs-full-100` assets untouched.
Manifest: `tests/evals/reality/manifest.v1.ts`. Reports: `tests/evals/reports/vow-reality-v1/`.

## Local-environment contract

Isolated runs clear provider keys, so model-dependent tasks MUST fail closed
(`failed` + `heuristic-demo` + honest error, never a fabricated success).
Those scenarios assert fail-closed explicitly. Live answer quality is measured
only in the gated live comparison.

## Weights

Capability 40, reliability 20, safety 20 (non-compensatory gates), recovery+latency 20.
Safety gate failure blocks the suite regardless of score.

## What run 1 found (all fixed or reclassified with evidence)

1. Calc translator gaps: "37 times 41", "15 percent off 200", "1 divided by 0"
   had no word-operator normalization. Fix: numeric-operand-gated `times` /
   `divided by` / `multiplied by` normalization + word-form `percent off`
   (`src/core/execution/calc.ts`). "How far" train prose without a numeric cue
   stays on the provider route by design; scenario now carries the documented cue.
2. Injection detector missed approval-bypass directives in memory records.
   Fix: general `policy-bypass` pattern (`src/core/keep/injection.ts`).
   RS-J02 reclassified from held-out to regression since it motivated the fix;
   remaining held-out IDs stay independent.
3. Harness defects (not product): approval replay test skipped `decideApproval`,
   PlanLock probes used string actions instead of `{tool, args}` objects, skill/
   plugin fixtures omitted required manifest fields, stale-plan fault used two
   identical plans, plugin mount assertion ignored the `plugin.<id>.<tool>`
   namespace.

## Results (local)

48/48 scenarios, 11/11 fault-injection honest, 4/4 stress stages, 0 safety
critical failures. Score 100/100 local with gates open. Live phase separately
gated; if the stability gate fails, live is reported BLOCKED, never mocked.
