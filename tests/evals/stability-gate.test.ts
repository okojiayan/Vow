/* Stability-gate, checkpoint, and outdir machinery for the frozen benchmark.
 * All transport is mocked (local HTTP server + spawned gate script against
 * 127.0.0.1). No live inference is issued from these tests. */
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  GATE_MIN_CHATS,
  evaluateStabilityGate,
  isGateFresh,
  assertBenchOutdir,
  validateRunRecord,
  mergeSavedRuns,
  pairResults,
} from "./bench-protocol";

const LIVE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function gateFixture(overrides: Record<string, unknown> = {}) {
  const chats = [0, 1, 2].map((k) => ({
    name: `chat${k}`,
    attempts: [{ status: 200, model: LIVE_MODEL, usage: { prompt_tokens: 6, completion_tokens: 10 } }],
    status: 200,
    model: LIVE_MODEL,
    usage: { prompt_tokens: 6, completion_tokens: 10 },
    ok: true,
  }));
  return {
    passed: true,
    liveModel: LIVE_MODEL,
    checks: [
      {
        name: "models",
        attempts: [{ status: 200, count: 59, containsLiveModel: true }],
        status: 200,
        count: 59,
        containsLiveModel: true,
        ok: true,
      },
      ...chats,
    ],
    ...overrides,
  };
}

describe("stability-gate evaluation (mocked records)", () => {
  it("passes a healthy gate with three identity-matched probes", () => {
    expect(GATE_MIN_CHATS).toBe(3);
    const v = evaluateStabilityGate(gateFixture(), LIVE_MODEL);
    expect(v.passed).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("rejects a gate with only two probes (stale pre-policy shape)", () => {
    const g = gateFixture();
    g.checks = g.checks.slice(0, 3); // models + chat0 + chat1
    const v = evaluateStabilityGate(g, LIVE_MODEL);
    expect(v.passed).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/only 2 successful/);
  });

  it("rejects wrong model identity in one probe", () => {
    const g = gateFixture();
    (g.checks[2] as { model: string }).model = "other/model";
    const v = evaluateStabilityGate(g, LIVE_MODEL);
    expect(v.passed).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/other\/model/);
  });

  it("rejects an empty model listing", () => {
    const g = gateFixture({ checks: [
      { name: "models", attempts: [{ status: 200, count: 0, containsLiveModel: false }], status: 200, count: 0, containsLiveModel: false, ok: false },
    ] });
    const v = evaluateStabilityGate(g, LIVE_MODEL);
    expect(v.passed).toBe(false);
  });

  it("rejects repeated 502/503 model-listing responses", () => {
    const g = gateFixture({ checks: [
      { name: "models", attempts: [{ status: 502 }, { status: 503 }], status: 503, count: 0, containsLiveModel: false, ok: false },
      { name: "chats-skipped", attempts: [], skipped: true, ok: false },
    ] });
    const v = evaluateStabilityGate(g, LIVE_MODEL);
    expect(v.passed).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/503/);
  });

  it("rejects a gate for a different model and a self-reported failure", () => {
    expect(evaluateStabilityGate(gateFixture({ liveModel: "other/model" }), LIVE_MODEL).passed).toBe(false);
    expect(evaluateStabilityGate(gateFixture({ passed: false }), LIVE_MODEL).passed).toBe(false);
    expect(evaluateStabilityGate(null, LIVE_MODEL).passed).toBe(false);
  });
});

describe("gate freshness and outdir guard (mocked files)", () => {
  it("requires the gate to be newer than existing runs/breaker records", () => {
    expect(isGateFresh(2000, 1000)).toBe(true);
    expect(isGateFresh(1000, 2000)).toBe(false);
    expect(isGateFresh(1000, 1000)).toBe(false);
    expect(isGateFresh(1000, null)).toBe(true);
    expect(isGateFresh(NaN, 1000)).toBe(false);
  });

  it("refuses frozen snapshot dirs and allows fresh post-fix dirs", () => {
    for (const d of [
      "tests/evals/reports/nemotron-vs-full-100-baseline-v1.0",
      "tests/evals/reports/nemotron-vs-full-100-storm-20261024",
      "tests/evals/reports/nemotron-vs-full-100-interim-flap",
      "tests/evals/reports/holdout-20",
    ]) {
      expect(() => assertBenchOutdir(d)).toThrow(/frozen snapshot/);
    }
    expect(() => assertBenchOutdir("tests/evals/reports/nemotron-vs-full-100-postfix")).not.toThrow();
    expect(() => assertBenchOutdir("tests/evals/reports/nemotron-vs-full-100-postfix-v2")).not.toThrow();
    process.env.BENCH_ALLOW_FROZEN_OUTDIR = "1";
    try {
      expect(() => assertBenchOutdir("tests/evals/reports/nemotron-vs-full-100-storm-20261024")).not.toThrow();
    } finally {
      delete process.env.BENCH_ALLOW_FROZEN_OUTDIR;
    }
  });

  it("models the breaker-interlock mtime rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-gate-"));
    writeFileSync(join(dir, "circuit-breaker.json"), JSON.stringify({ tripped: true }));
    const older = Date.now() - 5000;
    writeFileSync(join(dir, "gate.json"), JSON.stringify(gateFixture()));
    utimesSync(join(dir, "gate.json"), new Date(older), new Date(older));
    const gate = JSON.parse(readFileSync(join(dir, "gate.json"), "utf8"));
    expect(evaluateStabilityGate(gate, LIVE_MODEL).passed).toBe(true);
    expect(isGateFresh(older, Date.now())).toBe(false);
    const now = Date.now() + 1000;
    utimesSync(join(dir, "gate.json"), new Date(now), new Date(now));
    expect(isGateFresh(now, Date.now())).toBe(true);
  });
});

