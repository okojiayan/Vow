// Local UI preferences. Persisted in localStorage; applied by AppShell.
// Preferences that cannot be honored are exposed as disabled in Settings
// with an explanation instead of silently doing nothing.

export type StartPage = "chat" | "search" | "library";
export type AppearanceTheme = "warm" | "dusk" | "system";
export type Density = "comfortable" | "compact";
export type Translucency = "low" | "balanced" | "high";

export type CompanionMode = "off" | "subtle" | "full";

export interface UiPreferences {
  startPage: StartPage;
  keepRecentChats: boolean;
  restoreWorkspace: boolean;
  enterSends: boolean;
  showTimestamps: boolean;
  theme: AppearanceTheme;
  floatingIslands: boolean;
  cloudDrift: boolean;
  reduceMotion: boolean;
  density: Density;
  translucency: Translucency;
  defaultAutonomy: "manual" | "smart" | "full" | "warden";
  askBeforeExpands: boolean;
  requireDestructiveApproval: boolean;
  showTaskMonitor: boolean;
  playFullActivation: boolean;
  replayEveryTime: boolean;
  confirmBeforeDelete: boolean;
  showActionHistory: boolean;
  askBeforeSharing: boolean;
  useSavedMemories: boolean;
  companion: CompanionMode;
  notifyCompleted: boolean;
  notifyApproval: boolean;
  notifyBlocked: boolean;
  notifyDigest: boolean;
  displayName: string;
}

export const DEFAULT_PREFERENCES: UiPreferences = {
  startPage: "chat",
  keepRecentChats: true,
  restoreWorkspace: true,
  enterSends: true,
  showTimestamps: true,
  theme: "warm",
  floatingIslands: true,
  cloudDrift: true,
  reduceMotion: false,
  density: "comfortable",
  translucency: "balanced",
  defaultAutonomy: "smart",
  askBeforeExpands: true,
  requireDestructiveApproval: true,
  showTaskMonitor: true,
  playFullActivation: true,
  replayEveryTime: false,
  confirmBeforeDelete: true,
  showActionHistory: true,
  askBeforeSharing: true,
  useSavedMemories: true,
  companion: "full",
  notifyCompleted: true,
  notifyApproval: true,
  notifyBlocked: true,
  notifyDigest: false,
  displayName: "Ayan",
};

const KEY = "vow-ui-preferences-v1";

export function loadPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: UiPreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable; preferences simply do not persist.
  }
}
