import { z } from "zod";

const zodSchema = z.custom<z.ZodTypeAny>(
  (value) => value instanceof z.ZodType,
  { message: "Expected a zod schema." },
);

export const pluginToolSchema = z.object({
  /** Bare tool name; registered as plugin.<plugin-id>.<name>. */
  name: z.string().regex(/^[a-z][a-z0-9.-]{1,60}$/),
  description: z.string().trim().min(1).max(1000),
  risk: z.enum(["read", "write", "network", "command", "destructive"]),
  inputSchema: zodSchema,
  outputSchema: zodSchema,
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
});

export const pluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().trim().min(1).max(2000),
  /** Engine compatibility. Only major version 1 is supported by this build. */
  engine: z.string().regex(/^1\.\d+\.\d+$/),
  capabilities: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
  tools: z.array(pluginToolSchema).min(1).max(16),
  /** Existing registered tools this plugin may call through the gateway. */
  requiresTools: z.array(z.string().min(1)).max(24).default([]),
  /** Secret NAMES resolved server-side at execution. Values never appear here. */
  secretNames: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,80}$/)).max(12).default([]),
  limitations: z.string().max(2000).default(""),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginToolDef = z.infer<typeof pluginToolSchema>;
