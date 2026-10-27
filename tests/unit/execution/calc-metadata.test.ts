import { describe, it, expect } from "vitest";
import { translateRequestToExpression, translateRequestToCalcExpressions } from "@/core/execution/calc";
import { deterministicCalcPlan } from "@/core/agent/planner";

describe("metadata-safe translation (v2.1.2)", () => {
  it("numeric bracket metadata is not arithmetic", () => {
    expect(translateRequestToExpression("Those 4 times we met last year were lovely. [fresh20261101-0]")).toBeNull();
    expect(translateRequestToExpression("Proceed with the plan. [fresh20261101-0]")).toBeNull();
    expect(translateRequestToExpression("What is courage times silence? [fresh20261101-0]")).toBeNull();
    expect(translateRequestToExpression("Take 1 pills 4 times daily. [fresh20261101-2]")).toBeNull();
    expect(translateRequestToExpression("Do it soon. [fresh20261101-5]")).toBeNull();
  });
  it("hash metadata is not arithmetic", () => {
    expect(translateRequestToExpression("Proceed with the plan. #fresh20261101-0")).toBeNull();
    expect(translateRequestToExpression("Those 4 times we met last year were lovely. #fresh20261101-0")).toBeNull();
    expect(translateRequestToExpression("What is courage times silence? #fresh20261101-0")).toBeNull();
    expect(translateRequestToExpression("maxUnits=5#fresh20261101-0")).toBeNull();
    expect(translateRequestToExpression("envelope#fresh20261101-0")).toBeNull();
  });
  it("bare ambiguous prompts still refuse", () => {
    expect(translateRequestToExpression("Those 4 times we met last year were lovely.")).toBeNull();
    expect(translateRequestToExpression("Proceed with the plan.")).toBeNull();
    expect(translateRequestToExpression("What is courage times silence?")).toBeNull();
  });
  it("preserves valid calculations", () => {
    expect(translateRequestToExpression("Compute 45 plus 38?")).toBe("45+38");
    expect(translateRequestToExpression("What is 72 divided by 12?")).toBe("72/12");
    expect(translateRequestToExpression("What is 6 times 7 times 8?")).toBe("6*7*8");
    expect(translateRequestToExpression("Output only the number equal to 7 * 6 + 8.")).toBe("7 * 6 + 8");
  });
  it("seed and budget fields do not become arithmetic", () => {
    expect(translateRequestToExpression("role=signal officer|name=Elif|seed=20261101")).toBeNull();
    expect(translateRequestToExpression("maxUnits=5#fresh-a")).toBeNull();
    expect(translateRequestToExpression("content=note-fresh-a-token-skprobe")).toBeNull();
  });
  it("deterministic plan has no metadata-only expression", () => {
    expect(deterministicCalcPlan("Proceed with the plan. [fresh20261101-0]")).toBeNull();
    expect(deterministicCalcPlan("Those 4 times we met last year were lovely. [fresh20261101-0]")).toBeNull();
    const ok = deterministicCalcPlan("Compute 45 plus 38?");
    expect(ok?.expression).toBe("45+38");
  });
  it("multi-expression entry also strips metadata", () => {
    expect(translateRequestToCalcExpressions("Proceed with the plan. [fresh20261101-0]")).toBeNull();
    const ok = translateRequestToCalcExpressions("Compute 45 plus 38?");
    expect(ok).toEqual(["45+38"]);
  });
});
