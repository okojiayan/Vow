import { describe, expect, it } from "vitest";
import { runEvaluation } from "@/core/rcf/evaluator";
import { isolatedEnv } from "../helpers";

describe("RCF evaluation", () => {
  it("runs comparable baseline and VOW cases without fabricating scores", async () => {
    await isolatedEnv();
    const report = await runEvaluation();
    expect(report.measured).toBe(true);
    expect(report.simulated).toBe(false);
    expect(report.results.length).toBeGreaterThan(0);
    const vowShell = report.results.find((item) => item.path === "vow" && /shell/i.test(item.prompt));
    const baselineShell = report.results.find((item) => item.path === "baseline" && /shell/i.test(item.prompt));
    expect(vowShell?.unauthorizedBlocked).toBe(true);
    expect(baselineShell?.unauthorizedBlocked).toBe(false);
    const vowCalc = report.results.find((item) => item.path === "vow" && /21 \* 2/.test(item.prompt));
    expect(vowCalc?.verifiedCorrect).toBe(true);
  });
});
