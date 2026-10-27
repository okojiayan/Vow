import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathGuardError, assertSafeWorkspacePath } from "@/core/warden/path-guard";
import { isolatedEnv } from "../../helpers";

describe("path protection", () => {
  it("blocks traversal and absolute paths", async () => {
    const { workspace } = await isolatedEnv();
    await expect(assertSafeWorkspacePath(workspace, "../secret")).rejects.toBeInstanceOf(PathGuardError);
    await expect(assertSafeWorkspacePath(workspace, "/etc/passwd")).rejects.toBeInstanceOf(PathGuardError);
  });

  it("blocks symlinks that escape the workspace", async () => {
    const { workspace, root } = await isolatedEnv();
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "nope");
    await mkdir(path.join(workspace, "inner"), { recursive: true });
    const link = path.join(workspace, "escape.txt");
    await symlink(outside, link);
    await expect(assertSafeWorkspacePath(workspace, "escape.txt")).rejects.toBeInstanceOf(PathGuardError);
  });

  it("allows a real file inside the workspace", async () => {
    const { workspace } = await isolatedEnv();
    await writeFile(path.join(workspace, "ok.txt"), "yes");
    const resolved = await assertSafeWorkspacePath(workspace, "ok.txt", { mustExist: true });
    expect(resolved.endsWith("ok.txt")).toBe(true);
  });
});
