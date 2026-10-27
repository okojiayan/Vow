import type { SkillManifest } from "./manifest";
import { skillManifestSchema } from "./manifest";

const skills = new Map<string, SkillManifest>();

/**
 * Local skill registry. Same deterministic semantics as the tool registry:
 * first registration wins; a duplicate id with different content is
 * rejected so a skill can never silently replace a trusted definition.
 */
export function registerSkill(manifest: unknown): SkillManifest {
  const parsed = skillManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(`Invalid skill manifest: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const def = parsed.data;
  const existing = skills.get(def.id);
  if (existing) {
    const same =
      existing.version === def.version &&
      existing.name === def.name &&
      JSON.stringify(existing.procedure) === JSON.stringify(def.procedure) &&
      JSON.stringify(existing.allowedTools) === JSON.stringify(def.allowedTools);
    if (!same) throw new Error(`Skill id collision: "${def.id}" is already registered with different content.`);
    return existing;
  }
  for (const step of def.procedure) {
    if (!def.allowedTools.includes(step.tool)) {
      throw new Error(`Skill "${def.id}" procedure uses "${step.tool}" outside its allowedTools.`);
    }
  }
  for (const tool of def.requiredTools) {
    if (!def.allowedTools.includes(tool)) {
      throw new Error(`Skill "${def.id}" requires "${tool}" outside its allowedTools.`);
    }
  }
  skills.set(def.id, def);
  return def;
}

export function getSkill(id: string): SkillManifest | undefined {
  return skills.get(id);
}

export function listSkills(): SkillManifest[] {
  return [...skills.values()];
}

export function resetSkills(): void {
  skills.clear();
}

/**
 * Rank registry skills against a request using explicit trigger phrases and
 * token overlap with the skill description. Returns matches only — never
 * invents a capability. The planner uses this for explanation; execution
 * always goes through invokeSkill with registry membership enforced.
 */
export function findSkills(query: string, limit = 3): Array<{ skill: SkillManifest; score: number; reason: string }> {
  const lower = query.toLowerCase();
  const tokens = new Set(lower.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const ranked: Array<{ skill: SkillManifest; score: number; reason: string }> = [];
  for (const skill of skills.values()) {
    let score = 0;
    const hitTriggers: string[] = [];
    for (const trigger of skill.triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        score += 10;
        hitTriggers.push(trigger);
      }
    }
    let overlap = 0;
    for (const token of tokens) {
      if (skill.description.toLowerCase().includes(token)) overlap += 1;
    }
    score += Math.min(overlap, 5);
    // A lone shared word is noise, not a match: description-only candidates
    // need at least two overlapping terms; trigger hits always qualify.
    if (score >= 2) {
      ranked.push({
        skill,
        score,
        reason: hitTriggers.length > 0
          ? `Trigger phrase match: ${hitTriggers.join(", ")}.`
          : `Description overlap (${overlap} terms).`,
      });
    }
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}
