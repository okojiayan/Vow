import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_TOOLS, CONNECTORS, SKILLS, effectForMode } from "@/lib/runtime-inventory";

/**
 * Guards the static display mirror in src/lib/runtime-inventory.ts against
 * drift from the backend sources of truth. Pure source-text comparison: the
 * backend modules are never imported (no handlers, no side effects).
 */
function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

const RISK_TO_PERMISSION: Record<string, string> = {
  read: "read",
  network: "read-append",
  write: "write",
  destructive: "write",
  command: "write",
};

describe("runtime-inventory mirror", () => {
  it("covers every builtin tool with the matching risk-derived permission", () => {
    const backend = src("src/core/execution/builtin-tools.ts");
    const found = [...backend.matchAll(/name:\s*"([^"]+)",\s*\n\s*description:[\s\S]*?risk:\s*"([^"]+)"/g)].map((m) => ({
      name: m[1],
      risk: m[2],
    }));
    expect(found.length).toBeGreaterThan(0);
    const mirrored = new Map(BUILTIN_TOOLS.filter((t) => !t.name.startsWith("plugin.")).map((t) => [t.name, t.permission]));
    for (const tool of found) {
      expect(mirrored.has(tool.name), `tool ${tool.name} missing from runtime-inventory`).toBe(true);
      expect(mirrored.get(tool.name)).toBe(RISK_TO_PERMISSION[tool.risk]);
    }
    // No invented tools: every non-plugin mirror entry must exist in the backend.
    const backendNames = new Set(found.map((t) => t.name));
    for (const name of mirrored.keys()) {
      expect(backendNames.has(name), `mirror lists unknown tool ${name}`).toBe(true);
    }
  });

  it("matches TOOL_PERMISSIONS effects per mode", () => {
    const policy = src("src/core/warden/policy.ts");
    const blocks = [...policy.matchAll(/\{ tool: "([^"]+)",([\s\S]*?) \},/g)];
    expect(blocks.length).toBeGreaterThan(0);
    const eff = (body: string, key: string, fallback: string): string => {
      const m = body.match(new RegExp(`${key}:\\s*"([^"]+)"`));
      return m ? m[1] : fallback;
    };
    for (const [, name, body] of blocks) {
      const tool = BUILTIN_TOOLS.find((t) => t.name === name);
      expect(tool, `policy tool ${name} missing from runtime-inventory`).toBeTruthy();
      if (!tool) continue;
      const def = eff(body, "defaultEffect", "MISSING");
      const asst = eff(body, "assistedEffect", def);
      const auto = eff(body, "autonomousEffect", def);
      expect(tool.effects.default).toBe(def);
      expect(tool.effects.assisted).toBe(asst);
      expect(tool.effects.autonomous).toBe(auto);
      // effectForMode follows the same fallback rule as the backend (supervised -> default).
      expect(effectForMode(tool, "supervised")).toBe(def);
      expect(effectForMode(tool, "assisted")).toBe(asst);
      expect(effectForMode(tool, "autonomous")).toBe(auto);
    }
  });

  it("matches the registered plugin tool and skills", () => {
    const pluginSeeds = src("src/core/plugins/seeds.ts");
    expect(pluginSeeds).toContain('"text-stats"');
    expect(BUILTIN_TOOLS.some((t) => t.name === "plugin.text-stats.analyze")).toBe(true);
    const skillSeeds = src("src/core/skills/seeds.ts");
    for (const skill of SKILLS) {
      expect(skillSeeds).toContain(`id: "${skill.id}"`);
      expect(skillSeeds).toContain(`name: "${skill.name}"`);
      expect(skillSeeds).toContain(`version: "${skill.version}"`);
    }
    const seedIds = [...skillSeeds.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
    for (const id of seedIds) {
      expect(SKILLS.some((s) => s.id === id), `seed skill ${id} missing from mirror`).toBe(true);
    }
  });

  it("connectors carry scopes and honest approval lists", () => {
    for (const c of CONNECTORS) {
      expect(c.scopes.length).toBeGreaterThan(0);
      // Read-only connectors need no approvals; anything that can change
      // must name what requires approval.
      if (c.permission === "read") continue;
      expect(c.requiresApproval.length, `${c.id} can change but names no approvals`).toBeGreaterThan(0);
    }
  });
});
