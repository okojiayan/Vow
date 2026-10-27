import { z } from "zod";
import { registerSkill } from "./registry";

/**
 * Seed skills built only from existing, tested tools. No placeholders:
 * each seed executes a real tool path and verifies its declared result.
 */
export function registerSeedSkills(): void {
  registerSkill({
    id: "verified-calc",
    name: "Verified calculation",
    version: "1.0.0",
    description: "Evaluate one bounded arithmetic, boolean, or string expression with the safe calc engine and return the verified result.",
    triggers: ["skill:verified-calc", "verified calculation"],
    inputSchema: z.object({ expression: z.string().trim().min(1).max(500) }),
    outputSchema: z.object({
      expression: z.string(),
      result: z.union([z.number(), z.string(), z.boolean()]),
      kind: z.string(),
    }),
    allowedTools: ["calc.evaluate"],
    procedure: [{ tool: "calc.evaluate", args: { expression: "{{input.expression}}" } }],
    requiredTools: ["calc.evaluate"],
    timeoutMs: 30000,
    limitations: "Single expressions only; the safe parser rejects shell, network, and filesystem access.",
  });

  registerSkill({
    id: "workspace-report",
    name: "Workspace report",
    version: "1.0.0",
    description: "List files in one allowlisted workspace directory and return the verified entry listing.",
    triggers: ["skill:workspace-report", "workspace report"],
    inputSchema: z.object({ path: z.string().trim().min(1).max(500).default(".") }),
    outputSchema: z.array(z.object({ name: z.string(), type: z.string() })),
    allowedTools: ["fs.list"],
    procedure: [{ tool: "fs.list", args: { path: "{{input.path}}" } }],
    requiredTools: ["fs.list"],
    timeoutMs: 30000,
    limitations: "Read-only listing inside the workspace boundary; contents are not read.",
  });
}
