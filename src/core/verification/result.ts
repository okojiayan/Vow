export interface CheckResult {
  name: string;
  passed: boolean;
  explanation: string;
  evidence?: unknown;
}

export interface VerificationResult {
  passed: boolean;
  uncertain: boolean;
  explanation: string;
  checks: CheckResult[];
}