describe("checkpoint validation and resume merge (mocked records)", () => {
  const ids = new Set(["C01", "C02", "C03"]);
  const rec = (caseId: string, mode = "A", extra: Record<string, unknown> = {}) => ({
    runId: `${mode}-${caseId}`, caseId, mode, ok: true, pass: true, ...extra,
  });

  it("validates structural record shape before reuse", () => {
    expect(validateRunRecord(rec("C01"), "A", ids).valid).toBe(true);
    expect(validateRunRecord(rec("C99"), "A", ids).valid).toBe(false);
    expect(validateRunRecord(rec("C01", "B"), "A", ids).valid).toBe(false);
    expect(validateRunRecord({ ...rec("C01"), runId: "" }, "A", ids).valid).toBe(false);
    expect(validateRunRecord({ ...rec("C01"), ok: "yes" }, "A", ids).valid).toBe(false);
    expect(validateRunRecord(null, "A", ids).valid).toBe(false);
  });

  it("reuses valid completed records and quarantines the rest", () => {
    const saved = [
      rec("C01"),
      rec("C02", "B"), // off-mode for an A resume
      { runId: "A-XX", caseId: "C99", mode: "A", ok: true }, // foreign id
      rec("C01"), // duplicate
      { runId: "", caseId: "C03", mode: "A", ok: true }, // invalid shape
      rec("C03"),
    ];
    const { kept, quarantined } = mergeSavedRuns(saved, [{ id: "C01" }, { id: "C02" }, { id: "C03" }], "A", ids);
    expect(kept.map((r) => r.caseId)).toEqual(["C01", "C03"]);
    expect(quarantined).toHaveLength(4);
  });

  it("persists checkpoints to disk and recovers them", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-ckpt-"));
    const path = join(dir, "runs_A.json");
    writeFileSync(path, JSON.stringify([rec("C01"), rec("C02")], null, 1));
    const loaded = JSON.parse(readFileSync(path, "utf8")) as Parameters<typeof mergeSavedRuns>[0];
    const { kept } = mergeSavedRuns(loaded, [{ id: "C01" }, { id: "C02" }, { id: "C03" }], "A", ids);
    expect(kept).toHaveLength(2);
    // Interrupted batch: only the pending id still needs execution.
    const pending = [{ id: "C01" }, { id: "C02" }, { id: "C03" }].filter(
      (t) => !kept.some((k) => k.caseId === t.id),
    );
    expect(pending.map((t) => t.id)).toEqual(["C03"]);
  });
});

describe("matched pairing by test id (mocked runs)", () => {
  it("pairs only shared ids and counts wins/losses/ties", () => {
    const p = pairResults(
      [
        { caseId: "C01", pass: true },
        { caseId: "C02", pass: false },
        { caseId: "C03", pass: true },
      ],
      [
        { caseId: "C01", pass: false },
        { caseId: "C02", pass: false },
        { caseId: "C04", pass: true },
      ],
    );
    expect(p.matched).toEqual(["C01", "C02"]);
    expect(p.aWins).toBe(1);
    expect(p.bWins).toBe(0);
    expect(p.ties).toBe(1);
  });
});

// ---- Mocked-transport tests for the real gate script (child process) ----

type ServerMode = "ok" | "wrong-model" | "empty-list" | "models-502" | "slow-models";

function startMockNightshift(mode: ServerMode, liveModel: string) {
  const hits = { models: 0, chats: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((req, res) => {
    req.on("data", () => { /* drain */ });
    req.on("end", () => {
      if (req.url === "/v1/models" && req.method === "GET") {
        hits.models += 1;
        if (mode === "models-502") {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad gateway" }));
          return;
        }
        if (mode === "slow-models") {
          const t = setTimeout(() => {
            timers.delete(t);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ data: [{ id: liveModel }] }));
          }, 20000);
          timers.add(t);
          req.on("close", () => { clearTimeout(t); timers.delete(t); });
          return;
        }
        const data = mode === "empty-list" ? [] : [{ id: liveModel }, { id: "other/model" }];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data }));
        return;
      }
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        hits.chats += 1;
        const model = mode === "wrong-model" ? "other/model" : liveModel;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model, usage: { prompt_tokens: 6, completion_tokens: 10 }, choices: [{ message: { content: "ok" } }] }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  const close = () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    try { (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* ignore */ }
    server.close();
  };
  return { server, hits, close };
}

