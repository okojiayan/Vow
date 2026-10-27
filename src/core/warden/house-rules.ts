import { createId } from "@/lib/ids";
import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";

export type RuleCategory = "confirm-outside-project" | "confirm-pii-send" | "no-auto-delete" | "confirm-network";
export type RuleEffect = "require_approval" | "deny";

export interface HouseRule {
  id: string;
  category: RuleCategory;
  description: string;
  scope: string;
  effect: RuleEffect;
  active: boolean;
  createdAt: string;
  confirmedAt?: string;
}

const STORE = () => dataPath("house-rules.json");

const CATEGORY_PATTERNS: Array<{ category: RuleCategory; effect: RuleEffect; scope: string; re: RegExp; description: string }> = [
  {
    category: "confirm-outside-project",
    effect: "require_approval",
    scope: "workspace",
    re: /\b(ask|confirm|check).{0,40}(outside|different|other).{0,30}(project|folder|director)/i,
    description: "Ask before modifying files outside the current project.",
  },
  {
    category: "confirm-pii-send",
    effect: "require_approval",
    scope: "outbound",
    re: /\b(never\s+send|ask\s+before\s+(sending|sharing)|confirm\s+before).{0,50}(personal|private|pii|information|data)\b/i,
    description: "Never send personal information without confirmation.",
  },
  {
    category: "no-auto-delete",
    effect: "deny",
    scope: "workspace",
    re: /\b(do\s*not|never|don't)\b.{0,30}\bdelete\b.{0,30}(automatically|without\s+(asking|confirmation|me)|files?)?/i,
    description: "Do not delete files automatically.",
  },
  {
    category: "confirm-network",
    effect: "require_approval",
    scope: "network",
    re: /\b(ask|confirm).{0,40}(before|before\s+any).{0,30}(network|internet|web|external|upload|download)/i,
    description: "Ask before any network or external access.",
  },
];

export interface RuleProposal {
  supported: boolean;
  reason: string;
  rule?: HouseRule;
}

/** Parse user text into a supported structured rule. LLM text is data: only
 *  these fixed patterns produce rules; anything else is honestly refused. */
export function proposeRule(text: string): RuleProposal {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { supported: false, reason: "Empty rule text." };
  const matches = CATEGORY_PATTERNS.filter((p) => p.re.test(trimmed));
  if (matches.length === 0) {
    return { supported: false, reason: "Unsupported rule category. Supported: ask-before-outside-project, confirm personal-data sends, no auto-delete, confirm network access. Please rephrase into one of these." };
  }
  if (matches.length > 1) {
    return { supported: false, reason: `Ambiguous rule: matches ${matches.map((m) => m.category).join(", ")}. Please state one rule at a time.` };
  }
  const m = matches[0];
  return {
    supported: true,
    reason: `Parsed as ${m.category}. Review the scope below before activating.`,
    rule: { id: createId("rule"), category: m.category, description: m.description, scope: m.scope, effect: m.effect, active: false, createdAt: new Date().toISOString() },
  };
}

export async function listRules(): Promise<HouseRule[]> {
  return readJsonFile<HouseRule[]>(STORE(), []);
}

export async function findConflicts(candidate: HouseRule): Promise<HouseRule[]> {
  const all = await listRules();
  return all.filter((r) => r.active && r.category === candidate.category && r.scope !== candidate.scope);
}

export async function confirmRule(id: string): Promise<HouseRule> {
  let out: HouseRule | null = null;
  await mutateJsonFile<HouseRule[]>(STORE(), [], (current) =>
    current.map((r) => {
      if (r.id !== id) return r;
      out = { ...r, active: true, confirmedAt: new Date().toISOString() };
      return out;
    }),
  );
  if (!out) throw new Error("Unknown rule.");
  return out;
}

export async function stageRule(rule: HouseRule): Promise<HouseRule> {
  await mutateJsonFile<HouseRule[]>(STORE(), [], (current) => [...current, rule]);
  return rule;
}

export async function deactivateRule(id: string): Promise<HouseRule | null> {
  let out: HouseRule | null = null;
  await mutateJsonFile<HouseRule[]>(STORE(), [], (current) =>
    current.map((r) => {
      if (r.id !== id) return r;
      out = { ...r, active: false };
      return out;
    }),
  );
  return out;
}

export async function activeRules(): Promise<HouseRule[]> {
  return (await listRules()).filter((r) => r.active);
}

export interface RuleEvaluation {
  effect: "allow" | "require_approval" | "deny";
  rule?: HouseRule;
  reason?: string;
}

/** Rules only ever restrict (deny / require_approval). They can never
 *  widen permissions: there is no allow effect in this representation. */
export async function evaluateRules(input: { tool: string; target?: string; args?: Record<string, unknown>; projectRoot?: string }): Promise<RuleEvaluation> {
  const rules = await activeRules();
  for (const rule of rules) {
    if (rule.category === "no-auto-delete" && (input.tool === "fs.delete" || /delete/i.test(input.tool))) {
      return { effect: "deny", rule, reason: `House rule "${rule.description}" denies deletes.` };
    }
    if (rule.category === "confirm-network" && input.tool === "http.fetch") {
      return { effect: "require_approval", rule, reason: `House rule "${rule.description}" requires approval for network access.` };
    }
    if (rule.category === "confirm-outside-project" && input.target && (input.tool.startsWith("fs.") || input.tool === "notes.create")) {
      const root = (input.projectRoot ?? "demo/sandbox").replace(/\/$/, "");
      const t = input.target.replace(/\\/g, "/");
      if (!(t === root || t.startsWith(`${root}/`))) {
        return { effect: "require_approval", rule, reason: `House rule "${rule.description}" requires approval outside ${root}.` };
      }
    }
  }
  return { effect: "allow" };
}
