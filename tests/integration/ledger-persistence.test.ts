import { describe, expect, it } from "vitest";
import { startAndRun } from "@/core/agent/orchestrator";
import { getLedger } from "@/core/reasoning/ledger";
import { readLedger } from "@/core/reasoning/ledger-store";
import { updateSettings } from "@/core/settings";
import { isolatedEnv } from "../helpers";

describe("ledger durability", () => {
  it("persists in-memory ledger events without chain-of-thought", async () => {
    await isolatedEnv();
    await updateSettings({ mode: "autonomous" });
    const { task } = await startAndRun("Compute 21 * 2 + 8");
    expect(task.status).toBe("completed");
    const mem = getLedger(task.id);
    const stored = await readLedger(task.id);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.map((e) => e.id)).toEqual(mem.slice(-200).map((e) => e.id));
    for (const e of stored) {
      expect(["decision", "evidence", "tool_outcome", "transition", "escalation", "verification"]).toContain(e.kind);
      expect(JSON.stringify(e)).not.toMatch(/chain-of-thought/i);
    }
  });
});
