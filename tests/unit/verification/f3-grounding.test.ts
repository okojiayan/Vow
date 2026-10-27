import { describe, expect, it } from "vitest";
import { verifySteps } from "@/core/verification/verifier";
import { checkAnalysis, checkCalc } from "@/core/verification/checks";
import {
  collectToolRows,
  deterministicAggregateLines,
  extractCountClaims,
  verifyCountClaims,
} from "@/core/verification/grounding";
import { summarize } from "@/core/agent/orchestrator";
import type { PlanStep } from "@/core/agent/types";

// Generic fixtures only: no benchmark IDs, prompts, or expected answers.
// A small synthetic widgets table stands in for any structured row evidence
// (the X20 shape: partition counts over a flag column).
const WIDGET_SQL =
  "SELECT widget_name, is_primary FROM demo.widgets_table WHERE kind = 'widget' ORDER BY widget_name LIMIT 100";

function sqlStep(rows: unknown[][], rowCount: number, sql: string = WIDGET_SQL): PlanStep {
  return {
    id: "sql-1",
    title: "Query widgets",
    instruction: "Query widgets",
    requiresApproval: false,
    status: "verified",
    action: { tool: "run_sql", args: { sql }, target: "demo.widgets_table" },
    output: { sql, rows, rowCount, requestId: "req-f3-1" },
  };
}

function analysisStep(analysis: string, provenance: string | undefined = "live-model"): PlanStep {
  return {
    id: "analysis-1",
    title: "Summarize",
    instruction: "Summarize",
    requiresApproval: false,
    status: "running",
    analysis: true,
    expectGrounding: "tool-rows",
    output: { analysis, provenance },
  };
}

const WIDGET_ROWS: unknown[][] = [
  ["alpha", "true"],
  ["beta", "false"],
];

describe("F3 deterministic grounding helpers", () => {
  it("collects rows with boundaries and parses columns", () => {
    const got = collectToolRows([sqlStep(WIDGET_ROWS, 2)]);
    expect(got.rows).toHaveLength(2);
    expect(got.rowCount).toBe(2);
    expect(got.columns).toEqual(["widget_name", "is_primary"]);
  });

  it("emits deterministic aggregates without model judgment", () => {
    const lines = deterministicAggregateLines(collectToolRows([sqlStep(WIDGET_ROWS, 2)]));
    expect(lines[0]).toContain("2 row(s)");
    expect(lines.join("\n")).toContain("is_primary");
  });

  it("extracts explicit count claims and ignores decimals", () => {
    const claims = extractCountClaims("1 primary, 1 not primary. Ratio 1.8 stays ignored.");
    const values = claims.map((c) => c.value);
    expect(values).toContain(1);
    expect(values).not.toContain(8);
  });

  it("accepts counts matching the row count or a partition frequency", () => {
    expect(verifyCountClaims("2 rows: 1 primary, 1 not primary.", WIDGET_ROWS).ok).toBe(true);
  });

  it("rejects invented counts", () => {
    const check = verifyCountClaims("5 primary widgets found.", WIDGET_ROWS);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("5");
  });
});

