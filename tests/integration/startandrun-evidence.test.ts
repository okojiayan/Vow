import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

const MARKER = "evidence-probe-marker-9f3c7a";
const FILENAME = "evidence-probe.txt";

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("bounded startAndRun evidence audit (real orchestrator, no provider)", () => {
  const originalFetch = globalThis.fetch;
  let dataDir = "";
  let workspaceDir = "";
  let fetchCalls = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCalls = 0;
    dataDir = mkdtempSync(join(tmpdir(), "vow-sar-data-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "vow-sar-ws-"));
    writeFileSync(join(workspaceDir, FILENAME), `Probe file. ${MARKER} end.\n`, "utf8");
    setEnv({
      METERLESS_BASE_URL: "http://127.0.0.1:8088/v1",
      METERLESS_API_KEY: "",
      METERLESS_TIMEOUT_MS: "1000",
      VOW_DATA_DIR: dataDir,
      VOW_WORKSPACE_DIR: workspaceDir,
      ZETARIS_API_KEY: "",
    });
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network disabled in startAndRun audit");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setEnv({
      METERLESS_API_KEY: undefined,
      METERLESS_TIMEOUT_MS: undefined,
      VOW_DATA_DIR: undefined,
      VOW_WORKSPACE_DIR: undefined,
      ZETARIS_API_KEY: undefined,
    });
    vi.restoreAllMocks();
    for (const dir of [dataDir, workspaceDir]) {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup of test-owned temp dirs only.
        }
      }
    }
  });

  it("one file-read task links invocation, trace, receipt, and verification", async () => {
    const { startAndRun } = await import("@/core/agent/orchestrator");
    const { getTask } = await import("@/core/agent/task-store");
    const { getTrace } = await import("@/core/traces/trace-store");
    const { listReceipts } = await import("@/core/execution/reversals");

    const { task: returned } = await startAndRun(`Read ${FILENAME}`);
    const taskId = returned.id;
    console.log(`startAndRun task id: ${taskId}`);

    const persisted = await getTask(taskId);
    expect(persisted).toBeDefined();
    const steps = persisted!.plan?.steps ?? [];
    const tools = steps.filter((s) => s.action).map((s) => s.action!.tool);
    console.log(`planned tools: ${JSON.stringify(tools)} status: ${persisted!.status}`);
    // Only the intended local file-read tool may appear in the plan.
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t === "fs.read")).toBe(true);

    const receipts = await listReceipts(taskId);
    expect(receipts.length).toBeGreaterThan(0);
    for (const r of receipts) {
      expect(r.tool).toBe("fs.read");
    }
    const readReceipts = receipts.filter((r) => r.outcome === "ok");
    expect(readReceipts.length).toBeGreaterThan(0);
    const receiptPaths = readReceipts.map((r) => r.target ?? (r.argsRedacted as Record<string, unknown>)?.path);
    expect(receiptPaths.every((p) => p === FILENAME)).toBe(true);

    const trace = await getTrace(taskId);
    const toolCalls = trace.events.filter((e) => e.kind === "tool_call");
    expect(toolCalls.length).toBeGreaterThan(0);
    const dispatches = toolCalls.filter(
      (e) => (e.data as { args?: { path?: unknown } } | undefined)?.args !== undefined,
    );
    expect(dispatches.length).toBeGreaterThan(0);
    const tracedPaths = dispatches.map(
      (e) => ((e.data as { args?: { path?: unknown } }).args?.path),
    );
    expect(tracedPaths.every((p) => p === FILENAME)).toBe(true);
    const outcomeEvents = toolCalls.filter(
      (e) => (e.data as { args?: unknown } | undefined)?.args === undefined,
    );
    expect(
      outcomeEvents.some((e) => /evidence\s+ev_/i.test(`${e.title} ${e.detail}`)),
    ).toBe(true);

    // The executed step output carries the exact marker from the file.
    const readStep = steps.find((s) => s.action?.tool === "fs.read");
    const output = readStep?.output as { content?: unknown; path?: unknown } | undefined;
    expect(typeof output?.content === "string" && (output.content as string).includes(MARKER)).toBe(true);

    // Verification evidence refers to that same output object, not loose text.
    expect(persisted!.verification).not.toBeNull();
    const evidenceJson = JSON.stringify(persisted!.verification?.evidence ?? []);
    expect(evidenceJson).toContain(MARKER);
    const verificationEvents = trace.events.filter((e) => e.kind === "verification");
    expect(verificationEvents.length).toBeGreaterThan(0);

    // Persisted outcome agrees with the verifier.
    if (persisted!.status === "completed") {
      expect(persisted!.verification?.passed).toBe(true);
      expect(persisted!.outcome?.verificationPassed).toBe(true);
    } else {
      expect(["failed", "blocked", "awaiting_approval", "cancelled"]).toContain(persisted!.status);
      expect(persisted!.verification?.passed).toBe(false);
    }

    // No provider or external API was called; heuristic fallback is production logic.
    expect(fetchCalls).toBe(0);
    expect(persisted!.inferenceMode).toBe("heuristic-demo");
    console.log(
      `outcome: status=${persisted!.status} verified=${persisted!.verification?.passed} ` +
        `receipts=${receipts.length} toolCalls=${toolCalls.length} fetchCalls=${fetchCalls}`,
    );
  }, 120000);
});
