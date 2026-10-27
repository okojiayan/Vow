// Model Swap Guard — NVIDIA-only comparison through the existing adapter.
// Active production model is never changed by a comparison; switching requires
// explicit confirmation and preserves a fallback. Mock vs live is always labelled.
import { getAdapter, currentAdapterName } from "@/core/keep/adapter";
import { recordAudit } from "@/core/warden/audit";

export const NVIDIA_MODEL_PATTERN = /^nvidia\//;
export const SWAP_SAMPLE_LIMIT = 8;
export const SWAP_TIMEOUT_MS = 20_000;

export interface SwapCandidate {
  model: string;
  adapter: "mock" | "nvidia";
}

export interface SwapCaseResult {
  caseId: string;
  ok: boolean;
  latencyMs: number;
  structuredOk: boolean;
  timedOut: boolean;
  modelReported: string;
  mocked: boolean;
  error?: string;
}

export interface SwapReport {
  id: string;
  activeModel: string;
  activeAdapter: string;
  candidates: string[];
  cases: SwapCaseResult[];
  summary: Record<string, { ok: number; total: number; medianLatencyMs: number; timeouts: number }>;
  live: boolean;
  switched: false;
  createdAt: string;
}

export function validateCandidates(models: string[]): SwapCandidate[] {
  if (models.length === 0) throw new Error("No candidate models supplied.");
  if (models.length > 4) throw new Error("At most 4 candidates per comparison.");
  return models.map((m) => {
    const v = m.trim();
    if (!NVIDIA_MODEL_PATTERN.test(v) && v !== "mock-1") {
      throw new Error(`Candidate "${v}" is not a supported NVIDIA model (must match nvidia/...).`);
    }
    return { model: v, adapter: v === "mock-1" ? "mock" : "nvidia" };
  });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Run a bounded comparison. Never mutates the active model. */
export async function runSwapComparison(input: {
  candidates: string[];
  cases: Array<{ id: string; prompt: string; expectJson?: boolean }>;
  timeoutMs?: number;
}): Promise<SwapReport> {
  const cans = validateCandidates(input.candidates);
  const cases = input.cases.slice(0, SWAP_SAMPLE_LIMIT);
  if (cases.length === 0) throw new Error("No test cases supplied; refusing to compare on an empty sample.");
  const activeAdapter = currentAdapterName();
  const activeModel = process.env.METERLESS_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b";
  const timeoutMs = input.timeoutMs ?? SWAP_TIMEOUT_MS;
  const live = cans.some((c) => c.adapter === "nvidia") && Boolean((process.env.METERLESS_API_KEY ?? "").trim());
  const results: SwapCaseResult[] = [];
  for (const c of cans) {
    const adapter = getAdapter(c.adapter);
    for (const t of cases) {
      const started = Date.now();
      let timedOut = false;
      try {
        const text = await Promise.race([
          adapter
            .generate([{ role: "user", content: t.prompt }], [], { model: c.model, maxTokens: 300 })
            .then((r) => `${r.model}::${r.text}`),
          new Promise<string>((_, rej) => setTimeout(() => { timedOut = true; rej(new Error("timeout")); }, timeoutMs)),
        ]);
        const latencyMs = Date.now() - started;
        const body = text.split("::").slice(1).join("::");
        let structuredOk = true;
        if (t.expectJson) {
          try {
            JSON.parse(body.replace(/^MOCK-REPLY ::/, "").trim() || "{}");
          } catch {
            structuredOk = false;
          }
        }
        const mocked = c.adapter === "mock" || body.startsWith("MOCK-REPLY");
        results.push({ caseId: `${c.model}::${t.id}`, ok: structuredOk, latencyMs, structuredOk, timedOut: false, modelReported: text.split("::")[0], mocked });
      } catch (e) {
        results.push({
          caseId: `${c.model}::${t.id}`,
          ok: false,
          latencyMs: Date.now() - started,
          structuredOk: false,
          timedOut,
          modelReported: c.model,
          mocked: c.adapter === "mock",
          error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        });
      }
    }
  }
  const summary: SwapReport["summary"] = {};
  for (const c of cans) {
    const rows = results.filter((r) => r.caseId.startsWith(`${c.model}::`));
    summary[c.model] = {
      ok: rows.filter((r) => r.ok).length,
      total: rows.length,
      medianLatencyMs: median(rows.map((r) => r.latencyMs)),
      timeouts: rows.filter((r) => r.timedOut).length,
    };
  }
  const report: SwapReport = {
    id: `swap-${Date.now()}`,
    activeModel,
    activeAdapter,
    candidates: cans.map((c) => c.model),
    cases: results,
    summary,
    live,
    switched: false,
    createdAt: new Date().toISOString(),
  };
  await recordAudit({
    kind: "execution",
    taskId: "swap-guard",
    tool: "model.compare",
    decision: "allow",
    policy: "swap-guard.compare",
    reason: `Compared ${cans.map((c) => c.model).join(", ")} on ${cases.length} case(s); live=${live}. Active model unchanged.`,
    outcome: "success",
    fingerprint: report.id,
  });
  return report;
}

/** Explicit switch with fallback. Requires confirmation flag; validates candidate. */
export async function confirmModelSwitch(input: { candidate: string; confirmed: boolean; fallback: string }): Promise<{ ok: boolean; reason: string }> {
  if (!input.confirmed) return { ok: false, reason: "Switch requires explicit user confirmation." };
  const [c] = validateCandidates([input.candidate]);
  if (c.adapter === "nvidia" && !NVIDIA_MODEL_PATTERN.test(c.model)) return { ok: false, reason: "Only nvidia/... models may become active." };
  await recordAudit({
    kind: "policy",
    taskId: "swap-guard",
    tool: "model.switch",
    decision: "allow",
    policy: "swap-guard.switch",
    reason: `Operator confirmed switch to ${c.model}; fallback preserved as ${input.fallback}. Restart with VOW_KEEP_ADAPTER/METERLESS_MODEL to apply.`,
    outcome: "success",
    fingerprint: c.model,
  });
  // No in-process mutation of the active model: the operator applies the env
  // change and restarts. This preserves a safe fallback path.
  return { ok: true, reason: `Confirmed ${c.model}; apply via configuration and restart. Fallback: ${input.fallback}.` };
}
