import { describe, expect, it } from "vitest";
import { classifyIntent, heuristicPlan, parseModelPlan, sanitizeModelPlan } from "@/core/agent/planner";
import type { AgentPlan } from "@/core/agent/types";

const FALLBACK: AgentPlan = {
  summary: "fallback",
  steps: [],
  inferenceMode: "heuristic-demo",
};

describe("planner informational routing (Loop 3 sprint)", () => {
  it("routes extraction and constrained-format requests to direct analysis", () => {
    for (const q of [
      "Extract the email addresses from: contact bob@example.com",
      "Summarize: The quick brown fox jumps.",
      "Translate hello to French.",
      "Reply with only the word BLUE.",
      "Sort these numbers: 5, 2, 9, 1.",
      "Reverse the string hello.",
    ]) {
      expect(classifyIntent(q), `intent for: ${q}`).toBe("direct-answer");
      const plan = heuristicPlan(q);
      expect(
        plan.steps.some((s) => s.action),
        `no tool steps for: ${q}`,
      ).toBe(false);
      expect(
        plan.steps.some((s) => s.analysis === true),
        `analysis step for: ${q}`,
      ).toBe(true);
    }
  });

  it("keeps file-mutating variants on the tool path", () => {
    const q = "Translate the notes and save it to file";
    expect(classifyIntent(q)).toBe("tool-action");
    expect(heuristicPlan(q).steps.some((s) => s.action)).toBe(true);
  });
});

describe("parseModelPlan output-contract tolerance (Loop 3 sprint)", () => {
  const valid = JSON.stringify({
    summary: "s",
    steps: [{ title: "t", instruction: "i", tool: null, args: {}, target: null }],
  });

  it("parses clean JSON", () => {
    expect(parseModelPlan(valid, FALLBACK).inferenceMode).toBe("live-model");
  });

  it("strips fenced JSON envelopes", () => {
    const fenced = "```json\n" + valid + "\n```";
    const parsed = parseModelPlan(fenced, FALLBACK);
    expect(parsed.inferenceMode).toBe("live-model");
    expect(parsed.steps).toHaveLength(1);
  });

  it("extracts JSON wrapped in prose", () => {
    const wrapped = "Here is your plan:\n" + valid + "\nLet me know if you need changes.";
    expect(parseModelPlan(wrapped, FALLBACK).inferenceMode).toBe("live-model");
  });

  it("falls back on garbage or empty steps", () => {
    expect(parseModelPlan("no json here", FALLBACK)).toBe(FALLBACK);
    expect(parseModelPlan(JSON.stringify({ summary: "s", steps: [] }), FALLBACK)).toBe(FALLBACK);
    expect(parseModelPlan("```\nnot json\n```", FALLBACK)).toBe(FALLBACK);
  });

  it("parsed tool steps still pass through downstream guards", () => {
    const withSql = JSON.stringify({
      summary: "s",
      steps: [{ title: "t", instruction: "smoke ping", tool: "run_sql", args: { query: "SELECT 1" }, target: "db" }],
    });
    const parsed = parseModelPlan(withSql, FALLBACK);
    // Parsing succeeds; authorization is enforced later by sanitizeModelPlan
    // allowlist (run_sql is allowed) + dropUnauthorizedSqlSteps + Warden.
    expect(parsed.inferenceMode).toBe("live-model");
  });
});

describe("structured-output edge cases (Phase 2C, offline)", () => {
  const FALLBACK2: AgentPlan = { summary: "fallback", steps: [], inferenceMode: "heuristic-demo" };
  const valid = JSON.stringify({
    summary: "s",
    steps: [{ title: "t", instruction: "i", tool: null, args: {}, target: null }],
  });

  it("rejects structurally invalid JSON", () => {
    expect(parseModelPlan("{not json", FALLBACK2)).toBe(FALLBACK2);
    expect(parseModelPlan("", FALLBACK2)).toBe(FALLBACK2);
  });

  it("rejects truncated envelopes missing the closing brace", () => {
    const truncated = valid.slice(0, Math.floor(valid.length / 2));
    expect(parseModelPlan(truncated, FALLBACK2)).toBe(FALLBACK2);
  });

  it("rejects envelopes with missing required plan fields", () => {
    expect(parseModelPlan(JSON.stringify({ summary: "no steps" }), FALLBACK2)).toBe(FALLBACK2);
    expect(parseModelPlan(JSON.stringify({ steps: "not-an-array" }), FALLBACK2)).toBe(FALLBACK2);
  });

  it("accepts steps with missing optional fields via safe defaults, preserving analyzability", () => {
    const sparse = JSON.stringify({ summary: "s", steps: [{}, { title: "only-title" }] });
    const parsed = parseModelPlan(sparse, FALLBACK2);
    expect(parsed.inferenceMode).toBe("live-model");
    expect(parsed.steps).toHaveLength(2);
    // No tool action was invented for field-less steps: analysis-only.
    expect(parsed.steps.every((s) => !s.action)).toBe(true);
  });

  it("unauthorized tools are dropped by the sanitize chain, never executed", () => {
    const hostile = JSON.stringify({
      summary: "s",
      steps: [
        { title: "bad", instruction: "run shell", tool: "shell.exec", args: { command: "rm -rf /" } },
        { title: "bad2", instruction: "fetch", tool: "http.fetch", args: { url: "http://x" } },
        { title: "ok", instruction: "list", tool: "fs.list", args: { path: "." } },
      ],
    });
    const parsed = parseModelPlan(hostile, FALLBACK2);
    expect(parsed.steps).toHaveLength(3);
    const { plan: clean, dropped } = sanitizeModelPlan(parsed);
    expect(clean.steps.map((s) => s.action?.tool)).toEqual(["fs.list"]);
    expect(dropped).toEqual(expect.arrayContaining(["shell.exec", "http.fetch"]));
  });

  it("malformed tool args are dropped, not coerced", () => {
    const badArgs = JSON.stringify({
      summary: "s",
      steps: [{ title: "t", instruction: "i", tool: "fs.list", args: "should-be-object" }],
    });
    const { plan: clean, dropped } = sanitizeModelPlan(parseModelPlan(badArgs, FALLBACK2));
    expect(clean.steps.filter((s) => s.action)).toHaveLength(0);
    expect(dropped).toEqual(["fs.list:bad-args"]);
  });
});