describe("F3 evidence-grounded analysis verification", () => {
  it("passes faithful summarization citing observed values with correct counts", async () => {
    const result = await verifySteps([
      sqlStep(WIDGET_ROWS, 2),
      analysisStep("Observed 2 rows: alpha is primary, beta is not primary. So 1 primary, 1 not primary (inference: stock is split)."),
    ]);
    expect(result.passed).toBe(true);
  });

  it("passes exact-value extraction", async () => {
    const result = await verifySteps([
      sqlStep(WIDGET_ROWS, 2),
      analysisStep("The primary widget is alpha (observed is_primary=true)."),
    ]);
    expect(result.passed).toBe(true);
  });

  it("rejects miscounted partitions (X20 shape, generic fixture)", async () => {
    const result = await verifySteps([
      sqlStep(WIDGET_ROWS, 2),
      analysisStep("Observed alpha and beta. There are 5 primary and 0 not primary."),
    ]);
    expect(result.passed).toBe(false);
  });

  it("rejects analysis with no observed row values", async () => {
    const result = await verifySteps([
      sqlStep(WIDGET_ROWS, 2),
      analysisStep("There are some widgets with various properties."),
    ]);
    expect(result.passed).toBe(false);
  });

  it("accepts an honest empty report and rejects invented values", async () => {
    // The domain tool check rejects empty results for the approved demo query
    // (honest systems failure), so overall verification stays failed — but the
    // analysis check specifically must accept an honest empty report and must
    // not demand invented values.
    const pikachuSql =
      "SELECT ability_name, is_hidden FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu' ORDER BY ability_name LIMIT 100";
    const honest = await verifySteps([
      sqlStep([], 0, pikachuSql),
      analysisStep("No rows were returned; no primary widget observed.", "live-model"),
    ]);
    const analysisCheck = await checkAnalysis(
      analysisStep("No rows were returned; no primary widget observed.", "live-model"),
      [sqlStep([], 0)],
    );
    expect(analysisCheck.passed).toBe(true);
    expect(honest.passed).toBe(false);

    const invented = await checkAnalysis(
      analysisStep("Found alpha as primary.", "live-model"),
      [sqlStep([], 0)],
    );
    expect(invented.passed).toBe(false);
  });

  it("counts duplicate rows as observed (no silent dedup)", async () => {
    const dupes: unknown[][] = [
      ["alpha", "true"],
      ["alpha", "true"],
    ];
    const ok = await checkAnalysis(
      analysisStep("Observed 2 rows, both alpha primary: 2 primary.", "live-model"),
      [sqlStep(dupes, 2)],
    );
    expect(ok.passed).toBe(true);
    const bad = await checkAnalysis(
      analysisStep("Observed alpha primary: 1 primary.", "live-model"),
      [sqlStep(dupes, 2)],
    );
    expect(bad.passed).toBe(false);
  });

  it("rejects conflicting-count claims over conflicting records", async () => {
    const conflict: unknown[][] = [
      ["alpha", "true"],
      ["alpha", "false"],
    ];
    const result = await checkAnalysis(
      analysisStep("Observed alpha listed both true and false; reporting 5 primary is wrong.", "live-model"),
      [sqlStep(conflict, 2)],
    );
    expect(result.passed).toBe(false);
  });

  it("keeps provenance linkage: heuristic fallback never verifies", async () => {
    const result = await checkAnalysis(
      analysisStep("Observed alpha and beta: 2 rows.", "heuristic-demo"),
      [sqlStep(WIDGET_ROWS, 2)],
    );
    expect(result.passed).toBe(false);
    expect(result.explanation).toContain("heuristic");
  });

  it("rejects plan-envelope analysis instead of the artifact", async () => {
    const result = await checkAnalysis(
      analysisStep('{"analysis": "alpha is primary"}', "live-model"),
      [sqlStep(WIDGET_ROWS, 2)],
    );
    expect(result.passed).toBe(false);
  });
});

describe("F3 calculator safeguard (narrow, deterministic)", () => {
  function calcStep(expression: string, result: unknown): PlanStep {
    return {
      id: "calc-1",
      title: "Evaluate",
      instruction: "Evaluate",
      requiresApproval: false,
      status: "verified",
      action: { tool: "calc.evaluate", args: { expression } },
      output: { expression, result, kind: typeof result === "number" ? "number" : typeof result },
    };
  }

  it("accepts a correct calculation", async () => {
    const check = await checkCalc(calcStep("21 * 2 + 8", 50));
    expect(check.passed).toBe(true);
  });

  it("rejects an incorrect result that disagrees with the expression", async () => {
    const check = await checkCalc(calcStep("21 * 2 + 8", 999));
    expect(check.passed).toBe(false);
    expect(check.explanation).toContain("does not match");
  });

  it("rejects boolean and string mismatches", async () => {
    expect((await checkCalc(calcStep("true AND false", true))).passed).toBe(false);
    expect((await checkCalc(calcStep("true AND false", false))).passed).toBe(true);
    expect((await checkCalc(calcStep("reverse('abc')", "cba"))).passed).toBe(true);
    expect((await checkCalc(calcStep("reverse('abc')", "xyz"))).passed).toBe(false);
  });

  it("keeps legacy acceptance without an expression but rejects invalid ones", async () => {
    // No planned expression (synthetic/legacy step): finite results still verify.
    const missing: PlanStep = {
      id: "calc-x",
      title: "Evaluate",
      instruction: "Evaluate",
      requiresApproval: false,
      status: "verified",
      action: { tool: "calc.evaluate", args: {} },
      output: { result: 1 },
    };
    expect((await checkCalc(missing)).passed).toBe(true);
    // A present-but-invalid expression that somehow produced output is
    // inconsistent and must not verify.
    expect((await checkCalc(calcStep("gibberish ???", 1))).passed).toBe(false);
  });
});

describe("F3 summarize() evidence continuity", () => {
  it("includes deterministic counts alongside listed rows", () => {
    const text = summarize([sqlStep(WIDGET_ROWS, 2)], "ok");
    expect(text).toContain("Rows returned: 2");
    expect(text).toContain("Deterministic count: 2 row(s) observed.");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("names the executed read-only tool in prose listings", () => {
    const step: PlanStep = {
      id: "fs-1",
      title: "List workspace files",
      instruction: "List",
      requiresApproval: false,
      status: "verified",
      action: { tool: "fs.list", args: { path: "." } },
      output: [{ name: "README.md", type: "file" }],
    };
    expect(summarize([step], "ok")).toContain("fs.list");
  });
});
