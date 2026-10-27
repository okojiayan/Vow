import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { validateReadOnlyZetarisSql } from "./sql-policy";
import type { ZetarisQueryResult, ZetarisStatus } from "./types";

const MAX_ROWS = 100;

export function getZetarisStatus(): ZetarisStatus {
  const env = getEnv();
  const required: string[] = [];

  if (!env.ZETARIS_REST_URL.trim()) required.push("ZETARIS_REST_URL");
  if (!env.ZETARIS_ORG_ID.trim()) required.push("ZETARIS_ORG_ID");
  if (!env.ZETARIS_API_KEY.trim()) required.push("ZETARIS_API_KEY");

  const enabled = required.length === 0;

  return {
    enabled,
    reason: enabled
      ? "Zetaris credentials are configured; read-only SQL remains restricted."
      : "Zetaris is not configured. Required server-side settings are missing.",
    required,
  };
}

export async function runReadOnlyZetarisQuery(
  input: unknown,
): Promise<ZetarisQueryResult> {
  // Validate again inside the client, even though Warden validates first.
  const validation = validateReadOnlyZetarisSql(input);
  if (!validation.ok) throw new Error(validation.reason);

  const env = getEnv();
  if (!env.ZETARIS_API_KEY.trim()) {
    throw new Error("Zetaris API key is not configured on the server.");
  }

  const requestId = randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    env.ZETARIS_TIMEOUT_MS,
  );

  let response: Response;

  try {
    response = await fetch(
      `${env.ZETARIS_REST_URL.replace(/\/+$/, "")}/sql-editor/sqls/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.ZETARIS_API_KEY}`,
          "Content-Type": "application/json",
          "X-Org-ID": env.ZETARIS_ORG_ID,
          "X-Request-ID": requestId,
        },
        body: JSON.stringify({
          queryId: randomUUID(),
          sql: validation.sql,
          source: "SqlEditor",
          limit: MAX_ROWS,
        }),
        signal: controller.signal,
      },
    );
  } catch {
    if (controller.signal.aborted) {
      throw new Error("Zetaris query timed out.");
    }
    throw new Error(
      "Could not reach Zetaris. Check that its local REST API is running.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const hint = body.trim() ? ` Body: ${body.trim().slice(0, 200)}` : "";
    throw new Error(`Zetaris REST API returned HTTP ${response.status}.${hint}`);
  }

  const rawText = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as unknown) : null;
  } catch {
    payload = null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray(payload.data) ||
    !payload.data.every((row) => Array.isArray(row))
  ) {
    const keys =
      typeof payload === "object" && payload !== null ? Object.keys(payload).slice(0, 8).join(",") : "non-object";
    throw new Error(
      `Zetaris returned an unexpected response format (keys: ${keys}; preview: ${rawText.slice(0, 200)}).`,
    );
  }

  const rows = (payload.data as unknown[][]).slice(0, MAX_ROWS);

  return {
    sql: validation.sql,
    rows,
    rowCount: rows.length,
    requestId,
  };
}
