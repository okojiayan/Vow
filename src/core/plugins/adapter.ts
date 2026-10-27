import { registerTool } from "@/core/execution/tool-registry";
import { registerToolPermission } from "@/core/warden/policy";
import { appendTrace } from "@/core/traces/trace-store";
import { appendLedger } from "@/core/reasoning/ledger";
import { getPlugin } from "./registry";

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

/**
 * Wire a registered plugin's declared tools into the shared tool registry.
 * Namespaced as plugin.<id>.<tool> so a plugin can never collide with (or
 * silently replace) a trusted tool; first-registration-wins still applies.
 * Every invocation validates input AND output, enforces the tool timeout,
 * resolves secret values server-side only, and scrubs secrets from traces.
 * Authorization stays with Warden: each namespaced tool gets a permission
 * entry (require_approval by default) evaluated on every call.
 */
export function mountPluginTools(pluginId: string): string[] {
  const record = getPlugin(pluginId);
  if (!record) throw new Error(`Unknown plugin "${pluginId}".`);
  const mounted: string[] = [];
  for (const tool of record.manifest.tools) {
    const fullName = `plugin.${record.manifest.id}.${tool.name}`;
    registerToolPermission({
      tool: fullName,
      risk: tool.risk,
      defaultEffect: "require_approval",
      assistedEffect: "require_approval",
      autonomousEffect: tool.risk === "read" ? "allow" : "require_approval",
    });
    registerTool({
      name: fullName,
      description: `[${record.manifest.name} v${record.manifest.version}] ${tool.description}`,
      risk: tool.risk,
      handler: async (args, ctx) => {
        if (!ctx?.taskId) throw new Error(`Tool "${fullName}" requires an executor task context.`);
        const live = getPlugin(pluginId);
        if (!live?.enabled) throw new Error(`Plugin "${pluginId}" is disabled; execution refused cleanly.`);
        const inputParsed = tool.inputSchema.safeParse(args);
        if (!inputParsed.success) {
          throw new Error(`Invalid input for "${fullName}": ${inputParsed.error.issues.map((i) => i.message).join("; ")}`);
        }
        const secrets: Record<string, string | undefined> = {};
        for (const name of record.manifest.secretNames) {
          secrets[name] = process.env[name];
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const budget = new Promise<never>(
          (_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), tool.timeoutMs); },
        );
        let raw: unknown;
        try {
          raw = await Promise.race([live.handler.execute(tool.name, inputParsed.data, { taskId: ctx.taskId, secrets }), budget]);
        } catch (error) {
          const message = error instanceof Error && error.message === "timeout"
            ? `Plugin tool "${fullName}" exceeded its ${tool.timeoutMs}ms budget.`
            : error instanceof Error ? error.message : String(error);
          await appendTrace(ctx.taskId, { kind: "failure", title: `Plugin tool failed (${fullName})`, detail: String(scrub(message)).slice(0, 300) });
          throw new Error(message);
        } finally {
          if (timer) clearTimeout(timer);
        }
        const outputParsed = tool.outputSchema.safeParse(raw);
        if (!outputParsed.success) {
          const message = `Plugin tool "${fullName}" returned invalid output: ${outputParsed.error.issues.map((i) => i.message).join("; ")}`;
          await appendTrace(ctx.taskId, { kind: "failure", title: `Plugin output invalid (${fullName})`, detail: message.slice(0, 300) });
          throw new Error(message);
        }
        await appendTrace(ctx.taskId, {
          kind: "tool_call",
          title: `Plugin tool ok: ${fullName}`,
          detail: `Validated output from ${record.manifest.id} v${record.manifest.version}.`,
        });
        appendLedger(ctx.taskId, { kind: "tool_outcome", title: `Plugin tool ok: ${fullName}`, detail: "Output schema passed." });
        return scrub(outputParsed.data);
      },
    });
    mounted.push(fullName);
  }
  return mounted;
}
