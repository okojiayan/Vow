import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/core/warden/policy";
import { validateReadOnlyZetarisSql } from "@/integrations/zetaris/sql-policy";

const safeSql =
  "SELECT pokemon_name, ability_name, is_hidden FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu' ORDER BY ability_name LIMIT 20";

describe("Zetaris read-only SQL policy", () => {
  it("accepts a SELECT on the approved view", () => {
    const result = validateReadOnlyZetarisSql(`${safeSql};`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toBe(safeSql);
  });

  it("rejects destructive SQL", () => {
    expect(
      validateReadOnlyZetarisSql(
        "DROP TABLE pokeapi.pikachu_abilities_table",
      ).ok,
    ).toBe(false);
  });

  it("rejects access to other tables", () => {
    expect(
      validateReadOnlyZetarisSql("SELECT * FROM secret_table").ok,
    ).toBe(false);
  });

  it("rejects UNION and multiple statements", () => {
    expect(
      validateReadOnlyZetarisSql(
        "SELECT * FROM pokeapi.pikachu_abilities_table UNION SELECT * FROM secret_table",
      ).ok,
    ).toBe(false);

    expect(
      validateReadOnlyZetarisSql(
        `${safeSql}; SELECT * FROM secret_table`,
      ).ok,
    ).toBe(false);
  });

  it("rejects excessive row limits", () => {
    expect(
      validateReadOnlyZetarisSql(
        "SELECT * FROM pokeapi.pikachu_abilities_table LIMIT 100000",
      ).ok,
    ).toBe(false);
  });

  it("makes Warden deny unsafe run_sql requests", () => {
    const decision = evaluatePolicy({
      requestId: "test-request",
      tool: "run_sql",
      args: { sql: "DROP TABLE pokeapi.pikachu_abilities_table" },
      mode: "supervised",
      hasMatchingApproval: false,
    });

    expect(decision.effect).toBe("deny");
    expect(decision.policy).toBe("deny.zetaris.read-only");
  });

  it("allows safe run_sql requests through the policy", () => {
    const decision = evaluatePolicy({
      requestId: "test-request-safe",
      tool: "run_sql",
      args: { sql: safeSql },
      mode: "supervised",
      hasMatchingApproval: false,
    });

    expect(decision.effect).toBe("allow");
  });
});
