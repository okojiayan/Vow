import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/core/warden/policy";

describe("Warden policy", () => {
  it("default-denies unknown tools", () => {
    const decision = evaluatePolicy({
      requestId: "r1",
      tool: "magic.root",
      args: {},
      mode: "autonomous",
      hasMatchingApproval: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
    expect(decision.policy).toContain("unknown-tool");
  });

  it("always denies shell.exec even in autonomous mode", () => {
    const decision = evaluatePolicy({
      requestId: "r2",
      tool: "shell.exec",
      args: { command: "ls" },
      mode: "autonomous",
      hasMatchingApproval: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
  });

  it("requires approval for writes in supervised mode", () => {
    const decision = evaluatePolicy({
      requestId: "r3",
      tool: "fs.write",
      args: { path: "a.txt", content: "x" },
      target: "a.txt",
      mode: "supervised",
      hasMatchingApproval: false,
    });
    expect(decision.effect).toBe("require_approval");
    expect(decision.allowed).toBe(false);
  });

  it("allows pre-authorized writes in autonomous mode after gateway evaluation", () => {
    const decision = evaluatePolicy({
      requestId: "r4",
      tool: "fs.write",
      args: { path: "a.txt", content: "x" },
      mode: "autonomous",
      hasMatchingApproval: false,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.policy).toContain("allow");
  });
});
