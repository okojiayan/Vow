"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/fields";
import { Dialog, Toast } from "@/components/ui/overlays";
import { InlineBanner } from "@/components/ui/feedback";
import { isDiagnosticMemory } from "@/lib/memory-display";
import { loadPreferences, savePreferences } from "@/lib/preferences";

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AccountPage() {
  const { effective } = useTheme();
  const [name, setName] = useState("Ayan");
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [diagCount, setDiagCount] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      setName(loadPreferences().displayName || "Ayan");
    } catch {
      /* default */
    }
    fetch("/api/memory")
      .then((r) => r.json())
      .then((p) => {
        const records = (p.records ?? []) as Array<{ kind?: unknown; provenance?: unknown; source?: unknown }>;
        setSavedCount(records.filter((r) => !isDiagnosticMemory(r)).length);
        setDiagCount(records.filter((r) => isDiagnosticMemory(r)).length);
      })
      .catch(() => {
        setSavedCount(null);
        setDiagCount(null);
      });
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const save = useCallback(() => {
    try {
      const prefs = loadPreferences();
      savePreferences({ ...prefs, displayName: name });
      flash("Profile saved on this device.");
    } catch {
      flash("Could not save — storage unavailable.");
    }
  }, [flash, name]);

  const exportMem = useCallback(async () => {
    try {
      const payload = await fetch("/api/memory").then((r) => r.json());
      download("vow-memories.json", payload.records ?? []);
      flash("Memories exported.");
    } catch {
      flash("Export failed — the memory service did not respond.");
    }
  }, [flash]);

  const exportChats = useCallback(async () => {
    try {
      const payload = await fetch("/api/conversations").then((r) => r.json()).catch(() => ({ conversations: [] }));
      download("vow-conversations.json", payload.conversations ?? []);
      flash("Chats exported.");
    } catch {
      flash("Export failed — the conversation service did not respond.");
    }
  }, [flash]);

  const clearLocal = useCallback(() => {
    try {
      localStorage.clear();
    } catch {
      /* storage unavailable */
    }
    setConfirmClear(false);
    flash("Local data cleared. Server history is kept.");
  }, [flash]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Account"
          description="A local profile on this device. There is no cloud account."
        />

        <div style={{ display: "grid", gap: "var(--ds-space-4)" }}>
          <section
            aria-label="Profile"
            style={{ background: "var(--ds-surface)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)", padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-4)", flexWrap: "wrap" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "var(--ds-text-20)",
                  fontWeight: 600,
                  background: "var(--ds-surface-2)",
                  color: "var(--ds-accent)",
                  border: "1px solid var(--ds-border-strong)",
                  flex: "none",
                }}
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: "var(--ds-text-16)", fontWeight: 600, color: "var(--ds-ink)" }}>{name}</p>
                <p style={{ margin: "2px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                  Local profile · no cloud account ·{" "}
                  {savedCount === null ? "memory count unavailable" : `${savedCount} saved ${savedCount === 1 ? "memory" : "memories"}`}
                  {diagCount !== null && diagCount > 0 ? ` · ${diagCount} diagnostics (system only)` : ""}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--ds-space-3)", flexWrap: "wrap", alignItems: "flex-end", marginTop: "var(--ds-space-4)" }}>
              <div style={{ minWidth: 220, flex: "1 1 240px" }}>
                <Field label="Display name (stored on this device)">
                  {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
                </Field>
              </div>
              <Button variant="primary" size="sm" onClick={save}>Save profile</Button>
            </div>
          </section>

          <section
            aria-label="Data controls"
            style={{ background: "var(--ds-surface)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)", padding: "20px", display: "grid", gap: "var(--ds-space-3)" }}
          >
            <h2 style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)" }}>Your data</h2>
            <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.6 }}>
              Exports download as JSON from the live API. Clearing removes this device&apos;s preferences,
              routine and integration settings only — server history (tasks, approvals, memories) is kept.
            </p>
            <div style={{ display: "flex", gap: "var(--ds-space-2)", flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden="true" />} onClick={() => void exportMem()}>Export memories</Button>
              <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden="true" />} onClick={() => void exportChats()}>Export chats</Button>
              <Button variant="destructive" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setConfirmClear(true)}>Clear local data</Button>
            </div>
          </section>

          <InlineBanner
            tone="info"
            title="Private by default"
            body="VOW works inside one allowed folder. Everything else stays off-limits. Manage the folder in Chat on first run, or in Settings → Privacy & memory."
          />
        </div>

        <Dialog
          title="Clear local data?"
          open={confirmClear}
          onClose={() => setConfirmClear(false)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Keep</Button>
              <Button variant="destructive" size="sm" onClick={clearLocal}>Clear local data</Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            This deletes preferences, the display name, saved routine schedules, integration and skill
            settings stored in this browser. Server history — tasks, approvals, traces, and memories —
            is kept and untouched.
          </p>
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}
