import { z } from "zod";

const zodSchema = z.custom<z.ZodTypeAny>(
  (value) => value instanceof z.ZodType,
  { message: "Expected a zod schema." },
);

export const skillStepSchema = z.object({
  tool: z.string().min(1).max(120),
  /** Static args; strings may reference validated input as {{input.path.to.field}}. */
  args: z.record(z.string(), z.unknown()).default({}),
});

export const skillManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().trim().min(1).max(2000),
  /** Explicit phrases that select this skill. Never model-invented. */
  triggers: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
  inputSchema: zodSchema,
  outputSchema: zodSchema,
  /** Every tool the procedure may invoke. Enforced before and during execution. */
  allowedTools: z.array(z.string().min(1)).min(1).max(12),
  /** Bounded procedure: 1-8 steps, each a registered tool call. */
  procedure: z.array(skillStepSchema).min(1).max(8),
  /** Tools whose ok status is required for a verified result. */
  requiredTools: z.array(z.string().min(1)).min(1),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  limitations: z.string().max(2000).default(""),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillStep = z.infer<typeof skillStepSchema>;
