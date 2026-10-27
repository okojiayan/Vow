import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

const LIVE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("GET /api/health (bounded liveness)", () => {
  const originalFetch = globalThis.fetch;
  let dataDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    dataDir = mkdtempSync(join(tmpdir(), "vow-health-"));
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "test-health-key",
      METERLESS_MODEL: LIVE_MODEL,
      // Deliberately long: proves the route does not honor this budget.
      METERLESS_TIMEOUT_MS: "90000",
      VOW_DATA_DIR: dataDir,
      ZETARIS_API_KEY: "",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setEnv({
      METERLESS_API_KEY: "",
      METERLESS_TIMEOUT_MS: undefined,
      VOW_DATA_DIR: undefined,
      ZETARIS_API_KEY: undefined,
    });
    vi.restoreAllMocks();
  });

  it("returns the settings-page shape with reachable true on fast provider", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: LIVE_MODEL }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      product: string;
      mode: string;
      demoMode: boolean;
      meterless: { configured: boolean; baseUrl: string; model: string; reachable: boolean; detail: string };
      zetaris: { enabled: boolean };
      recentAudit: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.product).toBe("VOW");
    expect(body.meterless.configured).toBe(true);
    expect(body.meterless.model).toBe(LIVE_MODEL);
    expect(body.meterless.reachable).toBe(true);
    expect(body.demoMode).toBe(false);
    expect(Array.isArray(body.recentAudit)).toBe(true);
  });

  it("degrades to reachable false when the provider fails, without throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meterless: { reachable: boolean; detail: string };
      demoMode: boolean;
      recentAudit: unknown[];
    };
    expect(body.meterless.reachable).toBe(false);
    expect(body.demoMode).toBe(true);
    expect(Array.isArray(body.recentAudit)).toBe(true);
  });

  it("skips fetch entirely without an API key", async () => {
    setEnv({ METERLESS_API_KEY: "" });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = (await res.json()) as { meterless: { reachable: boolean } };
    expect(body.meterless.reachable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds a hanging provider to the short health timeout, not the 90s budget", async () => {
    globalThis.fetch = ((async (_url: string, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
      throw new Error("unreachable");
    }) as unknown) as typeof fetch;
    const { GET } = await import("@/app/api/health/route");
    const start = Date.now();
    const res = await GET();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meterless: { reachable: boolean } };
    expect(body.meterless.reachable).toBe(false);
    // Health budget is 3s; the 90s production budget must not apply.
    expect(elapsed).toBeLessThan(15000);
  }, 20000);
});
