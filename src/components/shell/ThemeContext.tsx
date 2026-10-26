"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useMode } from "./ModeContext";

export type ThemeSetting = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark" | "warden";

const STORAGE_KEY = "vow-ds-theme-v1";

function readSetting(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch { /* ignore */ }
  return "system";
}

function resolveSystem(): "light" | "dark" {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

interface ThemeState {
  setting: ThemeSetting;
  effective: EffectiveTheme;
  setSetting: (s: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeState>({
  setting: "system",
  effective: "light",
  setSetting: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { warden } = useMode();
  const [setting, setSettingState] = useState<ThemeSetting>("system");
  const [system, setSystem] = useState<"light" | "dark">("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSettingState(readSetting());
    setSystem(resolveSystem());
    setReady(true);
    let mq: MediaQueryList | null = null;
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
    } catch { /* ignore */ }
    return () => {
      try { mq?.removeEventListener("change", onChange); } catch { /* ignore */ }
    };
  }, []);

  const setSetting = useCallback((s: ThemeSetting) => {
    setSettingState(s);
    try { window.localStorage.setItem(STORAGE_KEY, s); } catch { /* ignore */ }
  }, []);

  // Warden autonomy mode applies the Warden semantic theme over any setting.
  const effective: EffectiveTheme = warden ? "warden" : setting === "system" ? system : setting;

  const value = useMemo(
    () => ({ setting, effective, setSetting }),
    [setting, effective, setSetting],
  );
  void ready;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
