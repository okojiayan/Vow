/* Offline regression test for the gate body-read abort scope.
 * A stub provider sends headers immediately but stalls the body; the gate
 * must fail boundedly near its --timeout-ms budget instead of hanging.
 * No live providers, no credentials, no repo artifacts (tmp outdirs). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const gate = join(root, "scripts", "bench-stability-gate.mjs");

async function runGate(env: Record<string, string>, outdir: string, extra: string[]) {
  const started = Date.now();
  // Async spawn: the in-process stub server shares this event loop, so a
  // blocking spawnSync would starve it and invalidate the test.
  try {
    const r = await execFileAsync(
      process.execPath,
      [gate, `--outdir=${outdir}`, ...extra],
      { env: { ...process.env, ...env }, timeout: 90_000, encoding: "utf8" },
    );
    return { status: 0, stdout: r.stdout, stderr: r.stderr, wallMs: Date.now() - started };
  } catch (e) {
    const err = e as { code?: unknown; stdout?: string; stderr?: string };
    return {
      status: typeof err.code === "number" ? err.code : 99,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      wallMs: Date.now() - started,
    };
  }
}

describe("stability gate abort scope (offline stub)", () => {
  it("fails boundedly when the body stalls after fast headers", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Headers flush immediately; body never completes within budget.
    });
    const port = await listenLoopback(server);
    try {
      const outdir = mkdtempSync(join(tmpdir(), "gate-stall-"));
      const r = await runGate(
        {
          METERLESS_BASE_URL: `http://127.0.0.1:${port}`,
          METERLESS_API_KEY: "stub",
          METERLESS_MODEL: "stub-model",
        },
        outdir,
        ["--timeout-ms=15000", "--retries=0"],
      );
      // Budget 1.5s x (models only, chats skipped on models failure) + margin.
      expect(r.wallMs).toBeLessThan(45_000);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/passed=false/);
    } finally {
      server.close();
    }
  });

  it("still passes a healthy stub provider", async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/models") {
        res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
      } else {
        res.end(
          JSON.stringify({ model: "stub-model", usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        );
      }
    });
    const port = await listenLoopback(server);
    try {
      const outdir = mkdtempSync(join(tmpdir(), "gate-healthy-"));
      const r = await runGate(
        {
          METERLESS_BASE_URL: `http://127.0.0.1:${port}`,
          METERLESS_API_KEY: "stub",
          METERLESS_MODEL: "stub-model",
        },
        outdir,
        ["--timeout-ms=15000", "--retries=0", "--chats=3"],
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/passed=true/);
    } finally {
      server.close();
    }
  });
});
