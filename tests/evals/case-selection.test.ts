/* Focused validation for the opt-in BENCH_CASES selection mechanism.
 * Pure/offline only: no network, no model calls, no scoring changes. */
import { describe, expect, it } from "vitest";
import { parseBenchCaseIds, filterCasesByIds } from "./bench-protocol";

const valid = new Set(["R01", "R11", "P01", "P14", "M01", "M03", "X05", "X17", "S11", "S13"]);

describe("BENCH_CASES explicit selection (offline)", () => {
  it("treats undefined/empty/whitespace as no override", () => {
    expect(parseBenchCaseIds(undefined, valid)).toBeNull();
    expect(parseBenchCaseIds("", valid)).toBeNull();
    expect(parseBenchCaseIds("   ", valid)).toBeNull();
  });

  it("parses a valid list and preserves input order", () => {
    expect(parseBenchCaseIds("R01,M03,S13", valid)).toEqual(["R01", "M03", "S13"]);
    expect(parseBenchCaseIds("  M03 , R01  ", valid)).toEqual(["M03", "R01"]);
  });

  it("rejects unknown case IDs", () => {
    expect(() => parseBenchCaseIds("R01,ZZ99", valid)).toThrow(/unknown case ID/);
    expect(() => parseBenchCaseIds("r01", valid)).toThrow(/unknown case ID/);
  });

  it("rejects duplicate case IDs", () => {
    expect(() => parseBenchCaseIds("R01,R01", valid)).toThrow(/duplicate/);
    expect(() => parseBenchCaseIds("M03, M03 ", valid)).toThrow(/duplicate/);
  });

  it("rejects empty tokens from stray commas", () => {
    expect(() => parseBenchCaseIds("R01,,M03", valid)).toThrow(/empty case ID/);
    expect(() => parseBenchCaseIds(",R01", valid)).toThrow(/empty case ID/);
    expect(() => parseBenchCaseIds("R01,", valid)).toThrow(/empty case ID/);
  });

  it("filters cases in manifest order, not input order", () => {
    const manifest = [{ id: "R01" }, { id: "R11" }, { id: "M03" }, { id: "S13" }];
    expect(filterCasesByIds(manifest, ["S13", "R01"]).map((c) => c.id)).toEqual(["R01", "S13"]);
    expect(filterCasesByIds(manifest, ["M03"]).map((c) => c.id)).toEqual(["M03"]);
    expect(filterCasesByIds(manifest, []).length).toBe(0);
  });

  it("accepts the Phase 2F ten-case set shape", () => {
    const ten = "R01,R11,P01,P14,M01,M03,X05,X17,S11,S13";
    const parsed = parseBenchCaseIds(ten, valid);
    expect(parsed).toHaveLength(10);
    expect(new Set(parsed).size).toBe(10);
  });
});
