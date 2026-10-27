import type { PlanStep } from "@/core/agent/types";
import { checkAnalysis, checkCalc, checkToolOutput, checkWorkspaceWrite } from "./checks";
import type { CheckResult, VerificationResult } from "./result";

const NON_MEANINGFUL = new Set([
  "Not a write step.",
  "Not a calc step.",
  "Not an analysis step.",
  "Not an outcome step.",
]);

export async function verifySteps(steps: PlanStep[], goal = ""): Promise<VerificationResult> {
  const executable = steps.filter((step) => step.action);
  if (executable.length === 0) {
    // Planner-explicit standalone answers (expectGrounding "none"): the
    // provider-backed answer itself is the deliverable. Anything else with no
    // executable step — including model plans that merely talk — is refused.
    const standalone: CheckResult[] = [];
    for (const step of steps) {
      standalone.push(await checkAnalysis(step, steps, goal));
    }
    const meaningful = standalone.filter((check) => !NON_MEANINGFUL.has(check.explanation));
    const failed = meaningful.filter((check) => !check.passed);
    const passed = meaningful.length > 0 && failed.length === 0;
    return {
      passed,
      uncertain: !passed,
      explanation: passed
        ? "Standalone provider-backed answer verified; no tools required."
        : failed.map((check) => check.explanation).join(" ") || "No executable steps were verified. A model saying done is not evidence.",
      checks: meaningful,
    };
  }
  const checks = [];
  for (const step of executable) {
    checks.push(await checkToolOutput(step, goal));
    checks.push(await checkWorkspaceWrite(step));
    checks.push(await checkCalc(step, goal));
  }
  for (const step of steps) {
    checks.push(await checkAnalysis(step, steps, goal));
  }
  const failed = checks.filter((check) => !check.passed && !NON_MEANINGFUL.has(check.explanation));
  const meaningful = checks.filter((check) => !NON_MEANINGFUL.has(check.explanation));
  const passed = meaningful.length > 0 && failed.length === 0;
  return {
    passed,
    uncertain: !passed && meaningful.some((check) => check.passed),
    explanation: passed
      ? "All inspectable checks passed against actual outputs."
      : failed.map((check) => check.explanation).join(" "),
    checks: meaningful,
  };
}
