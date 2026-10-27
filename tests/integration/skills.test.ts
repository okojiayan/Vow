import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTask, runTask } from "@/core/agent/orchestrator";
import { getTrace } from "@/core/traces/trace-store";
import { getLedger } from "@/core/reasoning/ledger";
import { executeTool } from "@/core/execution/executor";
import { getTool, registerTool } from "@/core/execution/tool-registry";
import { registerToolPermission } from "@/core/warden/policy";
import {
  findSkills, getSkill, invokeSkill, listSkills,
  registerSeedSkills, registerSkill, resetSkills,
} from "@/core/skills";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../helpers";

async function setup() {
  await isolatedEnv();
  await updateSettings({ mode: "autonomous" });
  resetSkills();
  registerSeedSkills();
  for (const name of ["plugin.test.slow", "plugin.test.secret"] as const) {
    try {
      registerToolPermission({ tool: name, risk: "read", defaultEffect: "require_approval" } as never);
    } catch { /* idempotent */ }
  }
  if (!getTool("plugin.test.slow")) {
    registerTool({
      name: "plugin.test.slow", description: "Test-only slow tool.", risk: "read",
      handler: async () => {
        await new Promise((r) => setTimeout(r, 2500));
        return { done: true };
      },
    });
  }
  if (!getTool("plugin.test.secret")) {
    registerTool({
      name: "plugin.test.secret", description: "Test-only secret-bearing tool.", risk: "read",
      handler: async () => ({ api_key: "live-secret-value", note: "ok" }),
    });
  }
}

afterEach(async () => {
  delete process.env.VOW_DATA_DIR;
  delete process.env.VOW_WORKSPACE_DIR;
});

