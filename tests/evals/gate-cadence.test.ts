/* Gate-cadence amendment: scheduled full vs light readiness gates.
 * All fixtures are in-memory or under tmpdirs; gate-script checks run
 * against a loopback mock server only. No provider calls. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  GATE_FULL_CHATS,
  GATE_LIGHT_CHATS,
  evaluateStabilityGate,
  mergeSavedRuns,
  priorBatchInfraHit,
  requiredGateChats,
  stampRunIdentity,
} from "./bench-protocol";

const LIVE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function gateFixture(chatCount: number, model: string = LIVE_MODEL) {
  const chats = Array.from({ length: chatCount }, (_, k) => ({
    name: `chat${k}`,
    attempts: [{ status: 200, model, usage: { prompt_tokens: 6, completion_tokens: 10 } }],
    status: 200,
    model,
    usage: { prompt_tokens: 6, completion_tokens: 10 },
    ok: true,
  }));
  return {
    passed: true,
    liveModel: model,
    minChats: chatCount,
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
  };
}

describe("gate-cadence schedule (pure policy)", () => {
  it("keeps full-gate depth at the documented default", () => {
    expect(GATE_FULL_CHATS).toBe(3);
    expect(GATE_LIGHT_CHATS).toBe(1);
  });

  it("requires a full gate at tier transitions", () => {
    const d = requiredGateChats({ batchIndex: 0, freshTier: true, priorInfraFailure: false, forceFull: false });
    expect(d.chats).toBe(3);
    expect(d.reasons.join(" ")).toMatch(/tier-transition/);
  });

  it("requires a full gate after a prior-batch infrastructure failure", () => {
    const d = requiredGateChats({ batchIndex: 1, freshTier: false, priorInfraFailure: true, forceFull: false });
    expect(d.chats).toBe(3);
    expect(d.reasons.join(" ")).toMatch(/infrastructure/);
  });

  it("honors the operator full-gate override", () => {
    const d = requiredGateChats({ batchIndex: 1, freshTier: false, priorInfraFailure: false, forceFull: true });
    expect(d.chats).toBe(3);
  });

  it("alternates full gates on even indexes and light gates on odd ones", () => {
    expect(requiredGateChats({ batchIndex: 2, freshTier: false, priorInfraFailure: false, forceFull: false }).chats).toBe(3);
    const light = requiredGateChats({ batchIndex: 3, freshTier: false, priorInfraFailure: false, forceFull: false });
    expect(light.chats).toBe(1);
  });

  it("never weakens a full requirement into a light gate", () => {
    for (const input of [
      { batchIndex: 0, freshTier: true, priorInfraFailure: false, forceFull: false },
      { batchIndex: 5, freshTier: false, priorInfraFailure: true, forceFull: false },
      { batchIndex: 5, freshTier: false, priorInfraFailure: false, forceFull: true },
      { batchIndex: 4, freshTier: false, priorInfraFailure: false, forceFull: false },
    ]) {
      expect(requiredGateChats(input).chats).toBe(3);
    }
  });
});

describe("prior-batch infrastructure scan (pure)", () => {
  const ids = ["S27", "S28"];

  it("flags unrecovered ok=false records in scope", () => {
    expect(priorBatchInfraHit([{ caseId: "S27", ok: false, error: "Meterless timed out after 120000ms." }], ids)).toBe(true);
  });

  it("flags recovered retries whose first error was infrastructural", () => {
    expect(
      priorBatchInfraHit([{ caseId: "S27", ok: true, retried: true, firstError: "Unknown task" }], ids),
    ).toBe(true);
    expect(
      priorBatchInfraHit([{ caseId: "S27", ok: true, retried: true, firstError: "Meterless timed out after 120000ms." }], ids),
    ).toBe(true);
  });

  it("ignores completed task failures, out-of-scope cases and clean records", () => {
    expect(priorBatchInfraHit([{ caseId: "S27", ok: true, pass: false }], ids)).toBe(false);
    expect(priorBatchInfraHit([{ caseId: "S99", ok: false }], ids)).toBe(false);
    expect(priorBatchInfraHit([{ caseId: "S27", ok: true, pass: true }], ids)).toBe(false);
    expect(priorBatchInfraHit([], ids)).toBe(false);
  });

  it("treats any recorded retry as a prior failure (conservative)", () => {
    // The retry pass only retries cases whose first attempt failed to produce
    // a usable result, so any retried record forces a full gate even if the
    // surviving first-error text is unclassified.
    expect(priorBatchInfraHit([{ caseId: "S27", ok: true, retried: true, firstError: "answer mismatch" }], ids)).toBe(true);
  });
});

describe("gate-depth enforcement (mocked records)", () => {
  it("accepts a 1-chat light gate only when light depth is required", () => {
    const light = gateFixture(1);
    expect(evaluateStabilityGate(light, LIVE_MODEL, 1).passed).toBe(true);
    expect(evaluateStabilityGate(light, LIVE_MODEL).passed).toBe(false);
  });

  it("still requires the models listing and identity match for light gates", () => {
    const noChats = gateFixture(0);
    expect(evaluateStabilityGate(noChats, LIVE_MODEL, 1).passed).toBe(false);
    const wrongModel = gateFixture(1, "other/model");
    expect(evaluateStabilityGate(wrongModel, LIVE_MODEL, 1).passed).toBe(false);
  });

  it("keeps enforcing three probes for full gates", () => {
    expect(evaluateStabilityGate(gateFixture(3), LIVE_MODEL, 3).passed).toBe(true);
    expect(evaluateStabilityGate(gateFixture(2), LIVE_MODEL, 3).passed).toBe(false);
  });
});

describe("batch-boundary checkpoint and resume (mocked files)", () => {
  it("retains run identity across batches and skips completed cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-cadence-resume-"));
    const fsDeps = { existsSync, readFileSync, writeFileSync, mkdirSync };
    const id0 = stampRunIdentity(
      dir,
      { manifestVersion: "2.0.0", batchIndex: 0, batchSize: 10, runId: "run-first" },
      fsDeps,
    );
    expect(id0.runId).toBe("run-first");
    // Batch 0 completes durably, then the next batch process starts fresh.
    writeFileSync(
      join(dir, "runs_A.json"),
      JSON.stringify([{ runId: "run-first", caseId: "C01", mode: "A", ok: true, pass: true }]),
    );
    const id1 = stampRunIdentity(
      dir,
      { manifestVersion: "2.0.0", batchIndex: 1, batchSize: 10, runId: "run-second" },
      fsDeps,
    );
    expect(id1.runId).toBe("run-first");
    expect(id1.batches.map((b) => b.batchIndex)).toEqual([0, 1]);
    const saved = JSON.parse(readFileSync(join(dir, "runs_A.json"), "utf8")) as Parameters<typeof mergeSavedRuns>[0];
    const { kept } = mergeSavedRuns(saved, [{ id: "C01" }, { id: "C02" }], "A", new Set(["C01", "C02"]));
    expect(kept.map((r) => r.caseId)).toEqual(["C01"]);
    const pending = [{ id: "C01" }, { id: "C02" }].filter((t) => !kept.some((k) => k.caseId === t.id));
    expect(pending.map((t) => t.id)).toEqual(["C02"]);
  });
});

function startMockNightshift() {
  const hits = { models: 0, chats: 0 };
  const server = createServer((req, res) => {
    req.on("data", () => { /* drain */ });
    req.on("end", () => {
      if (req.url === "/v1/models" && req.method === "GET") {
        hits.models += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: LIVE_MODEL }] }));
        return;
      }
      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        hits.chats += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ model: LIVE_MODEL, usage: { prompt_tokens: 6, completion_tokens: 10 }, choices: [{ message: { content: "ok" } }] }),
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });
  return { server, hits };
}

