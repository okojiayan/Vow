import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetEnvCache } from "@/lib/env";
import { resetTools } from "@/core/execution/tool-registry";
import { registerBuiltinTools } from "@/core/execution/builtin-tools";

export async function isolatedEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vow-"));
  const dataDir = path.join(root, "data");
  const workspace = path.join(dataDir, "workspace");
  await mkdir(path.join(workspace, "notes"), { recursive: true });
  process.env.VOW_DATA_DIR = dataDir;
  process.env.VOW_WORKSPACE_DIR = workspace;
  process.env.METERLESS_API_KEY = "";
  process.env.ZETARIS_API_KEY = "";
  resetEnvCache();
  resetTools();
  registerBuiltinTools();
  return { root, dataDir, workspace };
}
