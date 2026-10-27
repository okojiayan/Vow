import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

const VALID_SQL =
  "SELECT ability_name, is_hidden FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu' ORDER BY ability_name LIMIT 10";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("runReadOnlyZetarisQuery client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    setEnv({
      ZETARIS_REST_URL: "http://localhost:8888/api/v1.0",
      ZETARIS_ORG_ID: "1",
      ZETARIS_API_KEY: "test-key",
      ZETARIS_TIMEOUT_MS: "1000",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setEnv({
      ZETARIS_API_KEY: "",
      ZETARIS_TIMEOUT_MS: undefined,
    });
    vi.restoreAllMocks();
  });

  it("posts to /sql-editor/sqls/run and returns rows with request id", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ data: [["static", true], ["lightning-rod", false]] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await runReadOnlyZetarisQuery(VALID_SQL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8888/api/v1.0/sql-editor/sqls/run");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["X-Org-ID"]).toBe("1");
    expect(typeof headers["X-Request-ID"]).toBe("string");
    const body = JSON.parse(String(init.body));
    expect(body.sql).toContain("pokeapi.pikachu_abilities_table");
    expect(body.source).toBe("SqlEditor");
    expect(body.limit).toBe(100);
    expect(typeof body.queryId).toBe("string");
    expect(result.rows).toEqual([["static", true], ["lightning-rod", false]]);
    expect(result.rowCount).toBe(2);
    expect(typeof result.requestId).toBe("string");
    expect(headers["X-Request-ID"]).toBe(result.requestId);
  });

  it("appends LIMIT 100 when the policy adds a default limit", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const noLimit = "SELECT ability_name FROM pokeapi.pikachu_abilities_table";
    const result = await runReadOnlyZetarisQuery(noLimit);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.sql).toMatch(/LIMIT 100/i);
    expect(result.sql).toMatch(/LIMIT 100/i);
  });

  it("slices responses to MAX_ROWS=100", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const big = Array.from({ length: 150 }, (_, i) => [`ability-${i}`, false]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: big }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await runReadOnlyZetarisQuery(VALID_SQL);
    expect(result.rows).toHaveLength(100);
    expect(result.rowCount).toBe(100);
  });

  it("throws when the API key is missing", async () => {
    setEnv({ ZETARIS_API_KEY: "" });
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    await expect(runReadOnlyZetarisQuery(VALID_SQL)).rejects.toThrow(/API key is not configured/i);
  });

  it("rejects invalid SQL before any network call", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(runReadOnlyZetarisQuery("DROP TABLE pokeapi.pikachu_abilities_table")).rejects.toThrow();
    await expect(runReadOnlyZetarisQuery("SELECT * FROM secret_table")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces non-2xx status codes", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(runReadOnlyZetarisQuery(VALID_SQL)).rejects.toThrow(/HTTP 403/);
  });

  it("rejects malformed payloads that lack data[][]", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    for (const payload of [{}, { data: "oops" }, { data: [{ not: "array" }] }, null]) {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
      globalThis.fetch = fetchMock;
      await expect(runReadOnlyZetarisQuery(VALID_SQL)).rejects.toThrow(/unexpected response format/i);
    }
  });

  it("reports a timeout when the abort controller fires", async () => {
    setEnv({ ZETARIS_TIMEOUT_MS: "20" });
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            const e = new DOMException("aborted", "AbortError");
            reject(e);
            return;
          }
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(runReadOnlyZetarisQuery(VALID_SQL)).rejects.toThrow(/timed out/i);
  });

  it("reports unreachable hosts without leaking the key", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    let err: Error | null = null;
    try {
      await runReadOnlyZetarisQuery(VALID_SQL);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err?.message ?? "").toMatch(/Could not reach Zetaris/i);
    expect(err?.message ?? "").not.toContain("test-key");
  });
});
