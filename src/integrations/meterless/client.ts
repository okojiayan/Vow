import { getEnv, hasMeterlessKey } from "@/lib/env";
import type { ChatMessage, ChatCompletionResponse, MeterlessResult } from "./types";

function extractText(payload: ChatCompletionResponse): string | null {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  return null;
}

export async function completeChat(messages: ChatMessage[]): Promise<MeterlessResult> {
  const env = getEnv();
  if (!hasMeterlessKey()) {
    return {
      ok: false,
      code: "not_configured",
      error:
        "Meterless is not configured. Set METERLESS_API_KEY on the server. Demo mode can still run heuristic plans.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.METERLESS_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.METERLESS_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.METERLESS_API_KEY}`,
        "meterless-app": "vow-open-agent-hackathon",
        "meterless-scope": "user",
      },
      body: JSON.stringify({
        model: env.METERLESS_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const hint = body.trim() ? ` Body: ${body.trim().slice(0, 200)}` : "";
      return {
        ok: false,
        code: response.status >= 500 ? "unavailable" : "invalid_response",
        httpStatus: response.status,
        error: `Meterless returned HTTP ${response.status}.${hint}`,
      };
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const text = extractText(payload);
    if (!text) {
      return {
        ok: false,
        code: "invalid_response",
        error:
          "Meterless returned HTTP 200 but no assistant text. VOW does not treat an empty completion as success.",
      };
    }
    return {
      ok: true,
      text,
      model: payload.model ?? env.METERLESS_MODEL,
      usage: payload.usage,
      raw: payload,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      code: aborted ? "timeout" : "unavailable",
      error: aborted
        ? `Meterless timed out after ${env.METERLESS_TIMEOUT_MS}ms.`
        : `Meterless is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeMeterless(
  timeoutMs?: number,
): Promise<{ reachable: boolean; detail: string; model: string }> {
  const env = getEnv();
  if (!hasMeterlessKey()) {
    return { reachable: false, detail: "API key not configured.", model: env.METERLESS_MODEL };
  }
  // Production default honors the configured Meterless timeout (pilot showed
  // 39-45s Nightshift latency, so a 4s ceiling would false-negative). The
  // benchmark passes an explicit BENCH_MODEL_TIMEOUT_MS so gate + preflight
  // share one bounded policy.
  const effectiveTimeout =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : env.METERLESS_TIMEOUT_MS;
  try {
    const response = await fetch(`${env.METERLESS_BASE_URL.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${env.METERLESS_API_KEY}`,
        "meterless-app": "vow-open-agent-hackathon",
      },
      signal: AbortSignal.timeout(effectiveTimeout),
    });
    return {
      reachable: response.ok,
      detail: response.ok ? "Meterless /models responded." : `HTTP ${response.status}`,
      model: env.METERLESS_MODEL,
    };
  } catch (error) {
    return {
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
      model: env.METERLESS_MODEL,
    };
  }
}
