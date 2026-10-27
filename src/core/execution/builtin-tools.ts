import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { submitCandidate } from "@/core/memory/lifecycle";
import { searchDictionary } from "@/core/memory/dictionary";
import { assertSafeWorkspacePath } from "@/core/warden/path-guard";
import { getEnv } from "@/lib/env";
import { createId } from "@/lib/ids";
import { runReadOnlyZetarisQuery } from "@/integrations/zetaris/client";
import { registerTool } from "./tool-registry";
import { delegate } from "@/core/agent/subagents";
import { getTask } from "@/core/agent/task-store";
import { registerSeedSkills, registerSkillInvokeTool } from "@/core/skills";
import { registerSeedPlugins } from "@/core/plugins";
import { evaluateCalcExpression } from "./calc";

function asString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing string argument "${key}".`);
  }
  return value;
}

export function registerBuiltinTools() {
  const workspaceDir = getEnv().VOW_WORKSPACE_DIR;

  registerTool({
    name: "fs.list",
    description: "List files in an allowlisted workspace directory.",
    risk: "read",
    handler: async (args) => {
      const rel = typeof args.path === "string" && args.path.trim() ? args.path : ".";
      const safe = await assertSafeWorkspacePath(workspaceDir, rel, { mustExist: true });
      const entries = await readdir(safe, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }));
    },
  });

  registerTool({
    name: "fs.read",
    description: "Read a UTF-8 file from the allowlisted workspace.",
    risk: "read",
    handler: async (args) => {
      const rel = asString(args, "path");
      const safe = await assertSafeWorkspacePath(workspaceDir, rel, { mustExist: true });
      const content = await readFile(safe, "utf8");
      return { path: rel, content: content.slice(0, 20_000) };
    },
  });

  registerTool({
    name: "fs.write",
    description: "Write a UTF-8 file inside the allowlisted workspace.",
    risk: "write",
    handler: async (args) => {
      const rel = asString(args, "path");
      const content = asString(args, "content");
      const safe = await assertSafeWorkspacePath(workspaceDir, rel);
      await mkdir(path.dirname(safe), { recursive: true });
      await writeFile(safe, content, "utf8");
      return { path: rel, bytes: Buffer.byteLength(content, "utf8") };
    },
  });

  registerTool({
    name: "notes.create",
    description: "Create a markdown note in workspace/notes.",
    risk: "write",
    handler: async (args) => {
      const title = asString(args, "title");
      const body = asString(args, "body");
      const slug =
        title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || createId("note");
      const content = `# ${title}\n\n${body}\n`;
      await mkdir(path.join(workspaceDir, "notes"), { recursive: true });
      // Never silently overwrite a colliding note: first writer wins with
      // an atomic wx create; later collisions get a numeric suffix.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const filename = `${slug}${attempt === 0 ? "" : `-${attempt + 1}`}.md`;
        const rel = path.join("notes", filename);
        const safe = await assertSafeWorkspacePath(workspaceDir, rel);
        try {
          await writeFile(safe, content, { encoding: "utf8", flag: "wx" });
          return { path: rel, content };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code;
          if (code !== "EEXIST") throw error;
        }
      }
      const fallback = `${slug}-${createId("note")}.md`;
      const rel = path.join("notes", fallback);
      const safe = await assertSafeWorkspacePath(workspaceDir, rel);
      await writeFile(safe, content, { encoding: "utf8", flag: "wx" });
      return { path: rel, content };
    },
  });

  registerTool({
    name: "memory.search",
    description: "Search Memory Dictionary for relevant records.",
    risk: "read",
    handler: async (args) => {
      const query = asString(args, "query");
      return searchDictionary(query, 8);
    },
  });

  registerTool({
    name: "memory.store",
    description: "Store an observed or inferred memory with provenance.",
    risk: "write",
    handler: async (args) => {
      const content = asString(args, "content");
      const kind = args.kind === "inference" ? "inference" : "observation";
      const outcome = await submitCandidate({
        content,
        kind,
        entities: Array.isArray(args.entities) ? args.entities.map(String) : [],
        keywords: Array.isArray(args.keywords) ? args.keywords.map(String) : [],
        source: { type: "tool", ref: "memory.store" },
        provenance: typeof args.provenance === "string" ? args.provenance : "tool:memory.store",
      });
      if (!outcome.stored) throw new Error(outcome.message);
      return { record: outcome.record, deduped: outcome.deduped };
    },
  });

  registerTool({
    name: "calc.evaluate",
    description:
      "Evaluate one bounded expression: arithmetic (+ - * / % ^, parentheses, gcd(a,b)), boolean (true/false AND OR NOT), or string (reverse('t'), count('s','t')). Safe parser only; no eval, no shell.",
    risk: "read",
    handler: async (args) => {
      const expression = asString(args, "expression");
      const parsed = evaluateCalcExpression(expression);
      return { expression: parsed.expression, result: parsed.result, kind: parsed.kind };
    },
  });

  registerTool({
    name: "run_sql",
    description:
      "Run one restricted read-only SELECT against the approved Pikachu abilities view. Supply SQL in args.sql.",
    risk: "read",
    handler: async (args) => {
      const sql = asString(args, "sql");
      return runReadOnlyZetarisQuery(sql);
    },
  });

  registerTool({
    name: "http.fetch",
    description: "Network fetch is deny-by-default and not implemented for host safety.",
    risk: "network",
    handler: async () => {
      throw new Error("http.fetch is not enabled. Warden keeps network tools deny-by-default.");
    },
  });

  registerTool({
    name: "shell.exec",
    description: "Shell execution is permanently denied.",
    risk: "command",
    handler: async () => {
      throw new Error("shell.exec is permanently denied.");
    },
  });

  registerTool({
    name: "fs.delete",
    description: "Destructive delete is deny-by-default.",
    risk: "destructive",
    handler: async () => {
      throw new Error("fs.delete is not enabled in this build.");
    },
  });

  registerTool({
    name: "subagent.spawn",
    description:
      "Delegate a scoped subtask to a child agent execution. The child runs the same task lifecycle with an explicit tool allowlist; results return as structured data, never as new permissions.",
    risk: "write",
    handler: async (args, ctx) => {
      if (!ctx?.taskId) throw new Error("subagent.spawn requires an executor task context.");
      const parent = await getTask(ctx.taskId);
      if (!parent) throw new Error("Unknown parent task.");
      const { result } = await delegate(parent, {
        role: args.role,
        objective: args.objective,
        input: args.input,
        allowedTools: args.allowedTools,
        timeoutMs: args.timeoutMs,
        maxRetries: args.maxRetries,
      });
      return {
        childTaskId: result.childTaskId,
        status: result.status,
        deliverable: result.deliverable,
        evidence: result.evidence,
        error: result.error,
      };
    },
  });

  registerSkillInvokeTool();
  registerSeedSkills();
  registerSeedPlugins();
}
