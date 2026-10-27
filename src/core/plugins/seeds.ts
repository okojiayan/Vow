import { z } from "zod";
import { registerPlugin } from "./registry";
import { mountPluginTools } from "./adapter";

/** Genuine local plugin: pure text statistics, no network, no secrets. */
export function registerSeedPlugins(): string[] {
  registerPlugin({
    manifest: {
      id: "text-stats",
      name: "Text statistics",
      version: "1.0.0",
      description: "Compute character, word, and line counts plus estimated reading time for a text sample.",
      engine: "1.0.0",
      capabilities: ["text-analysis"],
      tools: [{
        name: "analyze",
        description: "Analyze a text sample and return counts.",
        risk: "read",
        inputSchema: z.object({ text: z.string().min(1).max(20000) }),
        outputSchema: z.object({
          chars: z.number(),
          words: z.number(),
          lines: z.number(),
          readingMinutes: z.number(),
        }),
        timeoutMs: 10000,
      }],
      requiresTools: [],
      secretNames: [],
      limitations: "Local computation only; no external services.",
    },
    handler: {
      execute: async (tool, input) => {
        if (tool !== "analyze") throw new Error(`Unknown plugin tool "${tool}".`);
        const text = (input as { text: string }).text;
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        return {
          chars: text.length,
          words,
          lines: text.split("\n").length,
          readingMinutes: Math.max(1, Math.round((words / 200) * 10) / 10),
        };
      },
      health: async () => ({ healthy: true, detail: "Pure local computation." }),
    },
  });
  return mountPluginTools("text-stats");
}
