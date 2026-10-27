// Stability gate for the live benchmark. Exits 0 only when the authenticated
// model listing contains the intended model AND a consecutive sequence of
// minimal inference requests all succeed with matching model identity.
// Writes gate.json into --outdir. Never prints secrets or authorization values.
//
// Policy: full gates use at least 3 consecutive chat probes (default
// --chats=3); scheduled light gates under the documented gate-cadence
// amendment may use --chats=1 (floor is 1, default stays 3). Each check
// gets a small bounded retry budget (--retries, default 1) with a fixed
// backoff; if the model listing fails after retries, chats are skipped
// entirely (fail-fast: no point burning inference against an unhealthy
// service, and no hammering).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of (() => { try { return readFileSync(resolve(root, ".env"), "utf8"); } catch { return ""; } })().split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"];
  }),
);
const outdir = args.outdir;
if (!outdir) {
  console.error("usage: node scripts/bench-stability-gate.mjs --outdir=<results-dir> [--chats=3] [--timeout-ms=60000|BENCH_MODEL_TIMEOUT_MS] [--retries=1] [--retry-ms=1500] (timeout 15000..120000ms)");
  process.exit(2);
}
// Full policy gates require three consecutive successful inference probes;
// scheduled light gates under the documented gate-cadence amendment may
// request a single probe (--chats=1). Values below 1 are raised to the floor
// rather than silently accepted; the recorded minChats always states the
// depth that actually ran, and the harness enforces the scheduled depth.
const chats = Math.max(1, parseInt(args.chats ?? "3", 10) || 3);
// One explicit per-model-request budget shared by gate, preflight and both
// benchmark modes. Precedence: --timeout-ms flag, then BENCH_MODEL_TIMEOUT_MS
// env, then the 60s default. Out-of-range or non-numeric values are rejected
// (exit 2) instead of silently coerced, so the gate can never pass on a
// budget the benchmark would not honor.
function resolvePolicyMs(raw, name, dflt, lo, hi) {
  const src = raw ?? process.env[name] ?? String(dflt);
  const n = Number(src);
  if (!Number.isFinite(n) || n <= 0 || n < lo || n > hi) {
    console.error(`invalid ${name}: ${JSON.stringify(src)} (expected ${lo}..${hi} ms)`);
    process.exit(2);
  }
  return Math.floor(n);
}
const timeoutMs = resolvePolicyMs(args["timeout-ms"], "BENCH_MODEL_TIMEOUT_MS", 60000, 15000, 120000);
// Separate full-task deadline, recorded for traceability (the gate itself
// only makes single model calls). An explicitly contradictory deadline
// (below 3x the per-call budget) is rejected; an unset one is floored.
let taskDeadlineMs = resolvePolicyMs(undefined, "BENCH_TASK_DEADLINE_MS", 300000, 120000, 600000);
if (taskDeadlineMs < 3 * timeoutMs) {
  if (process.env.BENCH_TASK_DEADLINE_MS !== undefined && process.env.BENCH_TASK_DEADLINE_MS !== "") {
    console.error(
      `contradictory benchmark timeouts: BENCH_TASK_DEADLINE_MS=${process.env.BENCH_TASK_DEADLINE_MS}ms ` +
        `is below 3x the per-model-call budget (${timeoutMs}ms).`,
    );
    process.exit(2);
  }
  taskDeadlineMs = 3 * timeoutMs;
}
const retries = Math.min(3, Math.max(0, parseInt(args.retries ?? "1", 10) || 0));
const retryMs = Math.min(10000, Math.max(0, parseInt(args["retry-ms"] ?? "1500", 10) || 0));
const base = (process.env.METERLESS_BASE_URL || "").replace(/\/$/, "");
const key = process.env.METERLESS_API_KEY || "";
const liveModel = process.env.METERLESS_MODEL || "";
const checks = [];
let pass = true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Body reads must share the same abort scope as the fetch: a server that
// sends headers quickly then stalls the body would otherwise hang the gate
// unboundedly (observed: attempts ran 131s/204s against a 120s fetch abort
// because res.json() sat outside the timeout). The timer stays armed until
// the parsed body is in hand; aborting mid-body rejects the read.
async function fetchJson(url, init, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error("gate-timeout")), ms);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    let data = null;
    if (res.ok) {
      data = await res.json();
    }
    return { res, data };
  } finally {
    clearTimeout(t);
  }
}

async function runCheck(name, fn) {
  const attempts = [];
  let result = null;
  for (let a = 0; a <= retries; a += 1) {
    const started = Date.now();
    try {
      result = await fn();
      attempts.push({ ...result.attempt, ms: Date.now() - started });
      if (result.ok) break;
    } catch (e) {
      attempts.push({ error: String((e && e.message) || e).slice(0, 160), ms: Date.now() - started });
    }
    if (a < retries) {
      await sleep(retryMs);
    }
  }
  const entry = { name, attempts, ...(result?.summary ?? {}), ok: result?.ok === true };
  checks.push(entry);
  return entry.ok;
}

// Authorization values are never written to gate.json: only status codes,
// model identities, timings, and usage metadata are recorded.
let modelsOk = false;
try {
  modelsOk = await runCheck("models", async () => {
    const { res, data } = await fetchJson(
      `${base}/models`,
      { headers: { Authorization: `Bearer ${key}` } },
      timeoutMs,
    );
    let ids = [];
    if (res.ok) {
      try {
        ids = ((data ?? {}).data ?? []).map((d) => d.id ?? "").filter(Boolean);
      } catch {
        ids = [];
      }
    }
    const ok = res.ok && ids.includes(liveModel);
    return {
      ok,
      attempt: { status: res.status, count: ids.length, containsLiveModel: ids.includes(liveModel) },
      summary: { status: res.status, count: ids.length, containsLiveModel: ids.includes(liveModel) },
    };
  });
  if (!modelsOk) pass = false;

  if (modelsOk) {
    for (let k = 0; k < chats; k += 1) {
      const okChat = await runCheck(`chat${k}`, async () => {
        const { res: r, data: j } = await fetchJson(
          `${base}/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: liveModel,
              messages: [{ role: "user", content: "Reply with exactly: ok" }],
              max_tokens: 8,
            }),
          },
          timeoutMs,
        );
        let model = null;
        let usage = null;
        if (r.ok) {
          try {
            model = (j ?? {}).model ?? null;
            usage = (j ?? {}).usage ?? null;
          } catch {
            model = "unparseable";
          }
        }
        const ok = r.ok && model === liveModel;
        return {
          ok,
          attempt: { status: r.status, model, usage },
          summary: { status: r.status, model, usage },
        };
      });
      if (!okChat) pass = false;
      // Sequential probes only, with a cooldown; never parallel.
      await sleep(2000);
    }
  } else {
    checks.push({ name: "chats-skipped", attempts: [], skipped: true, ok: false });
  }
} catch (e) {
  checks.push({ name: "fatal", attempts: [{ error: String((e && e.message) || e).slice(0, 160) }], ok: false });
  pass = false;
}

mkdirSync(outdir, { recursive: true });
writeFileSync(
  `${outdir}/gate.json`,
  JSON.stringify({ passed: pass, at: new Date().toISOString(), liveModel, minChats: chats, retries, timeoutMs, timeoutPolicy: { modelCallTimeoutMs: timeoutMs, taskDeadlineMs }, checks }, null, 1) + "\n",
);
console.log(`GATE passed=${pass} checks=${checks.map((c) => `${c.name}:${c.ok ? "ok" : "FAIL"}`).join(",")}`);
process.exit(pass ? 0 : 1);
