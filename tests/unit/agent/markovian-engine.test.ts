import { describe, expect, it } from "vitest";
import {
  Markovian,
  modelTotals,
  resolveChunkConfig,
  runEfficiency,
  runMarkovian,
} from "@/core/agent/markovian-engine";

describe("VOW Markovian engine", () => {
  it("strips provider think text from recorded chunks", async () => {
    const run = await runMarkovian({
      goal: "Sanitize provider output.",
      reflect: false,
      generator: async () => ({
        text: '<think>private scratch text</think>{"summary":"usable plan"} [TASK_COMPLETE]',
      }),
    });

    expect(run.status).toBe("completed");
    expect(run.output).toBe('{"summary":"usable plan"}');
    expect(run.chunks[0]?.content).not.toContain("private scratch text");
  });

  it("validates configuration and rejects unsupported overlap", () => {
    expect(() => resolveChunkConfig({ maxChunks: 99 })).toThrow();
    expect(() =>
      resolveChunkConfig({ chunkSize: 2000, carryoverTokens: 640 }),
    ).toThrow();
    expect(() => resolveChunkConfig({ overlapTokens: 12 })).toThrow(/overlapTokens/);
  });

  it("carries bounded state across chunks and strips markers", async () => {
    const prompts: string[] = [];
    const responses = [
      {
        text:
          "First chunk findings. [STATE_CHECKPOINT]\n" +
          "COMPLETED: first section is complete\n" +
          "REMAINING: second section is pending\n" +
          "DECISIONS: keep the first finding\n" +
          "CONTEXT: continue the requested analysis",
      },
      {
        text:
          "Second chunk findings. [STATE_CHECKPOINT]\n" +
          "COMPLETED: first and second sections are complete\n" +
          "REMAINING: final synthesis is pending\n" +
          "DECISIONS: preserve both findings\n" +
          "CONTEXT: synthesize the final response",
      },
      { text: "Final synthesis contains both findings. [TASK_COMPLETE]" },
    ];

    const run = await runMarkovian({
      goal: "Perform a multi-step research analysis.",
      memoryContext: "FIRST_STEP_ONLY_CONTEXT",
      reflect: false,
      generator: async (prompt, systemPrompt) => {
        if (systemPrompt.includes("carryover compressor")) {
          return {
            text: "COMPLETED: compressed\nREMAINING: more work\nDECISIONS: keep findings\nCONTEXT: continue",
          };
        }
        prompts.push(prompt);
        const next = responses.shift();
        if (!next) throw new Error("Unexpected extra generation");
        return { text: next.text };
      },
    });

    expect(run.status).toBe("completed");
    expect(run.chunks).toHaveLength(3);
    expect(run.chunks[1].carryover).toContain("COMPLETED: first section is complete");
    expect(prompts[0]).toContain("FIRST_STEP_ONLY_CONTEXT");
    expect(prompts[1]).not.toContain("FIRST_STEP_ONLY_CONTEXT");
    expect(prompts[1]).toContain("[CARRYOVER STATE]");
    expect(run.output).not.toMatch(/STATE_CHECKPOINT|TASK_COMPLETE/);
    expect(run.finalCarryover).toContain("Final synthesis contains both findings.");
  });

  it("reports max-chunks instead of claiming completion", async () => {
    const run = await runMarkovian({
      goal: "Continue bounded work until complete.",
      config: { maxChunks: 2 },
      reflect: false,
      generator: async () => ({ text: "Work continues, more remains." }),
    });

    expect(run.status).toBe("max-chunks");
    expect(run.chunks).toHaveLength(2);
  });

  it("preserves partial chunks when generation fails", async () => {
    let calls = 0;
    const run = await runMarkovian({
      goal: "Handle a provider failure.",
      reflect: false,
      generator: async () => {
        calls++;
        if (calls === 2) throw new Error("simulated provider outage");
        return {
          text:
            "Partial output. [STATE_CHECKPOINT]\n" +
            "COMPLETED: a first section is preserved\n" +
            "REMAINING: more work remains\n" +
            "DECISIONS: keep the partial result\n" +
            "CONTEXT: retry later",
        };
      },
    });

    expect(run.status).toBe("errored");
    expect(run.chunks).toHaveLength(1);
    expect(run.error).toContain("simulated provider outage");
  });

  it("records chunk usage and provider-reported token usage", async () => {
    const run = await runMarkovian({
      goal: "Measure bounded work.",
      reflect: false,
      generator: async () => ({
        text: "Completed in one chunk. [TASK_COMPLETE]",
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    });

    expect(run.status).toBe("completed");
    expect(run.totalTokensUsed).toBeGreaterThan(0);
    expect(run.providerReportedTokens).toBe(120);
    expect(run.providerUsageComplete).toBe(true);
    expect(run.tokenLabel).toBe("estimated");
  });

  it("uses the LLM compressor when the checkpoint is too short", async () => {
    const systemPrompts: string[] = [];
    const run = await runMarkovian({
      goal: "Compress a short checkpoint.",
      config: { maxChunks: 2 },
      reflect: false,
      generator: async (prompt, systemPrompt) => {
        systemPrompts.push(systemPrompt);
        if (systemPrompt.includes("carryover compressor")) {
          return {
            text: "COMPLETED: first stage is done\nREMAINING: write the conclusion\nDECISIONS: keep the short finding\nCONTEXT: second chunk should see this block",
          };
        }
        if (prompt.includes("[CARRYOVER STATE]")) {
          expect(prompt).toContain("COMPLETED: first stage is done");
          return { text: "Conclusion after compressed carryover. [TASK_COMPLETE]" };
        }
        return { text: "Tiny. [STATE_CHECKPOINT]\nshort" };
      },
    });

    expect(run.status).toBe("completed");
    expect(run.chunks).toHaveLength(2);
    expect(run.chunks[1]?.carryover).toContain("COMPLETED: first stage is done");
    expect(systemPrompts.some((prompt) => prompt.includes("carryover compressor"))).toBe(true);
  });

  it("conforms to the efficiency model formula for N=20 (~86.18%)", () => {
    const { naiveTotal, markovianTotal, efficiency } = modelTotals(20);
    expect(naiveTotal).toBe(246_000);
    expect(markovianTotal).toBe(34_000);
    expect(Math.abs(efficiency * 100 - 86.18)).toBeLessThan(0.5);
  });

  it("calculates historical runEfficiency against snapshot config", () => {
    const chunks = [1, 2, 3, 4].map((id) => ({
      id,
      tokens: 1000,
      carryover: "",
      content: "",
    }));
    const a = runEfficiency(chunks, {
      chunkSize: 8000,
      maxChunks: 24,
      carryoverTokens: 512,
      overlapTokens: 0,
    });
    const b = runEfficiency(chunks, {
      chunkSize: 8000,
      maxChunks: 24,
      carryoverTokens: 2048,
      overlapTokens: 0,
    });
    expect(a.standardCost).toBe(10_000);
    expect(a.markovianCost).toBe(6_048);
    expect(a.tokensSaved).not.toBe(b.tokensSaved);
  });

  it("runs the Markovian class with per-run chunkConfig snapshot", async () => {
    const m = new Markovian({
      chunkConfig: { chunkSize: 4000, carryoverTokens: 640 },
    });
    let calls = 0;
    const run = await m.run({
      goal: "Markovian class snapshot test",
      reflect: false,
      generator: async () => {
        calls++;
        const done = calls >= 2;
        return {
          text:
            `Step ${calls} output text. ` +
            (done
              ? "[TASK_COMPLETE]"
              : "[STATE_CHECKPOINT]\nCOMPLETED: step 1\nREMAINING: step 2\nDECISIONS: none\nCONTEXT: test"),
        };
      },
    });

    expect(run.status).toBe("completed");
    expect(run.chunkConfig.carryoverTokens).toBe(640);
    expect(run.chunks).toHaveLength(2);
    expect(run.output).not.toMatch(/STATE_CHECKPOINT|TASK_COMPLETE/);
  });
});
