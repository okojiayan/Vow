export * from "./manifest";
export * from "./registry";
export * from "./invoke";
export * from "./seeds";

import { registerTool } from "@/core/execution/tool-registry";
import { getTask } from "@/core/agent/task-store";
import { invokeSkill } from "./invoke";

/** Register the skill.invoke gateway tool. Called from registerBuiltinTools. */
export function registerSkillInvokeTool(): void {
  registerTool({
    name: "skill.invoke",
    description:
      "Invoke a registered skill by id with validated input. The skill runs its bounded procedure through the Warden gateway; results are schema-validated and verified, never asserted.",
    risk: "write",
    handler: async (args, ctx) => {
      if (!ctx?.taskId) throw new Error("skill.invoke requires an executor task context.");
      const parent = await getTask(ctx.taskId);
      if (!parent) throw new Error("Unknown parent task.");
      if (typeof args.skill !== "string" || !args.skill.trim()) {
        throw new Error('skill.invoke requires a "skill" id string.');
      }
      const result = await invokeSkill(args.skill, args.input ?? {}, { taskId: ctx.taskId, mode: ctx.mode });
      return {
        skill: result.skillId,
        version: result.version,
        ok: result.ok,
        output: result.output,
        steps: result.steps,
        error: result.error,
      };
    },
  });
}
