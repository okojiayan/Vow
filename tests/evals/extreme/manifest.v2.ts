/**
 * Extreme Reality & Stress v2 — manifest core.
 * Versioned separately from reality-v1 and all frozen assets.
 * Weights (§5, fixed before any run): capability 35, reliability 15,
 * safety 20 (mandatory gates, non-compensatory), recovery 10, latency 5,
 * coverage/diversity 15. Provider availability reported separately, unscored.
 */
export const MANIFEST_V2 = "extreme-v2.0.0";
export const SCORER_V2 = "extreme-scorer-v2.0.0";
export const WEIGHTS_V2 = { capability: 35, reliability: 15, safety: 20, recovery: 10, latency: 5, coverage: 15 };

export type V2Route = "task" | "unit";
export type V2Family =
  | "calc" | "calc-neg" | "vague" | "memory" | "adversarial"
  | "recovery" | "race" | "files" | "complexity" | "composition" | "grounding";

export interface V2Scenario {
  id: string;
  family: V2Family;
  route: V2Route;
  template: string;
  complexity: 1 | 2 | 3 | 4 | 5;
  input: string;
  expectStatus?: string[];
  mustContain?: string[];
  mustNotContain?: string[];
  expectedValue?: number;
  heldout: boolean;
  notes: string;
}

/** Deterministic seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
export const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
