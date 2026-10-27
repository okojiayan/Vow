import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifySteps } from "@/core/verification/verifier";
import type { PlanStep } from "@/core/agent/types";
import { isolatedEnv } from "../../helpers";

const pikachuSql =
  "SELECT ability_name, is_hidden FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu' ORDER BY ability_name LIMIT 100";

function zetarisStep(
  output: unknown,
  sql: string = pikachuSql,
): PlanStep {
  return {
    id: "zetaris-test",
    title: "Query Pikachu abilities",
    instruction: "Query Pikachu abilities",
    requiresApproval: false,
    status: "verified",
    action: { tool: "run_sql", args: { sql }, target: "pokeapi.pikachu_abilities_table" },
    output,
  };
}

describe("verification", () => {
  it("does not treat missing output as success", async () => {
    const step: PlanStep = {
      id: "s1",
      title: "Write",
      instruction: "write",
      requiresApproval: false,
      status: "verified",
      action: { tool: "fs.write", args: { path: "x.txt", content: "hello" } },
    };
    const result = await verifySteps([step]);
    expect(result.passed).toBe(false);
  });

  it("passes when the workspace file actually contains the content", async () => {
    const { workspace } = await isolatedEnv();
    await writeFile(path.join(workspace, "hello.txt"), "hello from vow");
    const step: PlanStep = {
      id: "s2",
      title: "Write",
      instruction: "write",
      requiresApproval: false,
      status: "verified",
      action: { tool: "fs.write", args: { path: "hello.txt", content: "hello from vow" } },
      output: { path: "hello.txt", bytes: 15 },
    };
    const result = await verifySteps([step]);
    expect(result.passed).toBe(true);
  });

  it("verifies a consistent Zetaris query with real rows", async () => {
    const result = await verifySteps([
      zetarisStep({
        sql: pikachuSql,
        rows: [["lightning-rod", "true"], ["static", "false"]],
        rowCount: 2,
        requestId: "request-test-1",
      }),
    ]);

    expect(result.passed).toBe(true);
    expect(result.checks[0]?.name).toBe("zetaris-result");
  });

  it("rejects empty Pikachu query results", async () => {
    const result = await verifySteps([
      zetarisStep({
        sql: pikachuSql,
        rows: [],
        rowCount: 0,
        requestId: "request-test-2",
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.checks[0]?.explanation).toContain("returned no rows");
  });

  it("rejects executed SQL that differs from the planned query", async () => {
    const result = await verifySteps([
      zetarisStep({
        sql: "SELECT * FROM other_table LIMIT 100",
        rows: [["lightning-rod", "true"]],
        rowCount: 1,
        requestId: "request-test-3",
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.checks[0]?.explanation).toContain("does not match");
  });

  it("rejects an inconsistent Zetaris row count", async () => {
    const result = await verifySteps([
      zetarisStep({
        sql: pikachuSql,
        rows: [["lightning-rod", "true"], ["static", "false"]],
        rowCount: 1,
        requestId: "request-test-4",
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.checks[0]?.explanation).toContain("does not match");
  });

});
