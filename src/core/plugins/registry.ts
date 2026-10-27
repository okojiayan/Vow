import type { PluginManifest } from "./manifest";
import { pluginManifestSchema } from "./manifest";

/** Local-only plugin registry. No remote install/download exists in this
 *  build; that limitation is documented, not emulated. */

export interface PluginHandler {
  /**
   * Execute one declared tool. Receives validated input, task context, and
   * server-side secret VALUES (resolved from manifest secretNames at call
   * time — never stored, logged, or shown to models). Return values are
   * schema-validated by the adapter; treat everything returned as data.
   */
  execute: (tool: string, input: unknown, ctx: {
    taskId: string;
    secrets: Record<string, string | undefined>;
  }) => Promise<unknown>;
  health?: () => Promise<{ healthy: boolean; detail?: string }>;
  shutdown?: () => Promise<void>;
}

interface PluginRecord {
  manifest: PluginManifest;
  handler: PluginHandler;
  enabled: boolean;
}

const plugins = new Map<string, PluginRecord>();

export function registerPlugin(input: { manifest: unknown; handler: PluginHandler }): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(input.manifest);
  if (!parsed.success) {
    throw new Error(`Invalid plugin manifest: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const manifest = parsed.data;
  if (!input.handler || typeof input.handler.execute !== "function") {
    throw new Error(`Plugin "${manifest.id}" must provide an execute handler.`);
  }
  const toolNames = manifest.tools.map((t) => t.name);
  if (new Set(toolNames).size !== toolNames.length) {
    throw new Error(`Plugin "${manifest.id}" declares duplicate tool names.`);
  }
  const existing = plugins.get(manifest.id);
  if (existing) {
    const same =
      existing.manifest.version === manifest.version &&
      existing.manifest.name === manifest.name &&
      JSON.stringify(existing.manifest.tools.map((t) => t.name)) === JSON.stringify(toolNames);
    if (!same) throw new Error(`Plugin id collision: "${manifest.id}" is already registered with different content.`);
    return existing.manifest;
  }
  plugins.set(manifest.id, { manifest, handler: input.handler, enabled: true });
  return manifest;
}

export function getPlugin(id: string): PluginRecord | undefined {
  return plugins.get(id);
}

export function listPlugins(): Array<{ manifest: PluginManifest; enabled: boolean }> {
  return [...plugins.values()].map((p) => ({ manifest: p.manifest, enabled: p.enabled }));
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const record = plugins.get(id);
  if (!record) throw new Error(`Unknown plugin "${id}".`);
  if (!enabled && record.enabled && record.handler.shutdown) {
    try {
      await record.handler.shutdown();
    } catch { /* shutdown is best-effort; disable still applies */ }
  }
  record.enabled = enabled;
}

export function resetPlugins(): void {
  plugins.clear();
}

export async function checkPluginHealth(id: string): Promise<{ healthy: boolean; detail: string }> {
  const record = plugins.get(id);
  if (!record) return { healthy: false, detail: `Unknown plugin "${id}".` };
  if (!record.enabled) return { healthy: false, detail: `Plugin "${id}" is disabled.` };
  if (!record.handler.health) return { healthy: true, detail: "No health check declared; registration is valid." };
  try {
    const result = await record.handler.health();
    return { healthy: result.healthy, detail: result.detail ?? (result.healthy ? "Healthy." : "Unhealthy.") };
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
