import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("Meterless Nightshift client (OpenAI-compatible /chat/completions)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "test-meterless-key",
      METERLESS_MODEL: "nvidia/nemotron-3-ultra-550b-a55b",
      METERLESS_TIMEOUT_MS: "1000",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setEnv({ METERLESS_API_KEY: "", METERLESS_TIMEOUT_MS: undefined });
    vi.restoreAllMocks();
  });

  it("returns live-model text with model identity and usage on success", async () => {
    const { completeChat } = await import("@/integrations/meterless/client");
    const payload = {
      id: "chatcmpl-1",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      choices: [{ message: { role: "assistant", content: '{"summary":"plan"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await completeChat([{ role: "user", content: "hello" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.text).toBe('{"summary":"plan"}');
    expect(result.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(result.usage?.total_tokens).toBe(15);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8088/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-meterless-key");
    expect(headers["meterless-app"]).toBe("vow-open-agent-hackathon");
    expect(headers["meterless-scope"]).toBe("user");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(1200);
  });

  it("falls back to the configured model when the provider omits it", async () => {
    const { completeChat } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await completeChat([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });

  it("returns not_configured without calling fetch", async () => {
    setEnv({ METERLESS_API_KEY: "" });
    const { completeChat } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await completeChat([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_configured");
      expect(result.error).toMatch(/not configured/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 4xx to invalid_response and 5xx to unavailable", async () => {
    const { completeChat } = await import("@/integrations/meterless/client");
    for (const [status, code] of [[400, "invalid_response"], [401, "invalid_response"], [500, "unavailable"], [503, "unavailable"]] as const) {
      const fetchMock = vi.fn(async () => new Response("err", { status }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const result = await completeChat([{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it("treats HTTP 200 with no assistant text as invalid_response", async () => {
    const { completeChat } = await import("@/integrations/meterless/client");
    for (const payload of [
      { choices: [] },
      { choices: [{ message: { content: "   " } }] },
      { choices: [{ message: { content: null } }] },
      {},
    ]) {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const result = await completeChat([{ role: "user", content: "hi" }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_response");
    }
  });

  it("returns timeout when the request aborts", async () => {
    setEnv({ METERLESS_TIMEOUT_MS: "20" });
    const { completeChat } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            },
            { once: true },
          );
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await completeChat([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("timeout");
  });

  it("returns unavailable on network failure without leaking the key", async () => {
    const { completeChat } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await completeChat([{ role: "user", content: "hi" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unavailable");
      expect(result.error).not.toContain("test-meterless-key");
    }
  });

  it("probeMeterless reports not-configured without fetch", async () => {
    setEnv({ METERLESS_API_KEY: "" });
    const { probeMeterless } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const probe = await probeMeterless();
    expect(probe.reachable).toBe(false);
    expect(probe.detail).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probeMeterless hits GET /models and reports reachable", async () => {
    const { probeMeterless } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const probe = await probeMeterless();
    expect(probe.reachable).toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8088/v1/models");
  });

  it("probeMeterless reports unreachable on network failure", async () => {
    const { probeMeterless } = await import("@/integrations/meterless/client");
    const fetchMock = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const probe = await probeMeterless();
    expect(probe.reachable).toBe(false);
    expect(probe.detail).not.toContain("test-meterless-key");
  });
});
