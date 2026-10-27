import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { evaluateCalcExpression } from "@/core/execution/calc";

function setEnv(o: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("godfather hardening", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "test-key",
      METERLESS_MODEL: "nvidia/nemotron-3-ultra-550b-a55b",
      METERLESS_TIMEOUT_MS: "1000",
      ZETARIS_REST_URL: "http://localhost:8888/api/v1.0",
      ZETARIS_ORG_ID: "1",
      ZETARIS_API_KEY: "test-key",
      ZETARIS_TIMEOUT_MS: "1000",
      VOW_WORKSPACE_DIR: "/tmp/vow-test-workspace",
      VOW_DATA_DIR: "/tmp/vow-test-data",
    });
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("calc rejects non-finite power and gcd(0,0)", async () => {
    await expect(async () => evaluateCalcExpression("10^1000")).rejects.toThrow();
    await expect(async () => evaluateCalcExpression("gcd(0,0)")).rejects.toThrow(/gcd.*undefined|invalid-arguments/i);
    const ok = evaluateCalcExpression("2^3^2");
    expect(ok.result).toBe(512);
  });

  it("meterless 4xx error includes truncated body hint", async () => {
    const { completeChat } = await import("@/integrations/meterless/client");
    globalThis.fetch = (async () => new Response("bad request detail", { status: 400 })) as unknown as typeof fetch;
    const r = await completeChat([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("invalid_response");
      expect(r.error).toMatch(/400/);
      expect(r.error).toMatch(/bad request detail/);
    }
  });

  it("zetaris non-2xx includes body and malformed includes keys", async () => {
    const { runReadOnlyZetarisQuery } = await import("@/integrations/zetaris/client");
    const VALID = "SELECT ability_name FROM pokeapi.pikachu_abilities_table WHERE pokemon_name = 'pikachu'";
    globalThis.fetch = (async () => new Response("forbidden-zone", { status: 403 })) as unknown as typeof fetch;
    await expect(runReadOnlyZetarisQuery(VALID)).rejects.toThrow(/403.*forbidden-zone/s);
    globalThis.fetch = (async () => new Response(JSON.stringify({ unexpected: 1 }), { status: 200 })) as unknown as typeof fetch;
    await expect(runReadOnlyZetarisQuery(VALID)).rejects.toThrow(/unexpected.*keys: unexpected/s);
  });

  it("notes.create never overwrites on slug collision", async () => {
    const { registerBuiltinTools } = await import("@/core/execution/builtin-tools");
    const { getTool } = await import("@/core/execution/tool-registry");
    const { mkdir, rm, readFile } = await import("node:fs/promises");
    const dir = "/tmp/vow-test-workspace";
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    registerBuiltinTools();
    const tool = getTool("notes.create")!;
    const a = (await tool.handler({ title: "Same Title", body: "first" })) as { path: string };
    const b = (await tool.handler({ title: "Same Title", body: "second" })) as { path: string };
    expect(a.path).not.toBe(b.path);
    const { join } = await import("node:path");
    const ca = await readFile(join(dir, a.path), "utf8");
    const cb = await readFile(join(dir, b.path), "utf8");
    expect(ca).toMatch(/first/);
    expect(cb).toMatch(/second/);
    await rm(dir, { recursive: true, force: true });
  });
});
