// VOW sponsor-demo preflight: read-only checks, no inference, no secrets printed.
// Exit 0 only if BOTH sponsors are reachable. Usage:
//   node scripts/demo-preflight.mjs [--timeout-ms=60000]
import { readFileSync } from "node:fs";

for (const line of (() => { try { return readFileSync(".env", "utf8"); } catch { return ""; } })().split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
}
const timeoutMs = Math.min(120000, Math.max(3000, parseInt(process.argv.find((a) => a.startsWith("--timeout-ms="))?.split("=")[1] ?? "60000", 10) || 60000));
const results = [];
async function timedFetch(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, status: r.status, ms: Date.now() - t0, res: r };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

// 1. Zetaris: env present + TCP reachable (read-only; no query executed here).
const zUrl = process.env.ZETARIS_REST_URL ?? "";
const zKey = process.env.ZETARIS_API_KEY ?? "";
const zOrg = process.env.ZETARIS_ORG_ID ?? "";
if (!zUrl || !zKey || !zOrg) {
  results.push({ check: "zetaris-env", pass: false, detail: "missing ZETARIS_REST_URL / ORG_ID / API_KEY (names only, values never printed)" });
} else {
  results.push({ check: "zetaris-env", pass: true, detail: `REST URL configured (${zUrl}); key and org present` });
  const ping = await timedFetch(zUrl, { method: "GET" });
  results.push({ check: "zetaris-reachable", pass: ping.ok, detail: ping.ok ? `HTTP ${ping.status} in ${ping.ms}ms` : `unreachable: ${ping.error ?? "status 0"} in ${ping.ms}ms` });
}

// 2. Meterless/Nightshift: authenticated models listing (no inference burned).
const mBase = process.env.METERLESS_BASE_URL ?? "";
const mKey = process.env.METERLESS_API_KEY ?? "";
const mModel = process.env.METERLESS_MODEL ?? "";
if (!mBase || !mKey) {
  results.push({ check: "meterless-env", pass: false, detail: "missing METERLESS_BASE_URL / API_KEY" });
} else {
  const listed = await timedFetch(`${mBase}/models`, { headers: { Authorization: "Bearer " + mKey, "meterless-app": "vow-open-agent-hackathon" } });
  if (!listed.ok) {
    results.push({ check: "meterless-models", pass: false, detail: `unreachable: ${listed.error} in ${listed.ms}ms` });
  } else {
    const body = await listed.res.json().catch(() => null);
    const ids = (body && body.data ? body.data : []).map((m) => m.id ?? m.name).filter(Boolean);
    const nemotron = mModel && ids.includes(mModel);
    results.push({ check: "meterless-models", pass: listed.status === 200 && ids.length > 0, detail: `HTTP ${listed.status}, ${ids.length} model ids in ${listed.ms}ms, configured model listed: ${nemotron ? "yes" : "NO"}` });
  }
}

const pass = results.every((r) => r.pass);
console.log(JSON.stringify({ pass, at: new Date().toISOString(), timeoutMs, results }, null, 1));
process.exit(pass ? 0 : 1);
