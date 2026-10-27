export interface ZetarisConfig {
  baseUrl: string;
  apiKeyConfigured: boolean;
  orgId: string;
}

export interface ZetarisStatus {
  enabled: boolean;
  reason: string;
  required: string[];
}

export interface ZetarisQueryResult {
  sql: string;
  rows: unknown[][];
  rowCount: number;
  requestId: string;
}