function runGateScript(outdir: string, port: number, extraArgs: string[]): Promise<{ code: number; stdout: string }> {
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
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { out += String(d); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 99, stdout: out }));
  });
}

describe("gate script light depth against mocked transport", () => {
  it("records an honest 1-chat light gate; --chats=0 falls back to the default", async () => {
    const { server, hits } = startMockNightshift();
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    const port = (server.address() as { port: number }).port;
    try {
      const outdir = mkdtempSync(join(tmpdir(), "bench-gate-light-"));
      const r = await runGateScript(outdir, port, ["--chats=1", "--timeout-ms=15000"]);
      expect(r.code).toBe(0);
      const g = JSON.parse(readFileSync(join(outdir, "gate.json"), "utf8")) as {
        passed: boolean; minChats: number; checks: { name: string; ok: boolean }[];
      };
      expect(g.passed).toBe(true);
      expect(g.minChats).toBe(1);
      expect(g.checks.filter((c) => c.name.startsWith("chat") && c.ok === true)).toHaveLength(1);
      expect(evaluateStabilityGate(g as Parameters<typeof evaluateStabilityGate>[0], LIVE_MODEL, 1).passed).toBe(true);
      // Falsy --chats values keep the pre-existing default fallback (3),
      // never a silent 0-chat gate: the recorded minChats always states depth.
      const outdir0 = mkdtempSync(join(tmpdir(), "bench-gate-floor-"));
      const before = hits.chats;
      const r0 = await runGateScript(outdir0, port, ["--chats=0", "--timeout-ms=15000"]);
      expect(r0.code).toBe(0);
      const g0 = JSON.parse(readFileSync(join(outdir0, "gate.json"), "utf8")) as { minChats: number };
      expect(g0.minChats).toBe(3);
      expect(hits.chats - before).toBe(3);
    } finally {
      server.close();
    }
  }, 60000);
});
