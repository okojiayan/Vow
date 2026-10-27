import { describe, expect, it } from "vitest";
import {
  dropUnauthorizedSqlSteps,
  heuristicPlan,
  isSupportedZetarisDemoRequest,
  sanitizeModelPlan,
} from "@/core/agent/planner";
import { validateReadOnlyZetarisSql } from "@/integrations/zetaris/sql-policy";

describe("smoke-test SQL routing guard", () => {
  it("does not treat a UI accessibility check as a Zetaris request", () => {
    expect(isSupportedZetarisDemoRequest("UI smoke test ping")).toBe(false);
    expect(isSupportedZetarisDemoRequest("Verify UI endpoint accessibility")).toBe(false);
    expect(isSupportedZetarisDemoRequest("Check that / and /tasks load")).toBe(false);
  });

  it("heuristic plan for a smoke check never requires SQL", () => {
    for (const req of [
      "UI smoke test ping",
      "Verify UI endpoint accessibility",
      "Check that / and /tasks load",
    ]) {
      const plan = heuristicPlan(req);
      expect(plan.steps.some((s) => s.action?.tool === "run_sql")).toBe(false);
    }
  });

  it("drops the recorded model-authored run_sql misuse (args.query, not args.sql)", () => {
    const recorded = {
      summary: "UI smoke test ping - basic health check",
      steps: [
        {
          id: "step-1",
          title: "Verify UI endpoint accessibility",
          instruction: "Check if the UI application URL responds with HTTP 200",
          action: { tool: "run_sql", args: { query: "SELECT 1 as health_check" }, target: "database" },
          requiresApproval: false,
          status: "pending",
        },
        {
          id: "step-2",
          title: "Report smoke test result",
          instruction: "Report the result",
          action: { tool: "notes.create", args: { title: "UI Smoke Test Result", body: "done" }, target: "workspace" },
          requiresApproval: false,
          status: "pending",
        },
      ],
      inferenceMode: "live-model" as const,
    };
    const { plan: clean } = sanitizeModelPlan(recorded as never);
    // Allowlisted tool, so sanitize keeps it; the SQL guard must drop it.
    expect(clean.steps.some((s) => s.action?.tool === "run_sql")).toBe(true);
    const guarded = dropUnauthorizedSqlSteps(clean, "UI smoke test ping");
    expect(guarded.droppedSql).toBe(1);
    expect(guarded.plan.steps.some((s) => s.action?.tool === "run_sql")).toBe(false);
  });

  it("keeps run_sql for genuine Zetaris-table requests", () => {
    const plan = heuristicPlan("What abilities does Pikachu have?");
    const guarded = dropUnauthorizedSqlSteps(plan, "What abilities does Pikachu have?");
    expect(guarded.droppedSql).toBe(0);
    expect(guarded.plan.steps.some((s) => s.action?.tool === "run_sql")).toBe(true);
  });

  it("empty SQL still fails safely at the validation boundary", () => {
    expect(validateReadOnlyZetarisSql(undefined)).toEqual({
      ok: false,
      reason: "SQL must be a non-empty string.",
    });
    expect(validateReadOnlyZetarisSql("")).toEqual({
      ok: false,
      reason: "SQL must be a non-empty string.",
    });
  });
});
