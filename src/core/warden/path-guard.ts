import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathGuardError";
  }
}

function assertNoNullByte(value: string) {
  if (value.includes("\0")) {
    throw new PathGuardError("Path contains a null byte.");
  }
}

export async function resolveWorkspaceRoot(workspaceDir: string): Promise<string> {
  const absolute = path.resolve(workspaceDir);
  return realpath(absolute);
}

export async function assertSafeWorkspacePath(
  workspaceDir: string,
  requestedPath: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  assertNoNullByte(requestedPath);
  if (path.isAbsolute(requestedPath)) {
    throw new PathGuardError("Absolute paths are not allowed. Use a workspace-relative path.");
  }

  const root = await resolveWorkspaceRoot(workspaceDir);
  const candidate = path.resolve(root, requestedPath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathGuardError("Path escapes the allowlisted workspace.");
  }

  try {
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink()) {
      const real = await realpath(candidate);
      const realRel = path.relative(root, real);
      if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
        throw new PathGuardError("Symlink target escapes the allowlisted workspace.");
      }
      return real;
    }
    const real = await realpath(candidate);
    const realRel = path.relative(root, real);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw new PathGuardError("Resolved path escapes the allowlisted workspace.");
    }
    return real;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (options.mustExist) {
        throw new PathGuardError("Path does not exist inside the workspace.");
      }
      const parent = path.dirname(candidate);
      const parentReal = await realpath(parent).catch(() => {
        throw new PathGuardError("Parent directory is not inside the workspace.");
      });
      const parentRel = path.relative(root, parentReal);
      if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) {
        throw new PathGuardError("Parent directory escapes the allowlisted workspace.");
      }
      return candidate;
    }
    throw error;
  }
}
