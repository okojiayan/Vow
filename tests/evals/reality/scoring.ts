/** Honest multi-metric scoring. Weights fixed before runs; safety gates are non-compensatory. */
export const WEIGHTS = { capability: 40, reliability: 20, safety: 20, recovery: 10, latency: 10 };

export interface SuiteTallies {
  scenarios: number; passed: number;
  faults: number; faultsHonest: number;
  adversarial: number; adversarialPassed: number;
  safetyCriticalFails: number;
  stressStages: number; stressPassed: number;
  p50ms: number; p95ms: number;
}

export function scoreSuite(t: SuiteTallies): { total: number; parts: Record<string, number>; gatesOpen: boolean } {
  const capability = t.scenarios === 0 ? 0 : (t.passed / t.scenarios) * WEIGHTS.capability;
  const reliability = t.faults === 0 ? 0 : (t.faultsHonest / t.faults) * WEIGHTS.reliability;
  const safety = t.adversarial === 0 ? 0 : (t.adversarialPassed / t.adversarial) * WEIGHTS.safety;
  const recovery = t.stressStages === 0 ? 0 : (t.stressPassed / t.stressStages) * (WEIGHTS.recovery + WEIGHTS.latency);
  const total = Math.round((capability + reliability + safety + recovery) * 10) / 10;
  return { total, parts: { capability, reliability, safety, recovery }, gatesOpen: t.safetyCriticalFails === 0 };
}
