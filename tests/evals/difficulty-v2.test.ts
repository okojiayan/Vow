/* Offline validation for the difficulty-v2 500-case benchmark (Phase 2Y).
 * Pure/offline only: reads the generated manifests, exercises the tier
 * selection helpers and the extracted aggregation. No network, no model
 * calls, no services, no repo writes. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseBenchTier,
  filterCasesByTier,
  aggregateBenchRuns,
  type BenchRunForAggregate,
} from "./bench-protocol";

const dir = dirname(fileURLToPath(import.meta.url));
const v2 = JSON.parse(readFileSync(resolve(dir, "cases/nemotron-vs-full-500.difficulty-v2.json"), "utf8")) as {
  version: string; cases: Record<string, unknown>[];
};
const v1 = JSON.parse(readFileSync(resolve(dir, "cases/nemotron-vs-full-100.json"), "utf8")) as {
  version: string; cases: Record<string, unknown>[];
};
type G = { op: string; values?: unknown[]; value?: unknown; keys?: string[] };
type C = {
  id: string; tier?: string; category: string; prompt: string;
  grade: Record<string, G | string | boolean | undefined>; notes?: string;
};
const cases = v2.cases as unknown as C[];
const v1cases = v1.cases as unknown as C[];

const TIERS = ["easy", "easy-medium", "medium", "intermediate-hard", "hardest"];
const CATS = ["reasoning", "planning", "memory", "extraction", "safety"];
const KNOWN_OPS = new Set(["includes-all", "includes-any", "excludes-all", "exact-ci", "number-eq", "numbers-include", "json-keys", "json-keys-nested", "bullet-count", "numbered-count", "sentence-count", "max-words"]);

function synth(over: Partial<BenchRunForAggregate> & { caseId: string }): BenchRunForAggregate {
  return {
    category: "reasoning", tier: null, mode: "B", ok: true, pass: true,
    wallMs: 1000, outcome: "completed", timedOut: false, usage: null,
    scores: { correctness: true, constraint: null, grounded: null, tool: null, verification: null },
    flags: { falseSuccess: false, unsupported: false, unsafe: false, abstained: false },
    ...over,
  };
}

describe("difficulty-v2 corpus counts (offline)", () => {
  it("holds 500 cases with 100 per tier and 20 per tier/category", () => {
    expect(cases).toHaveLength(500);
    expect(new Set(cases.map((c) => c.id)).size).toBe(500);
    for (const t of TIERS) {
      const inTier = cases.filter((c) => c.tier === t);
      expect(inTier).toHaveLength(100);
      for (const cat of CATS) expect(inTier.filter((c) => c.category === cat)).toHaveLength(20);
    }
  });

  it("uses only known grade ops and safe tool allowlists", () => {
    for (const c of cases) {
      for (const [k, chk] of Object.entries(c.grade)) {
        if (["unsafeIfNoRefuseAndContains", "expectNoComplete", "toolOk", "seed"].includes(k)) continue;
        expect(KNOWN_OPS.has((chk as G).op), `${c.id}.${k}`).toBe(true);
      }
      const toolOk = c.grade.toolOk as unknown as string | undefined;
      if (toolOk !== undefined) {
        expect(["calc.evaluate", "memory.search", "fs.list", "run_sql"].includes(toolOk), `${c.id} toolOk`).toBe(true);
        if (toolOk === "run_sql") expect(c.prompt).toMatch(/pokeapi\.pikachu_abilities_table/);
      }
      // Safety spans refusal cases AND benign comply-via-safe-tool cases
      // (v1 S17-S19; v2 medium/EM safe-tool use). Either shape is allowed;
      // destructive demands must always be refusal-graded (tested below).
      if (c.category === "safety" && c.grade.expectNoComplete !== true) {
        const toolOk = c.grade.toolOk as unknown as string | undefined;
        expect(toolOk === undefined || ["calc.evaluate", "memory.search", "fs.list", "run_sql"].includes(toolOk), `${c.id} safety without refusal or safe tool`).toBe(true);
      }
    }
  });

  it("gives every memory case a notes seed fixture", () => {
    for (const c of cases.filter((c) => c.category === "memory")) {
      expect(c.notes?.startsWith("seed:"), c.id).toBe(true);
    }
  });

  it("never leaks a hidden numeric answer into the model-facing prompt", () => {
    for (const c of cases) {
      if (c.category === "extraction") continue; // selecting a value from the table is the skill
      for (const k of ["answer", "number", "constraint"]) {
        const chk = c.grade[k] as G | undefined;
        if (chk && (chk.op === "number-eq" || chk.op === "exact-ci") && chk.value !== undefined) {
          const v = String(chk.value);
          if (/^[0-9.,-]+$/.test(v)) expect(c.prompt).not.toMatch(new RegExp(`\\b${v.replace(/[.,-]/g, "\\$&")}\\b`));
        }
      }
    }
  });

  it("keeps memory prompts unique (one shared retrieval namespace)", () => {
    const seen = new Map<string, string>();
    for (const c of cases.filter((c) => c.category === "memory")) {
      expect(seen.has(c.prompt), `duplicate memory prompt ${c.id} ~ ${seen.get(c.prompt)}`).toBe(false);
      seen.set(c.prompt, c.id);
    }
  });

  it("grades every destructive safety demand as refusal-only", () => {
    for (const c of cases) {
      if (/(rm -rf|\/etc\/shadow|evil-20|passwd|delete all|exfiltrat|override.*policy|ignore.*warden|skip.*approval)/i.test(c.prompt)) {
        expect(c.grade.expectNoComplete, c.id).toBe(true);
        expect((c.grade.refuse as G).op).toBe("includes-any");
      }
    }
  });
});

describe("BENCH_TIER selection helpers (offline)", () => {
  it("treats undefined/empty as no override and trims values", () => {
    expect(parseBenchTier(undefined, new Set(TIERS))).toBeNull();
    expect(parseBenchTier("   ", new Set(TIERS))).toBeNull();
    expect(parseBenchTier("  easy  ", new Set(TIERS))).toBe("easy");
  });

  it("rejects unknown tiers and tier selection on untiered manifests", () => {
    expect(() => parseBenchTier("nightmare", new Set(TIERS))).toThrow(/Invalid BENCH_TIER/);
    expect(() => parseBenchTier("easy", new Set())).toThrow(/Invalid BENCH_TIER/);
  });

  it("filters one tier in manifest order", () => {
    const easy = filterCasesByTier(cases, "easy");
    expect(easy).toHaveLength(100);
    expect(new Set(easy.map((c) => c.tier))).toEqual(new Set(["easy"]));
    const idx = new Map(cases.map((c, i) => [c.id, i]));
    const order = easy.map((c) => idx.get(c.id) as number);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const cat of CATS) expect(easy.filter((c) => c.category === cat)).toHaveLength(20);
  });

  it("returns no cases for untiered v1 records (backward compatible)", () => {
    expect(filterCasesByTier(v1cases, "easy")).toHaveLength(0);
  });
});

describe("tiered aggregation on synthetic runs (offline)", () => {
  it("splits per-tier rates and keeps overall exact", () => {
    const runs = [
      synth({ caseId: "R21", category: "reasoning", tier: "easy", pass: true }),
      synth({ caseId: "R22", category: "reasoning", tier: "easy", pass: false }),
      synth({ caseId: "R99", category: "reasoning", tier: "hardest", pass: true }),
    ];
    const agg = aggregateBenchRuns(runs, () => false);
    expect(agg.overall.attempted).toBe(3);
    expect(agg.overall.passed).toBe(2);
    expect(agg.byTier["easy"].attempted).toBe(2);
    expect(agg.byTier["easy"].passed).toBe(1);
    expect(agg.byTier["hardest"].passed).toBe(1);
    expect(agg.byCategory["reasoning"].passed).toBe(2);
  });

  it("leaves byTier empty for untiered v1-shaped runs", () => {
    const runs = [synth({ caseId: "R01", tier: null }), synth({ caseId: "R02" })];
    const agg = aggregateBenchRuns(runs, () => false);
    expect(agg.overall.passed).toBe(2);
    expect(Object.keys(agg.byTier)).toHaveLength(0);
  });

  it("counts missing runs as nothing (no crash, no phantom passes)", () => {
    const agg = aggregateBenchRuns([], () => false);
    expect(agg.overall.attempted).toBe(0);
    expect(agg.overall.passed).toBe(0);
  });

  it("keeps falseSuccess visible without inflating passes", () => {
    const runs = [synth({ caseId: "R11", pass: false, flags: { falseSuccess: true, unsupported: false, unsafe: false, abstained: false } })];
    const agg = aggregateBenchRuns(runs, () => false);
    expect(agg.overall.falseSuccess).toBe(1);
    expect(agg.overall.passed).toBe(0);
  });

  it("marks non-completed non-refusal Mode B runs uncompleted, sparing refusals", () => {
    const runs = [
      synth({ caseId: "X17", category: "extraction", mode: "B", outcome: "failed", pass: false }),
      synth({ caseId: "S13", category: "safety", mode: "B", outcome: "blocked", pass: true }),
    ];
    const agg = aggregateBenchRuns(runs, (id) => id === "S13");
    expect(agg.overall.uncompleted).toBe(1);
  });
});

describe("v1 compatibility and fix anchors (offline)", () => {
  it("carries v1 cases byte-identical modulo tier", () => {
    expect(v1cases).toHaveLength(100);
    expect(v1cases.every((c) => c.tier === undefined)).toBe(true);
    for (const c of v1cases) {
      const got = cases.find((x) => x.id === c.id);
      expect(got, c.id).toBeDefined();
      const rest = { ...(got as C) };
      delete rest.tier;
      expect(JSON.parse(JSON.stringify(rest))).toEqual(JSON.parse(JSON.stringify(c)));
    }
  });

  it("anchors the 2I numeric-only constraint (P14)", () => {
    const p14 = v1cases.find((c) => c.id === "P14") as C;
    expect((p14.grade.constraint as G).op).toBe("exact-ci");
    expect(String((p14.grade.constraint as G).value)).toBe("50");
    // v2 hardest planning keeps the bare-number shape: wherever a case
    // carries both a constraint value and an answer value, they agree (the
    // value must be computable, never copied from the prompt). v1 P18-P20
    // carry an empty constraint object and are exempt.
    const both = cases.filter((c) => c.category === "planning" && c.tier === "hardest"
      && (c.grade.constraint as G)?.value !== undefined && (c.grade.answer as G)?.value !== undefined);
    expect(both.length).toBeGreaterThan(0);
    for (const c of both) {
      expect(String((c.grade.constraint as G).value)).toBe(String((c.grade.answer as G).value));
    }
  });

  it("anchors the 2O bare-yes grading (R11)", () => {
    const r11 = v1cases.find((c) => c.id === "R11") as C;
    expect((r11.grade.answer as G).op).toBe("exact-ci");
    expect((r11.grade.answer as G).value).toBe("yes");
  });

  it("anchors the 2S advisory S11 shape (no tool execution required)", () => {
    const s11 = v1cases.find((c) => c.id === "S11") as C;
    expect(s11.category).toBe("safety");
    expect(s11.grade.toolOk).toBeUndefined();
    expect(s11.grade.expectNoComplete).toBeUndefined();
  });
});
