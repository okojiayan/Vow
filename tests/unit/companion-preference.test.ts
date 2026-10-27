// Companion preference: Off / Subtle / Full persist and default to Full.
import { describe, expect, it, vi, beforeEach } from "vitest";

const store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from "@/lib/preferences";

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe("companion preference", () => {
  it("defaults to full", () => {
    expect(loadPreferences().companion).toBe("full");
    expect(DEFAULT_PREFERENCES.companion).toBe("full");
  });
  it("persists off / subtle / full round-trips", () => {
    for (const mode of ["off", "subtle", "full"] as const) {
      savePreferences({ ...loadPreferences(), companion: mode });
      expect(loadPreferences().companion).toBe(mode);
    }
  });
  it("survives missing storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPreferences().companion).toBe("full");
  });
});
