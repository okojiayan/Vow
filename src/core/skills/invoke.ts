import { executeTool } from "@/core/execution/executor";
import { getTool } from "@/core/execution/tool-registry";
import { appendTrace } from "@/core/traces/trace-store";
import { appendLedger } from "@/core/reasoning/ledger";
import type { OperatingMode } from "@/core/warden/types";
import { getSkill } from "./registry";

export interface SkillStepResult {
  tool: string;
  ok: boolean;
  summary: string;
  error?: string;
}

export interface SkillResult {
  skillId: string;
  version: string;
  ok: boolean;
  output: unknown;
  steps: SkillStepResult[];
  usage: { toolCalls: number };
  error?: string;
}

const SECRET_KEY = /(api[_-]?key|secret|token|password|auth|credential)/i;

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/Bearer\s+[^\s"']+/g, "Bearer <redacted>");
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "<redacted>" : scrub(entry);
    }
    return out;
  }
  return value;
}

function lookupPath(input: unknown, path: string): unknown {
  let current = input;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function interpolateArgs(args: Record<string, unknown>, input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      out[key] = value.replace(/\{\{\s*input\.([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path: string) => {
        const resolved = lookupPath(input, path);
        if (resolved === undefined) throw new Error(`Skill arg references missing input field "${path}".`);
        if (typeof resolved !== "string" && typeof resolved !== "number" && typeof resolved !== "boolean") {
          throw new Error(`Skill arg input field "${path}" must be a scalar.`);
        }
        return String(resolved);
      });
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Execute a registered skill through the real security gateway. Every
 * procedure step runs via executeTool (Warden authorization, approvals,
 * retries, audit). Results are validated against the skill's output schema
 * and verified against its required tools — a skill never passes on
 * assertion. Model responses and tool outputs are data, never permissions.
 */
export async function invokeSkill(
  skillId: string,
  rawInput: unknown,
  ctx: { taskId: string; mode: OperatingMode },
): Promise<SkillResult> {
  const manifest = getSkill(skillId);
  if (!manifest) {
    return {
      skillId, version: "unknown", ok: false, output: null, steps: [],
      usage: { toolCalls: 0 }, error: `Unknown skill "${skillId}". Registry membership is required.`,
    };
  }
  const inputParsed = manifest.inputSchema.safeParse(rawInput);
  if (!inputParsed.success) {
    return {
      skillId, version: manifest.version, ok: false, output: null, steps: [],
      usage: { toolCalls: 0 },
      error: `Invalid skill input: ${inputParsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  const input = inputParsed.data;
  const missingTools = manifest.allowedTools.filter((t) => !getTool(t));
  if (missingTools.length > 0) {
    return {
      skillId, version: manifest.version, ok: false, output: null, steps: [],
      usage: { toolCalls: 0 }, error: `Skill tools not registered: ${missingTools.join(", ")}.`,
    };
  }

  await appendTrace(ctx.taskId, {
    kind: "planning",
    title: `Skill started (${manifest.id} v${manifest.version})`,
    detail: manifest.description.slice(0, 300),
    data: { skill: manifest.id, version: manifest.version },
  });
  appendLedger(ctx.taskId, { kind: "decision", title: `Skill invoked (${manifest.id})`, detail: manifest.description.slice(0, 200) });

  const deadline = Date.now() + manifest.timeoutMs;
  const steps: SkillStepResult[] = [];
  const okByTool = new Map<string, unknown>();
  let lastOutput: unknown = null;
  for (const step of manifest.procedure) {
    if (Date.now() > deadline) {
      const error = `Skill "${manifest.id}" exceeded its ${manifest.timeoutMs}ms budget.`;
      await appendTrace(ctx.taskId, { kind: "failure", title: `Skill timed out (${manifest.id})`, detail: error });
      return { skillId, version: manifest.version, ok: false, output: null, steps, usage: { toolCalls: steps.length }, error };
    }
    let args: Record<string, unknown>;
    try {
      args = interpolateArgs(step.args, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ tool: step.tool, ok: false, summary: "", error: message });
      return { skillId, version: manifest.version, ok: false, output: null, steps, usage: { toolCalls: steps.length }, error: message };
    }
    // Enforce the remaining budget per step: a single long tool call must
    // not silently overrun the skill deadline. The losing side still
    // finishes in the background, but its result is never consumed.
    const remaining = Math.max(1, deadline - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>(
      (_, reject) => { timer = setTimeout(() => reject(new Error("budget")), remaining); },
    );
    let res: Awaited<ReturnType<typeof executeTool>>;
    try {
      res = await Promise.race([executeTool({ taskId: ctx.taskId, tool: step.tool, args, mode: ctx.mode }), budget]);
    } catch {
      const error = `Skill "${manifest.id}" exceeded its ${manifest.timeoutMs}ms budget during "${step.tool}".`;
      if (timer) clearTimeout(timer);
      steps.push({ tool: step.tool, ok: false, summary: "", error });
      await appendTrace(ctx.taskId, { kind: "failure", title: `Skill timed out (${manifest.id})`, detail: error });
      return { skillId, version: manifest.version, ok: false, output: null, steps, usage: { toolCalls: steps.length }, error };
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === "needs_approval") {
      const error = `Skill step "${step.tool}" requires approval; skill stops without partial claims.`;
      steps.push({ tool: step.tool, ok: false, summary: "", error });
      await appendTrace(ctx.taskId, { kind: "approval", title: `Skill awaiting approval (${manifest.id})`, detail: error });
      return { skillId, version: manifest.version, ok: false, output: null, steps, usage: { toolCalls: steps.length }, error };
    }
    if (res.status !== "ok") {
      const error = res.error ?? `Skill step "${step.tool}" failed.`;
      steps.push({ tool: step.tool, ok: false, summary: "", error });
      await appendTrace(ctx.taskId, { kind: "failure", title: `Skill step failed (${manifest.id})`, detail: error });
      return { skillId, version: manifest.version, ok: false, output: null, steps, usage: { toolCalls: steps.length }, error };
    }
    lastOutput = res.output;
    okByTool.set(step.tool, res.output);
    steps.push({ tool: step.tool, ok: true, summary: JSON.stringify(scrub(res.output)).slice(0, 200) });
    await appendTrace(ctx.taskId, {
      kind: "tool_call",
      title: `Skill step ok: ${step.tool}`,
      detail: `Skill ${manifest.id}: step evidence recorded.`,
      data: { skill: manifest.id },
    });
  }

  const missing = manifest.requiredTools.filter((t) => !okByTool.has(t));
  if (missing.length > 0) {
    const error = `Skill verification failed: required tools did not succeed (${missing.join(", ")}).`;
    return { skillId, version: manifest.version, ok: false, output: lastOutput, steps, usage: { toolCalls: steps.length }, error };
  }
  const outputParsed = manifest.outputSchema.safeParse(lastOutput);
  if (!outputParsed.success) {
    const error = `Skill output failed schema validation: ${outputParsed.error.issues.map((i) => i.message).join("; ")}`;
    await appendTrace(ctx.taskId, { kind: "failure", title: `Skill output invalid (${manifest.id})`, detail: error });
    return { skillId, version: manifest.version, ok: false, output: scrub(lastOutput), steps, usage: { toolCalls: steps.length }, error };
  }
  appendLedger(ctx.taskId, {
    kind: "verification",
    title: `Skill verified (${manifest.id})`,
    detail: `Required tools ok; output schema passed (${steps.length} steps).`,
  });
  return {
    skillId, version: manifest.version, ok: true,
    output: scrub(outputParsed.data), steps, usage: { toolCalls: steps.length },
  };
}
