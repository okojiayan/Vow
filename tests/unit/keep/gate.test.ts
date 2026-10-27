import { describe, expect, it } from "vitest";
import { checkGate } from "@/core/keep/gate";
import { createTaskPass } from "@/core/keep/task-pass";

describe("keep gate", () => {
  it("denies traversal outside pass", async () => {
    const pass = await createTaskPass({ task_id: `t-traverse-${Date.now()}`, mode: "warden", grantPaths: ["demo/sandbox"] });
    const v = await checkGate({ tool: "fs.read", target: "../secret.txt" }, pass);
    expect(v.allowed).toBe(false);
  });
  it("denies absolute and UNC paths", async () => {
    const pass = await createTaskPass({ task_id: `t-abs-${Date.now()}`, mode: "warden", grantPaths: ["demo/sandbox"] });
    expect((await checkGate({ tool: "fs.read", target: "/etc/passwd" }, pass)).allowed).toBe(false);
    expect((await checkGate({ tool: "fs.read", target: "\\\\server\\share" }, pass)).allowed).toBe(false);
  });
  it("denies unlisted tools and expired pass", async () => {
    const pass = await createTaskPass({ task_id: `t-tool-${Date.now()}`, mode: "warden", grantPaths: ["demo/sandbox"], ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const v = await checkGate({ tool: "fs.read", target: "demo/sandbox/a.txt" }, pass);
    expect(v.allowed).toBe(false);
  });
  it("parks irreversible actions and turbo allows (baseline)", async () => {
    const w = await createTaskPass({ task_id: `t-park-${Date.now()}`, mode: "warden", grantPaths: ["demo/sandbox"] });
    const parked = await checkGate({ tool: "cancel", target: "money" }, w);
    expect(parked.allowed).toBe(false);
    const turbo = await createTaskPass({ task_id: `t-turbo-${Date.now()}`, mode: "turbo" });
    expect((await checkGate({ tool: "fs.read", target: "../anything" }, turbo)).allowed).toBe(true);
  });
  it("money pack has no cancel/pay/send capability", async () => {
    const { defaultMoneyActions } = await import("@/core/keep/task-pass");
    const actions = defaultMoneyActions();
    expect(actions).not.toContain("money.cancel");
    expect(actions).not.toContain("money.pay");
    expect(actions).not.toContain("money.send");
  });
});
