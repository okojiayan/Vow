import { dataPath, mutateJsonFile, readJsonFile } from "@/lib/persistence";
import type { OperatingMode } from "@/core/warden/types";

export interface AppSettings {
  mode: OperatingMode;
  demoModeForced: boolean;
  memoryEnabled: boolean;
}

const STORE = () => dataPath("settings.json");
const DEFAULTS: AppSettings = { mode: "supervised", demoModeForced: false, memoryEnabled: true };

export async function getSettings(): Promise<AppSettings> {
  const stored = await readJsonFile<Partial<AppSettings>>(STORE(), {});
  return { ...DEFAULTS, ...stored };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return mutateJsonFile<AppSettings>(STORE(), DEFAULTS, (current) => ({ ...DEFAULTS, ...current, ...patch }));
}
