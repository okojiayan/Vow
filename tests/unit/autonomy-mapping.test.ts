import { describe, expect, it } from "vitest";
import { AUTONOMY_OPTIONS, backendModeFor, isWardenUiMode, optionFor, uiModeForBackend } from "@/lib/autonomy";

describe("autonomy mapping", () => {
  it("exposes four user modes", () => {
    expect(AUTONOMY_OPTIONS.map((o) => o.id)).toEqual(["manual", "smart", "full", "warden"]);
  });
  it("maps manual/smart/full to supervised/assisted/autonomous", () => {
    expect(backendModeFor("manual")).toBe("supervised");
    expect(backendModeFor("smart")).toBe("assisted");
    expect(backendModeFor("full")).toBe("autonomous");
  });
  it("maps warden to autonomous backend with visual flag", () => {
    expect(backendModeFor("warden")).toBe("autonomous");
    expect(isWardenUiMode("warden")).toBe(true);
    expect(isWardenUiMode("full")).toBe(false);
  });
  it("never exposes a mode without Warden enforcement", () => {
    for (const o of AUTONOMY_OPTIONS) {
      expect(["supervised", "assisted", "autonomous"]).toContain(o.backend);
    }
    expect(optionFor("smart").backend).toBe("assisted");
  });
  it("round-trips backend + warden flag", () => {
    expect(uiModeForBackend("supervised", false)).toBe("manual");
    expect(uiModeForBackend("autonomous", true)).toBe("warden");
    expect(uiModeForBackend("autonomous", false)).toBe("full");
  });
});
