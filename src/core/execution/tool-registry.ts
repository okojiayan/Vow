import type { OperatingMode, RiskClass } from "@/core/warden/types";

/** Execution context handed to tool handlers. Present for every executor
 *  invocation; handlers that do not need it simply ignore it. */
export interface ToolContext {
  taskId: string;
  mode: OperatingMode;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: RiskClass;
  handler: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<unknown>;
}

const tools = new Map<string, ToolDefinition>();

export function registerTool(definition: ToolDefinition) {
  // Idempotent: repeated ensureRuntime calls re-register the same builtins.
  // Keep the first registration so a duplicate name can never silently
  // override a trusted tool definition.
  if (!tools.has(definition.name)) tools.set(definition.name, definition);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()];
}

export function resetTools() {
  tools.clear();
}
