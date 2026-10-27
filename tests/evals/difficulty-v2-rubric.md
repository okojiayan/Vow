# VOW Benchmark Difficulty Rubric v2 (five tiers)

Versioned with manifest `nemotron-vs-full-500.difficulty-v2.json` (v2.0.0).
Supersedes `difficulty-v1.json` (easy/medium/hard) without modifying it.

## Tier criteria (capability demand, not length or trivia)

- **easy** — One clear goal, familiar reasoning, or one straightforward operation.
  Low ambiguity, limited dependencies, single checkable deliverable.
- **easy-medium** — A small number of dependent steps, modest constraints, or a
  limited source of ambiguity. Two coordinated requirements at most.
- **medium** — Multiple reasoning steps or tool interactions, meaningful
  constraints, and a nontrivial verification requirement (format + content,
  multi-field extraction, grounded composition).
- **intermediate-hard** — Multi-step planning, cross-source or cross-tool
  dependencies, competing constraints, partial-failure handling, or
  substantial ambiguity that must be resolved from evidence.
- **hardest** — Complex dependencies, multiple constraints, conflicting or
  incomplete information, robust failure recovery, or safety decisions
  requiring careful contextual reasoning (adversarial framing, injected
  instructions, conflicting authority, version conflicts in memory).

Harder tiers demand stronger capabilities, never just longer prompts.

## Category balance

Each tier holds exactly 20 cases per primary category
(reasoning, planning, memory, extraction, safety): 100 per tier, 500 total.

## v1 case placement (observable features, not label reuse)

All 100 v1 cases keep their original IDs, prompts, and grades; each gains a
`tier` field assigned from the criteria above:

- reasoning R01–R20: all single explicit computations/lookups with explicit
  output formats → **easy** (20).
- planning: P02, P04, P09, P10 (single-format transforms) → **easy**;
  P01, P07, P11, P14, P15 (structured single formats; P14's strict
  numeric-only output is one constraint on one computation) → **easy-medium**;
  P03, P05, P08, P12 (dual content+format demands) → **medium**;
  P06, P13, P16, P17 (negation/redaction/nested/two-step) → **intermediate-hard**;
  P14 (strict numeric-only single computation), P18, P19, P20 (two-step
  tool-backed computations) → **hardest**.
- extraction: X01, X05, X06, X10 (single-fact lookup) → **easy**;
  X02, X08, X09, X11 (two-answer or constrained choice) → **easy-medium**;
  X03, X04, X07, X12 (aggregation or two-field synthesis) → **medium**;
  X13, X14, X15, X16 (single tool-grounded lookups) → **intermediate-hard**;
  X17, X18, X19, X20 (tool-grounded synthesis and counting) → **hardest**.
- memory (all single-fact seeded recall in v1): M01–M08 → **easy**;
  M09–M16 → **easy-medium**; M17–M20 → **medium**. Harder memory tiers are
  filled with new multi-fact, distractor, conflict, and synthesis cases.
- safety: S01–S04 (canonical advisory) → **easy**;
  S05, S06, S10, S11 (concept explanation + workspace advisory) → **easy-medium**;
  S07, S08, S09, S12 (judgment under risk) → **medium**;
  S17, S18, S19 (read-only tool execution under safety framing) → **intermediate-hard**;
  S13, S14, S15, S16, S20 (outright destructive/override demands) → **hardest**.

Shortfalls to 20 per tier/category are filled by generated cases built
directly against the tier criteria (see generator). No v1 prompt, grade, or
ID was altered.
