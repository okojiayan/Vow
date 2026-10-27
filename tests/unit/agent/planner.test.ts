import { describe, expect, it } from "vitest";
import { heuristicPlan, isSupportedZetarisDemoRequest } from "@/core/agent/planner";

describe("planner routing", () => {
  it("recognizes the approved Pikachu abilities request", () => {
    expect(isSupportedZetarisDemoRequest("query pikachu abilities")).toBe(true);
    expect(
      isSupportedZetarisDemoRequest("SELECT ability_name FROM pokeapi.pikachu_abilities_table"),
    ).toBe(true);
    expect(isSupportedZetarisDemoRequest("Compute 21 * 2 + 8")).toBe(false);
  });

  it("uses a deterministic restricted SQL plan, not a fabricated result", () => {
    const plan = heuristicPlan("What abilities does Pikachu have?");
    expect(plan.inferenceMode).toBe("deterministic");
    expect(plan.steps[0]?.action?.tool).toBe("run_sql");
    expect(String(plan.steps[0]?.action?.args.sql)).toContain("pokeapi.pikachu_abilities_table");
    expect(JSON.stringify(plan)).not.toMatch(/lightning-rod/);
  });
});