describe("skills system (real gateway)", () => {
  it("rejects malformed manifests and id collisions", async () => {
    await setup();
    expect(() => registerSkill({ id: "Bad Id!" })).toThrow(/Invalid skill manifest/);
    expect(() => registerSkill({
      id: "ok-skill", name: "ok", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({}), outputSchema: z.object({}),
      allowedTools: ["calc.evaluate"],
      procedure: [{ tool: "fs.list", args: {} }],
      requiredTools: ["calc.evaluate"],
    })).toThrow(/outside its allowedTools/);
    registerSkill({
      id: "dup-skill", name: "dup", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({}), outputSchema: z.object({}),
      allowedTools: ["calc.evaluate"], procedure: [{ tool: "calc.evaluate", args: {} }],
      requiredTools: ["calc.evaluate"],
    });
    expect(() => registerSkill({
      id: "dup-skill", name: "different", version: "2.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({}), outputSchema: z.object({}),
      allowedTools: ["calc.evaluate"], procedure: [{ tool: "calc.evaluate", args: {} }],
      requiredTools: ["calc.evaluate"],
    })).toThrow(/collision/);
  });

  it("discovers seed skills by trigger phrase and never invents", async () => {
    await setup();
    expect(listSkills().map((s) => s.id)).toContain("verified-calc");
    const found = findSkills("please use skill:verified-calc for this");
    expect(found[0]?.skill.id).toBe("verified-calc");
    expect(found[0]?.reason).toMatch(/Trigger/);
    expect(findSkills("bake a chocolate cake with extra frosting")).toHaveLength(0);
    expect(getSkill("nope")).toBeUndefined();
  });

  it("runs verified-calc through the real gateway with schema-validated output", async () => {
    await setup();
    const { task: parent } = await createTask("calc parent");
    const res = await executeTool({
      taskId: parent.id, tool: "skill.invoke",
      args: { skill: "verified-calc", input: { expression: "21 * 2 + 8" } },
      mode: "autonomous",
    });
    expect(res.status).toBe("ok");
    const out = res.output as { ok: boolean; output: { result: number } };
    expect(out.ok).toBe(true);
    expect(out.output.result).toBe(50);
    const trace = await getTrace(parent.id);
    expect(trace.events.some((e) => e.title.startsWith("Skill started (verified-calc"))).toBe(true);
    expect(getLedger(parent.id).some((e) => e.title.startsWith("Skill verified"))).toBe(true);
  });

  it("runs workspace-report against the real workspace", async () => {
    await setup();
    const { task: parent } = await createTask("report parent");
    const res = await executeTool({
      taskId: parent.id, tool: "skill.invoke",
      args: { skill: "workspace-report", input: {} },
      mode: "autonomous",
    });
    expect(res.status).toBe("ok");
    const out = res.output as { ok: boolean; output: Array<{ name: string }> };
    expect(out.ok).toBe(true);
    expect(out.output.some((e) => e.name === "notes")).toBe(true);
  });

  it("fails safely on invalid input, unknown skills, and missing tools", async () => {
    await setup();
    const { task: parent } = await createTask("fail parent");
    const ctx = { taskId: parent.id, mode: "autonomous" as const};
    const badInput = await invokeSkill("verified-calc", {}, ctx);
    expect(badInput.ok).toBe(false);
    expect(badInput.error).toMatch(/Invalid skill input/);
    const unknown = await invokeSkill("nope", {}, ctx);
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/Unknown skill/);
    registerSkill({
      id: "missing-tool-skill", name: "m", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({}), outputSchema: z.object({}),
      allowedTools: ["ghost.tool"], procedure: [{ tool: "ghost.tool", args: {} }],
      requiredTools: ["ghost.tool"],
    });
    const missing = await invokeSkill("missing-tool-skill", {}, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/not registered/);
  });

  it("rejects output that fails schema validation", async () => {
    await setup();
    const { task: parent } = await createTask("schema parent");
    registerSkill({
      id: "bad-output-skill", name: "b", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({ expression: z.string() }),
      outputSchema: z.object({ nonsense: z.string() }),
      allowedTools: ["calc.evaluate"],
      procedure: [{ tool: "calc.evaluate", args: { expression: "{{input.expression}}" } }],
      requiredTools: ["calc.evaluate"],
    });
    const res = await invokeSkill("bad-output-skill", { expression: "1 + 1" }, { taskId: parent.id, mode: "autonomous" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/schema validation/);
  });

  it("enforces Warden approval for skill.invoke in supervised mode", async () => {
    await setup();
    await updateSettings({ mode: "supervised" });
    const { task: parent } = await createTask("supervised parent");
    const res = await executeTool({
      taskId: parent.id, tool: "skill.invoke",
      args: { skill: "verified-calc", input: { expression: "1 + 1" } },
      mode: "supervised",
    });
    expect(res.status).toBe("needs_approval");
  });

  it("bounds skill execution time", async () => {
    await setup();
    const { task: parent } = await createTask("timeout parent");
    registerSkill({
      id: "slow-skill", name: "s", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({}),
      outputSchema: z.object({ done: z.boolean() }),
      allowedTools: ["plugin.test.slow"],
      procedure: [{ tool: "plugin.test.slow", args: {} }],
      requiredTools: ["plugin.test.slow"],
      timeoutMs: 1000,
    });
    const t0 = Date.now();
    const res = await invokeSkill("slow-skill", {}, { taskId: parent.id, mode: "autonomous" });
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/budget|exceeded/i);
  });

  it("redacts secrets from skill outputs and traces", async () => {
    await setup();
    const { task: parent } = await createTask("secret parent");
    registerSkill({
      id: "secret-skill", name: "s", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({}),
      outputSchema: z.object({ api_key: z.string(), note: z.string() }),
      allowedTools: ["plugin.test.secret"],
      procedure: [{ tool: "plugin.test.secret", args: {} }],
      requiredTools: ["plugin.test.secret"],
    });
    const res = await invokeSkill("secret-skill", {}, { taskId: parent.id, mode: "autonomous" });
    expect(res.ok).toBe(true);
    expect((res.output as { api_key: string }).api_key).toBe("<redacted>");
    const trace = await getTrace(parent.id);
    const blob = JSON.stringify(trace.events);
    expect(blob).not.toMatch(/live-secret-value/);
  });

  it("composes skill over subagent within shared limits", async () => {
    await setup();
    const { task: parent } = await createTask("composition parent");
    registerSkill({
      id: "delegate-calc-skill", name: "d", version: "1.0.0", description: "delegates calc",
      triggers: ["t"], inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.literal("completed"),
        deliverable: z.string(),
        childTaskId: z.string(),
        evidence: z.array(z.unknown()),
      }),
      allowedTools: ["subagent.spawn"],
      procedure: [{
        tool: "subagent.spawn",
        args: { role: "calculator", objective: "Compute 9 - 4.", allowedTools: ["calc.evaluate"] },
      }],
      requiredTools: ["subagent.spawn"],
    });
    const res = await invokeSkill("delegate-calc-skill", {}, { taskId: parent.id, mode: "autonomous" });
    expect(res.ok).toBe(true);
    expect((res.output as { deliverable: string }).deliverable).toMatch(/5/);
  });

  it("executes plugin-backed tools through skills under one security model", async () => {
    await setup();
    const { task: parent } = await createTask("skill-plugin parent");
    registerSkill({
      id: "stats-skill", name: "s", version: "1.0.0", description: "d",
      triggers: ["t"], inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ words: z.number() }),
      allowedTools: ["plugin.text-stats.analyze"],
      procedure: [{ tool: "plugin.text-stats.analyze", args: { text: "{{input.text}}" } }],
      requiredTools: ["plugin.text-stats.analyze"],
    });
    const res = await invokeSkill("stats-skill", { text: "one two three four" }, { taskId: parent.id, mode: "autonomous" });
    expect(res.ok).toBe(true);
    expect((res.output as { words: number }).words).toBe(4);
    expect(res.steps).toHaveLength(1);
    // Composed path stays permissioned: supervised mode gates the gateway call.
    await updateSettings({ mode: "supervised" });
    const gated = await executeTool({
      taskId: parent.id, tool: "plugin.text-stats.analyze", args: { text: "x" }, mode: "supervised",
    });
    expect(gated.status).toBe("needs_approval");
  });

  it("completes a skill step through the full task lifecycle", async () => {
    await setup();
    const { task: parent } = await createTask("lifecycle skill parent");
    const planned = await runTaskInit(parent.id);
    expect(planned.status).toBe("completed");
    expect(String(planned.resultSummary)).toMatch(/50/);
  });
});

async function runTaskInit(parentId: string) {
  const { getTask: get, saveTask: save } = await import("@/core/agent/task-store");
  const task = await get(parentId);
  if (!task) throw new Error("missing parent");
  await save({
    ...task,
    status: "executing",
    plan: {
      summary: "skill plan",
      inferenceMode: "heuristic-demo",
      steps: [{
        id: "s1", title: "Calculate via skill", instruction: "use skill",
        action: { tool: "skill.invoke", args: { skill: "verified-calc", input: { expression: "10 * 5" } } },
        requiresApproval: false, status: "pending",
      }],
    },
  });
  return runTask(parentId);
}
