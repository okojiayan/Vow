import { describe, expect, it } from "vitest";
import { getAdapter } from "@/core/keep/adapter";
import { findRecurring, parseStatementCsv } from "@/core/keep/money";
import { readFile } from "node:fs/promises";

describe("keep adapter + money detector", () => {
  it("mock adapter swaps without changing callers", async () => {
    const a = getAdapter("mock");
    const out = await a.generate([{ role: "user", content: "hi" }], []);
    expect(out.text).toMatch(/MOCK-REPLY/);
    expect(out.adapter).toBe("mock");
  });
  it("missing adapters fail with clear message", async () => {
    expect(() => getAdapter("llama")).toThrow(/not approved in Phase 1/);
  });
  it("deterministic detector finds recurring groups", async () => {
    const csv = await readFile("demo/statement_oct.csv", "utf8");
    const rows = parseStatementCsv(csv);
    expect(rows.length).toBe(60);
    const groups = findRecurring(rows);
    // 11 merchants repeat
    expect(groups.length).toBeGreaterThanOrEqual(11);
    const unused = groups.filter((g) => g.unused_hint);
    expect(unused.length).toBeGreaterThanOrEqual(3);
  });
});
