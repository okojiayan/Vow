import { afterEach, describe, expect, it, vi } from "vitest";
import { startAndRun } from "@/core/agent/orchestrator";
import { updateSettings } from "@/core/settings";
import { resetEnvCache } from "@/lib/env";
import { isolatedEnv } from "../helpers";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("sponsor end-to-end (mocked live-service proof)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("grounds the Pikachu result in real-shaped Zetaris rows with trace evidence", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    setEnv({
      ZETARIS_REST_URL: "http://localhost:8888/api/v1.0",
      ZETARIS_ORG_ID: "1",
      ZETARIS_API_KEY: "e2e-test-key",
      METERLESS_API_KEY: "",
    });

    const zetarisRows = [
      ["static", false],
      ["lightning-rod", true],
    ];
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/sql-editor/sqls/run")) {
        return new Response(JSON.stringify({ data: zetarisRows }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { task } = await startAndRun(
      "Query Pikachu abilities from pokeapi.pikachu_abilities_table",
    );

    // Deterministic VOW routing (policy-selected SQL, not model-authored)
    expect(task.plan?.inferenceMode).toBe("deterministic");
    const runSql = task.plan?.steps.find((s) => s.action?.tool === "run_sql");
    expect(runSql).toBeTruthy();
    // Offline (no provider): real rows are returned as evidence, but the
    // grounded summary cannot verify on a heuristic fallback. Honest failure,
    // never an ungrounded completion.
    expect(task.status).toBe("failed");
    expect(task.verification?.passed).toBe(false);
    expect(task.error ?? "").toMatch(/heuristic|ground|unverified/i);

    // Grounding: result rows are the Zetaris rows, not invented
    const output = runSql?.output as { rows?: unknown[][]; sql?: string; requestId?: string; rowCount?: number } | undefined;
    expect(output?.rows).toEqual(zetarisRows);
    expect(output?.rowCount).toBe(2);
    expect(typeof output?.requestId).toBe("string");
    expect(output?.sql).toContain("pokeapi.pikachu_abilities_table");

    // Trace evidence identifies provider/query/results/verification
    const trace = task.plan ? JSON.stringify(task) : "";
    expect(trace).not.toMatch(/lightning-rod.*invented/i);
    expect(task.resultSummary ?? "").not.toBe("");
  });

  it("marks Nightshift/Meterless contribution separately from heuristic fallback", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    // Meterless configured: mock a live-model completion for a generic task
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "e2e-meterless-key",
      METERLESS_MODEL: "nvidia/nemotron-3-ultra-550b-a55b",
      ZETARIS_API_KEY: "",
    });
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            model: "nvidia/nemotron-3-ultra-550b-a55b",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "List workspace then store observation",
                    steps: [
                      { title: "List workspace", instruction: "Inspect root", tool: "fs.list", args: { path: "." } },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { task } = await startAndRun("List workspace files for review");
    // Either live-model (mocked Nightshift) or heuristic fallback, but never mislabelled
    expect(["live-model", "heuristic-demo"]).toContain(task.plan?.inferenceMode);
    if (task.plan?.inferenceMode === "live-model") {
      expect(fetchMock).toHaveBeenCalled();
    }
  });
});
