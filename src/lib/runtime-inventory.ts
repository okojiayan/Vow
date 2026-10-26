import type { PermissionLevel } from "@/components/ui/badges";

/**
 * Static, hand-maintained mirror of the server-side registry for display only.
 * Sources of truth (backend, do not duplicate logic from here):
 * - built-in tools: src/core/execution/builtin-tools.ts (name, description, risk)
 * - plugin tool:    src/core/plugins/seeds.ts (text-stats analyze, risk read)
 * - skills:         src/core/skills/seeds.ts (verified-calc, workspace-report)
 * Risk -> permission badge: read -> read, network -> read-append,
 * write/destructive/command -> write (writes always need Warden approval).
 */
export interface RuntimeTool {
  name: string;
  purpose: string;
  permission: PermissionLevel;
  wardenNote: string;
}

export const BUILTIN_TOOLS: RuntimeTool[] = [
  { name: "fs.list", purpose: "List files in the workspace.", permission: "read", wardenNote: "Allowed reads run without approval." },
  { name: "fs.read", purpose: "Read a workspace file.", permission: "read", wardenNote: "Allowed reads run without approval." },
  { name: "memory.search", purpose: "Search saved memory.", permission: "read", wardenNote: "Allowed reads run without approval." },
  { name: "calc.evaluate", purpose: "Evaluate one bounded expression with the safe parser.", permission: "read", wardenNote: "Allowed reads run without approval." },
  { name: "run_sql", purpose: "Run one restricted read-only query on the approved view.", permission: "read", wardenNote: "Read-only by restriction; anything else is denied." },
  { name: "plugin.text-stats.analyze", purpose: "Count characters, words, lines, and reading time.", permission: "read", wardenNote: "Allowed reads run without approval." },
  { name: "fs.write", purpose: "Write a file inside the workspace.", permission: "write", wardenNote: "Needs approval for writes." },
  { name: "notes.create", purpose: "Create a markdown note in workspace notes.", permission: "write", wardenNote: "Needs approval for writes." },
  { name: "memory.store", purpose: "Save an observed memory with provenance.", permission: "write", wardenNote: "Needs approval for writes." },
  { name: "subagent.spawn", purpose: "Delegate a scoped subtask to a child agent.", permission: "write", wardenNote: "Needs approval; the child gets an explicit tool allowlist." },
  { name: "fs.delete", purpose: "Delete a workspace file.", permission: "write", wardenNote: "Deny-by-default; needs explicit Warden approval." },
  { name: "http.fetch", purpose: "Fetch a URL.", permission: "read-append", wardenNote: "Deny-by-default; requests are denied unless allowed." },
  { name: "shell.exec", purpose: "Run a shell command.", permission: "write", wardenNote: "Permanently denied by policy." },
];

export function toolByName(name: string): RuntimeTool | undefined {
  return BUILTIN_TOOLS.find((t) => t.name === name);
}

export interface Connector {
  id: string;
  name: string;
  purpose: string;
  permission: PermissionLevel;
  scopes: string[];
  canRead: string[];
  canChange: string[];
  cannotTouch: string[];
  requiresApproval: string[];
}

export const CONNECTORS: Connector[] = [
  {
    id: "notion",
    name: "Notion",
    purpose: "Read project pages and file research summaries back.",
    permission: "read-append",
    scopes: ["pages:read", "pages:write", "databases:query"],
    canRead: ["Pages and databases you explicitly share"],
    canChange: ["Pages it creates or you share, only after you approve"],
    cannotTouch: ["Workspace settings, members, and billing", "Pages you never share"],
    requiresApproval: ["Creating or editing any page", "Publishing a summary"],
  },
  {
    id: "github",
    name: "GitHub",
    purpose: "Read repository files and open pull requests for review.",
    permission: "write",
    scopes: ["repo:read", "pull-requests:write"],
    canRead: ["Repositories you authorize, including code and history"],
    canChange: ["Branches and pull requests it opens, only after you approve"],
    cannotTouch: ["Repository settings, secrets, and access control", "Repositories you never authorize"],
    requiresApproval: ["Pushing any branch", "Opening a pull request", "Merging anything"],
  },
  {
    id: "drive",
    name: "Google Drive",
    purpose: "Find documents and spreadsheets you name.",
    permission: "read-append",
    scopes: ["drive.readonly", "docs.readonly"],
    canRead: ["Files you open or name in a task"],
    canChange: ["Nothing — this connection is read-only"],
    cannotTouch: ["Sharing settings", "Files outside what you name", "Deleting anything"],
    requiresApproval: ["Reading any file you have not named first"],
  },
  {
    id: "slack",
    name: "Slack",
    purpose: "Post status updates and read threads you link.",
    permission: "read-append",
    scopes: ["channels:read", "chat:write"],
    canRead: ["Messages in channels and threads you link"],
    canChange: ["Messages it posts in channels you approve"],
    cannotTouch: ["Direct messages you do not link", "Workspace administration", "Deleting or editing your messages"],
    requiresApproval: ["Posting any message", "Joining any channel"],
  },
  {
    id: "linear",
    name: "Linear",
    purpose: "Track issues and report progress back.",
    permission: "write",
    scopes: ["issues:read", "issues:write"],
    canRead: ["Issues and projects in workspaces you authorize"],
    canChange: ["Issue status and comments, only after you approve"],
    cannotTouch: ["Workspace settings and billing", "Deleting issues"],
    requiresApproval: ["Creating or updating any issue", "Changing an assignee or milestone"],
  },
  {
    id: "figma",
    name: "Figma",
    purpose: "Read frame tokens and component names for handoff.",
    permission: "read",
    scopes: ["file:read", "components:read"],
    canRead: ["Files you share links to: tokens, components, layer names"],
    canChange: ["Nothing — this connection is read-only"],
    cannotTouch: ["Editing any file", "Libraries, publishing, and team settings"],
    requiresApproval: [],
  },
];

export interface SkillEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  tools: string[];
  needs: string[];
  limits: string;
}

export const SKILLS: SkillEntry[] = [
  {
    id: "verified-calc",
    name: "Verified calculation",
    version: "1.0.0",
    author: "VOW Core",
    description: "Evaluate one bounded arithmetic, boolean, or string expression with the safe calc engine and return the verified result.",
    tools: ["calc.evaluate"],
    needs: ["The expression text you provide"],
    limits: "Single expressions only; the safe parser rejects shell, network, and filesystem access.",
  },
  {
    id: "workspace-report",
    name: "Workspace report",
    version: "1.0.0",
    author: "VOW Core",
    description: "List files in one allowlisted workspace directory and return the verified entry listing.",
    tools: ["fs.list"],
    needs: ["A workspace folder path"],
    limits: "Read-only listing inside the workspace boundary; file contents are not read.",
  },
];