function runGateScript(outdir: string, port: number, extraArgs: string[] = [], extraEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve("scripts/bench-stability-gate.mjs"), `--outdir=${outdir}`, ...extraArgs],
      {
        env: {
          ...process.env,
          METERLESS_BASE_URL: `http://127.0.0.1:${port}/v1`,
          METERLESS_API_KEY: "dummy-gate-test-key",
          METERLESS_MODEL: LIVE_MODEL,
          METERLESS_TIMEOUT_MS: "30000",
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 99, stdout: `${stdout}${stderr}` }));
  });
}

async function withMockServer(mode: ServerMode) {
  const { server, hits, close } = startMockNightshift(mode, LIVE_MODEL);
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const port = (server.address() as { port: number }).port;
  const outdir = mkdtempSync(join(tmpdir(), "bench-gate-live-"));
  try {
    return { outdir, port, hits, close };
  } catch (e) {
    server.close();
    throw e;
  }
}

describe("gate script against mocked Nightshift transport", () => {
  it("passes with three consecutive identity-matched probes", async () => {
    const ctx = await withMockServer("ok");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=15000", "--retries=0"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/GATE passed=true/);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(true);
      expect(gate.liveModel).toBe(LIVE_MODEL);
      const chatOks = gate.checks.filter((c: { name: string; ok: boolean }) => c.name.startsWith("chat") && c.ok);
      expect(chatOks).toHaveLength(3);
      expect(ctx.hits.chats).toBe(3);
      expect(r.stdout).not.toMatch(/dummy-gate-test-key/);
    } finally {
      ctx.close();
    }
  }, 30000);

  it("honors --chats=1 for scheduled light gates (floor is 1, default stays 3)", async () => {
    const ctx = await withMockServer("ok");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=1", "--timeout-ms=15000", "--retries=0"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/GATE passed=true/);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(true);
      expect(gate.minChats).toBe(1);
      expect(ctx.hits.chats).toBe(1);
      const dflt = await runGateScript(ctx.outdir, ctx.port, ["--chats=0", "--timeout-ms=15000", "--retries=0"]);
      expect(dflt.code).toBe(0);
    } finally {
      ctx.close();
    }
  }, 30000);

  it("fails fast on repeated 502s without burning inference", async () => {
    const ctx = await withMockServer("models-502");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=15000", "--retries=1", "--retry-ms=100"]);
      expect(r.code).toBe(1);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(false);
      expect(ctx.hits.chats).toBe(0);
      expect(gate.checks.some((c: { name: string }) => c.name === "chats-skipped")).toBe(true);
    } finally {
      ctx.close();
    }
  }, 30000);

  it("fails on wrong model identity", async () => {
    const ctx = await withMockServer("wrong-model");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=15000", "--retries=0"]);
      expect(r.code).toBe(1);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(false);
    } finally {
      ctx.close();
    }
  }, 30000);

  it("fails on empty model listings", async () => {
    const ctx = await withMockServer("empty-list");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=15000", "--retries=0"]);
      expect(r.code).toBe(1);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(false);
    } finally {
      ctx.close();
    }
  }, 30000);

  it("derives the gate budget from BENCH_MODEL_TIMEOUT_MS and records the policy", async () => {
    const ctx = await withMockServer("ok");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--retries=0"], { BENCH_MODEL_TIMEOUT_MS: "15000" });
      expect(r.code).toBe(0);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(true);
      expect(gate.timeoutMs).toBe(15_000);
      expect(gate.timeoutPolicy).toEqual({ modelCallTimeoutMs: 15_000, taskDeadlineMs: 300_000 });
    } finally {
      ctx.close();
    }
  }, 30000);

  it("rejects invalid timeout configuration instead of silently coercing", async () => {
    const ctx = await withMockServer("ok");
    try {
      const badEnv = await runGateScript(ctx.outdir, ctx.port, ["--chats=3"], { BENCH_MODEL_TIMEOUT_MS: "junk" });
      expect(badEnv.code).toBe(2);
      expect(badEnv.stdout).toMatch(/invalid BENCH_MODEL_TIMEOUT_MS/);
      const badFlag = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=5000"]);
      expect(badFlag.code).toBe(2);
      expect(badFlag.stdout).toMatch(/invalid BENCH_MODEL_TIMEOUT_MS/);
      const badDeadline = await runGateScript(
        ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=60000"], { BENCH_TASK_DEADLINE_MS: "120000" },
      );
      expect(badDeadline.code).toBe(2);
      expect(badDeadline.stdout).toMatch(/Contradictory|contradictory/);
    } finally {
      ctx.close();
    }
  }, 30000);

  it("fails closed on timeouts with bounded attempts recorded", async () => {
    const ctx = await withMockServer("slow-models");
    try {
      const r = await runGateScript(ctx.outdir, ctx.port, ["--chats=3", "--timeout-ms=15000", "--retries=0"]);
      expect(r.code).toBe(1);
      const gate = JSON.parse(readFileSync(join(ctx.outdir, "gate.json"), "utf8"));
      expect(gate.passed).toBe(false);
      expect(gate.checks[0].attempts).toHaveLength(1);
      expect(ctx.hits.chats).toBe(0);
    } finally {
      ctx.close();
    }
  }, 30000);
});
