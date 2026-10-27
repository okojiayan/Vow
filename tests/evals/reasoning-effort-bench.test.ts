import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startAndRun } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { EFFORT_LEVELS, type EffortLevel } from "@/core/reasoning/effort";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../helpers";

describe("reasoning effort benchmark (measurements only, no improvement claims)", () => {
  it("measures cost per effort ceiling on a fixed task", async () => {
    const rows: { ceiling: EffortLevel; status: string; outcome: string; wallMs: number; controllerOps: number; toolCalls: number; modelResponses: number }[] = [];
    for (const ceiling of EFFORT_LEVELS) {
      await isolatedEnv();
      await updateSettings({ mode: "autonomous" });
      const start = Date.now();
      const { task } = await startAndRun("Compute 21 * 2 + 8", undefined, { effortCeiling: ceiling });
      const wallMs = Date.now() - start;
      const trace = await getTrace(task.id);
      rows.push({
        ceiling, status: task.status, outcome: task.outcome?.outcome ?? "none", wallMs,
        controllerOps: trace.events.filter((e) => e.title.startsWith("Controller →")).length,
        toolCalls: trace.events.filter((e) => e.kind === "tool_call").length,
        modelResponses: trace.events.filter((e) => e.kind === "model_response").length,
      });
      expect(task.status).toBe("completed");
      expect(task.outcome?.outcome).toBe("completed");
    }
    const dir = path.resolve(process.cwd(), "tests/evals/reports");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "reasoning-effort-bench.json"), JSON.stringify({ task: "Compute 21 * 2 + 8", measuredAt: new Date().toISOString(), rows }, null, 2));
    console.log("effort-bench rows: " + JSON.stringify(rows));
  }, 60000);
});
