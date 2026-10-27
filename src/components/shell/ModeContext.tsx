"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { UiAutonomyMode } from "@/lib/autonomy";
import { isWardenUiMode } from "@/lib/autonomy";
import type { WardenBackend } from "@/lib/task-display";

interface ModeState {
  uiMode: UiAutonomyMode;
  warden: boolean;
  setUiMode: (mode: UiAutonomyMode) => void;
  /** Backend-confirmed enforcement state. Null until the first check completes. */
  wardenBackend: WardenBackend | null;
  wardenPending: boolean;
  wardenError: string | null;
  /**
   * Last toggle outcome (success or failure). The transformation overlay
   * watches this: a failure starts the failed beat with a readable error
   * and rolls visuals back. Display only; the enforced mode is unchanged.
   */
  wardenResult: { ok: boolean; entering: boolean; at: number; message?: string } | null;
  /**
   * Theme-only Warden toggle. Never writes policy: activation is displayed as
   * ACTIVE only after the backend confirms the gateway (see task-display).
   * Concurrent toggles are ignored while confirmation is in flight.
   */
  toggleWarden: () => void;
}

const ModeContext = createContext<ModeState>({
  uiMode: "manual",
  warden: false,
  setUiMode: () => {},
  wardenBackend: null,
  wardenPending: false,
  wardenError: null,
  wardenResult: null,
  toggleWarden: () => {},
});

export function ModeProvider({ children, initial }: { children: React.ReactNode; initial?: UiAutonomyMode }) {
  // Server and client render "manual" (or the provided initial) on first pass so
  // SSR hydration stays consistent. The ?mode= visual-verification hook is
  // applied client-side in an effect, mirroring ChromeProvider's ?monitor=
  // handling, so a verification URL can never cause a hydration mismatch.
  const [uiMode, setUiMode] = useState<UiAutonomyMode>(() => initial ?? "manual");
  useEffect(() => {
    if (initial) return;
    try {
      // Visual-verification hook: ?mode=warden opens the Warden theme directly.
      const q = new URLSearchParams(window.location.search).get("mode");
      if (q === "warden" || q === "manual" || q === "smart" || q === "full") setUiMode(q);
    } catch { /* ignore */ }
  }, [initial]);
  const [wardenBackend, setWardenBackend] = useState<WardenBackend | null>(null);
  const [wardenPending, setWardenPending] = useState(false);
  const [wardenError, setWardenError] = useState<string | null>(null);
  const inflight = useRef(false);

  const [wardenResult, setWardenResult] = useState<ModeState["wardenResult"]>(null);
  const confirmBackend = useCallback(async (fromToggle = false): Promise<boolean> => {
    if (inflight.current) return false;
    inflight.current = true;
    setWardenPending(true);
    setWardenError(null);
    try {
      // Verification hook: ?wardenFail=1 simulates a gateway confirmation
      // failure for transformation failure proofs. Compiled out of
      // production builds (same pattern as the ?demo= hooks).
      if (fromToggle && process.env.NODE_ENV !== "production") {
        try {
          if (new URLSearchParams(window.location.search).get("wardenFail") === "1") {
            throw new Error("Warden gateway did not confirm (simulated failure).");
          }
        } catch (e) { if (e instanceof Error && /simulated/.test(e.message)) throw e; }
      }
      const res = await fetch("/api/warden");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Warden state unavailable.");
      setWardenBackend({
        status: "confirmed",
        gatewayAlwaysOn: payload.gatewayAlwaysOn !== false,
        mode: typeof payload.mode === "string" ? payload.mode : null,
      });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Warden state unavailable.";
      setWardenBackend({ status: "unknown", error: message });
      setWardenError(message);
      return false;
    } finally {
      inflight.current = false;
      setWardenPending(false);
    }
  }, []);

  useEffect(() => {
    void confirmBackend();
  }, [confirmBackend]);

  const set = useCallback((m: UiAutonomyMode) => setUiMode(m), []);

  const toggleWarden = useCallback(() => {
    if (inflight.current) return;
    const next: UiAutonomyMode = isWardenUiMode(uiMode) ? "smart" : "warden";
    const entering = !isWardenUiMode(uiMode);
    // Verify backend state before presenting the new theme as confirmed, so
    // the UI can never claim ACTIVE while the backend is unreachable.
    // A failed toggle records the result so the transformation overlay can
    // play its failed beat; the enforced mode never changes on failure.
    void confirmBackend(true).then((ok) => {
      if (ok) {
        setWardenResult({ ok: true, entering, at: Date.now() });
        setUiMode(next);
      } else {
        setWardenResult({ ok: false, entering, at: Date.now(), message: "Warden gateway did not confirm. No changes were applied." });
      }
    });
  }, [confirmBackend, uiMode]);

  const value = useMemo(
    () => ({
      uiMode,
      warden: isWardenUiMode(uiMode),
      setUiMode: set,
      wardenBackend,
      wardenPending,
      wardenError,
      wardenResult,
      toggleWarden,
    }),
    [uiMode, set, wardenBackend, wardenPending, wardenError, wardenResult, toggleWarden],
  );
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode() {
  return useContext(ModeContext);
}
