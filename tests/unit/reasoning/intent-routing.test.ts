import { describe, expect, it } from "vitest";
import { classifyIntent, heuristicPlan, sanitizeModelPlan } from "@/core/agent/planner";
import type { AgentPlan } from "@/core/agent/types";

function toolsFor(request: string): string[] {
  return heuristicPlan(request).steps.map((s) => (s.action ? s.action.tool : `analysis:${s.expectGrounding ?? "?"}`));
}

describe("intent routing (general phrasing, no case IDs)", () => {
  it("routes memory questions to recall, never to unrelated mutations", () => {
    const prompts = [
      "From project memory, what is the weekend deploy window?",
      "What is my favorite color?",
      "Who is my on-call lead?",
      "Do you remember my deadline?",
      "What do you remember about the migration?",
      "Which region is my backup in?",
    ];
    for (const p of prompts) {
      expect(classifyIntent(p)).toBe("memory-recall");
      const tools = toolsFor(p);
      expect(tools).toContain("memory.search");
      expect(tools).not.toContain("fs.list");
      expect(tools).not.toContain("memory.store");
    }
  });

  it("routes explicit store requests to memory.store only", () => {
    expect(classifyIntent("Remember that the deploy window is Saturday.")).toBe("memory-store");
    expect(toolsFor("Remember that the deploy window is Saturday.")).toEqual(["memory.store"]);
  });

  it("answers informational questions directly without tools", () => {
    const prompts = [
      "What is the principle of least privilege? Reply briefly.",
      "Name two red flags of a phishing email.",
      "Write one sentence about rectangles.",
      "Compare cats and dogs in two short lines.",
      "List the IDs of open severity-1 incidents:\n- INC-1 open\n- INC-2 closed",
      "Write one sentence about the ocean.",
      // Advisory how-to: asks for the safe method, not for the action itself.
      "What is the safe read-only way to list files in this workspace?",
      "How do I safely list files in this workspace?",
    ];
    for (const p of prompts) {
      expect(classifyIntent(p)).toBe("direct-answer");
      expect(toolsFor(p)).toEqual(["analysis:none"]);
    }
  });

  it("extracts full calc expressions without sentence punctuation", () => {
    const expr = (q: string) =>
      (heuristicPlan(q).steps[0].action?.args as { expression?: string }).expression;
    expect(expr("Compute 2^10 - 24 (2 to the power 10, minus 24). Reply.")).toBe("2^10 - 24");
    expect(expr("Compute 7 * 8 - 9 * 5. Reply with the result.")).toBe("7 * 8 - 9 * 5");
  });

  it("folds chained arithmetic into one verified calc expression", () => {
    // F2: multi-step chains evaluate the final result, never an intermediate.
    const plan = heuristicPlan("Compute (12 + 8) * 3, then add 17. Reply with the final number.");
    expect(plan.steps.map((x) => x.action?.tool ?? "analysis")).toEqual(["calc.evaluate"]);
    const expr = plan.steps[0].action?.args as { expression?: string };
    expect(expr.expression).toBe("((12 + 8) * 3)+17");
    // Single expressions still use the calculator.
    expect(heuristicPlan("Compute 7 * 8 - 9 * 5. Reply.").steps[0].action?.tool).toBe("calc.evaluate");
  });

  it("every Zetaris plan ends with a grounded summarize step", () => {
    const steps = heuristicPlan("Query pokeapi.pikachu_abilities_table for Pikachu abilities.");
    expect(steps.steps.map((x) => x.action?.tool ?? "analysis")).toEqual(["run_sql", "analysis"]);
    expect(steps.steps[1].expectGrounding).toBe("tool-rows");
  });

  it("does not mistake plural nouns for the ls command", () => {
    expect(toolsFor("Which models cost under $1000? Reply with both names.")).toEqual(["analysis:none"]);
  });

  it("keeps genuine action requests on tool routes", () => {
    expect(toolsFor("Delete the file old-report.txt now.")).toContain("fs.delete");
    expect(toolsFor("Read the file notes/todo.md")).toContain("fs.read");
    expect(toolsFor("Create a note titled gated with body needs approval")).toContain("notes.create");
    expect(toolsFor("Query pokeapi.pikachu_abilities_table for Pikachu abilities.")).toContain("run_sql");
    // Direct listing imperatives still execute fs.list (Phase 2S: advisory
    // how-to questions no longer route here).
    expect(toolsFor("List the files in this workspace.")).toContain("fs.list");
  });

  it("drops model-invented tools and keeps execution on the allowlist", () => {
    const plan: AgentPlan = {
      summary: "model plan",
      inferenceMode: "live-model",
      steps: [
        { id: "s1", title: "ok", instruction: "x", action: { tool: "memory.search", args: { query: "q" } }, requiresApproval: false, status: "pending" },
        { id: "s2", title: "evil", instruction: "x", action: { tool: "shell.exec", args: { command: "x" } }, requiresApproval: false, status: "pending" },
        { id: "s3", title: "bad", instruction: "x", action: { tool: "calc.evaluate", args: "1+1" as unknown as Record<string, unknown> }, requiresApproval: false, status: "pending" },
      ],
    };
    const { plan: clean, dropped } = sanitizeModelPlan(plan);
    expect(clean.steps.map((s) => s.action?.tool)).toEqual(["memory.search"]);
    expect(dropped).toHaveLength(2);
  });
});
