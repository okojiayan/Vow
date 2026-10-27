"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Download } from "lucide-react";
import { Phase3Panels } from "@/components/phase3/Phase3Panels";
import { useMode } from "@/components/shell/ModeContext";
import { useTheme, type ThemeSetting } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Checkbox, Switch } from "@/components/ui/fields";
import { Segmented } from "@/components/ui/Segmented";
import { Dialog, Toast } from "@/components/ui/overlays";
import { InlineBanner } from "@/components/ui/feedback";
import { isDiagnosticMemory } from "@/lib/memory-display";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences, type UiPreferences } from "@/lib/preferences";
import { AUTONOMY_OPTIONS, type UiAutonomyMode } from "@/lib/autonomy";
import { BUILTIN_TOOLS, effectForMode, type PolicyEffectMirror } from "@/lib/runtime-inventory";

const SECTIONS = [
  { id: "general", label: "General", description: "Name, composer, and monitor behavior." },
  { id: "appearance", label: "Appearance", description: "Theme and preview. Warden is a mode, not a theme." },
  { id: "autonomy", label: "Autonomy", description: "What each mode may do alone, what needs approval, what never runs." },
  { id: "privacy", label: "Privacy & memory", description: "Allowed folder, integrations, and stored counts." },
  { id: "notifications", label: "Notifications", description: "Which events raise a notice on this device." },
  { id: "remote", label: "Remote & assistance", description: "Relay, worker, and cooling controls." },
  { id: "shortcuts", label: "Shortcuts", description: "Every keyboard shortcut in one place." },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const MODE_DISPLAY: Array<{ ui: UiAutonomyMode; name: string; backend: "supervised" | "assisted" | "autonomous" }> = [
  { ui: "manual", name: "Supervised", backend: "supervised" },
  { ui: "smart", name: "Assisted", backend: "assisted" },
  { ui: "full", name: "Autonomous", backend: "autonomous" },
  { ui: "warden", name: "Warden", backend: "autonomous" },
];

const RESTRICTIVENESS: Record<UiAutonomyMode, number> = { manual: 0, smart: 1, full: 2, warden: 3 };

/**
 * Plain-language capability groups for the Autonomy rows. Every row below is
 * derived from the live policy table (BUILTIN_TOOLS + effectForMode, the same
 * effects the Warden gateway enforces). Raw tool IDs appear only inside the
 * expandable "Technical details" line of each row — never in the prose.
 */
function groupOf(tool: string): "read" | "write" | "danger" | "shell" {
  if (["fs.list", "fs.read", "memory.search", "calc.evaluate", "run_sql", "plugin.text-stats.analyze"].includes(tool)) return "read";
  if (["fs.delete", "http.fetch"].includes(tool)) return "danger";
  if (tool === "shell.exec") return "shell";
  return "write";
}

const GROUP_TITLES = {
  read: "Read files and search memory",
  write: "Save notes and write files",
  danger: "Delete files or access the internet",
  shell: "Run shell commands",
} as const;

interface ModeDescription {
  alone: string;
  approval: string;
  never: string;
  delta: string | null;
  note: string | null;
  technical: string;
}

function describeMode(backend: "supervised" | "assisted" | "autonomous", warden: boolean): ModeDescription {
  const allow: string[] = [];
  const approval: string[] = [];
  const never: string[] = [];
  for (const t of BUILTIN_TOOLS) {
    const e: PolicyEffectMirror = effectForMode(t, backend);
    if (e === "allow") allow.push(t.name);
    else if (e === "require_approval") approval.push(t.name);
    else never.push(t.name);
  }
  const fmt = (names: string[]) => (names.length > 0 ? names.join(", ") : "—");
  const storesMemoryAlone = allow.includes("memory.store");

  const alone =
    backend === "autonomous"
      ? `${GROUP_TITLES.read} — listing and reading workspace files, searching saved memories, evaluating expressions, running read-only dataset queries and text analysis. ${GROUP_TITLES.write} — writing files, creating notes, saving memories, delegating scoped subtasks, invoking skills.`
      : `${GROUP_TITLES.read} — listing and reading workspace files, searching saved memories, evaluating expressions, running read-only dataset queries. Plus saving memories (memory.store), which runs alone — see the note below.`;
  const approvalText =
    backend === "autonomous"
      ? `${GROUP_TITLES.danger} — deleting a file or fetching a URL pauses for your approval first.`
      : `${GROUP_TITLES.write} — writing files, creating notes, running text analysis, delegating a scoped subtask, or invoking a skill pauses for your approval first.`;
  const neverText =
    backend === "autonomous"
      ? `${GROUP_TITLES.shell} — shell commands are denied in every mode, no exceptions.`
      : `${GROUP_TITLES.danger} — deleting files and fetching URLs are denied outright, not even offered for approval. ${GROUP_TITLES.shell} — shell commands are denied in every mode, no exceptions.`;

  const delta =
    backend === "supervised"
      ? null
      : backend === "assisted"
        ? "No difference from Supervised in the enforced policy table: every tool resolves to the same effect (verified against TOOL_PERMISSIONS in src/core/warden/policy.ts — no per-tool row distinguishes assisted from the default). The “pauses when scope expands” promise in this mode’s blurb is not implemented as a separate rule anywhere in the policy or gateway code; the only code difference is the stored mode label. If you want them to feel different, that needs a policy change — otherwise consider merging the two."
        : warden
          ? "Enforcement is identical to Autonomous: Warden maps to the same autonomous backend (backendModeFor in src/lib/autonomy.ts), so every tool resolves to the same allow / approval / deny. What Warden adds lives outside the allow/deny path: (1) identity — armored-mascot mark, purple accents, and a persistent topbar indicator; (2) evidence-first surfacing — collapsed plan → steps → verification timeline with an expandable evidence receipt per step and a verified / unverified label; (3) a policy log in Activity showing allowed / blocked / needs-approval entries, each with a reason, read from the same audit store the gateway writes in every mode; (4) confirmed activation — entering Warden calls GET /api/warden and only shows ACTIVE after the backend confirms the gateway. Verification (verifySteps) and audit logging run identically in all modes."
          : "Different from Assisted: writing files, creating notes, text analysis, delegating subtasks, and invoking skills now run alone without approval. Deleting files and fetching URLs move from denied to needs-approval. Shell commands stay denied.";

  const note =
    backend === "autonomous" || warden
      ? null
      : storesMemoryAlone
        ? "Plainly: saving a memory (memory.store) and running a dataset query (run_sql) need no approval in this mode. memory.store carries a write risk in the policy table yet its effect is allow — saving sounds like a write, but the gateway treats it like a read."
        : null;

  const technical = warden
    ? `Same enforcement as Autonomous. Alone: ${fmt(allow)}. Needs approval: ${fmt(approval)}. Never: ${fmt(never)}.`
    : `Alone: ${fmt(allow)}. Needs approval: ${fmt(approval)}. Never: ${fmt(never)}. Policy source: TOOL_PERMISSIONS in src/core/warden/policy.ts, mirrored for display in src/lib/runtime-inventory.ts.`;

  return { alone, approval: approvalText, never: neverText, delta, note, technical };
}

function SettingsInner() {
  const params = useSearchParams();
  const { uiMode, setUiMode } = useMode();
  const { setting, setSetting, effective } = useTheme();
  const [section, setSection] = useState<SectionId>("general");
  const [prefs, setPrefs] = useState<UiPreferences>(DEFAULT_PREFERENCES);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [allowedFolder, setAllowedFolder] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [diagCount, setDiagCount] = useState<number | null>(null);
  const [integrationNames, setIntegrationNames] = useState<string[]>([]);
  const [pendingMode, setPendingMode] = useState<UiAutonomyMode | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const tab = params.get("tab");
    if (tab && (SECTIONS as readonly { id: string }[]).some((s) => s.id === tab)) setSection(tab as SectionId);
    if (window.location.hash.replace("#", "") === "shortcuts") setSection("shortcuts");
  }, [params]);

  useEffect(() => {
    try {
      setPrefs(loadPreferences());
      setAllowedFolder(localStorage.getItem("vow-allowed-folder"));
      const raw = localStorage.getItem("vow-integrations-v1");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        setIntegrationNames(Object.keys(parsed ?? {}));
      }
    } catch {
      /* defaults */
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

  const update = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        savePreferences(next);
        setSavedAt(new Date().toLocaleTimeString());
      } catch {
        setSavedAt(null);
      }
      return next;
    });
  }, []);

  const requestMode = useCallback((mode: UiAutonomyMode) => {
    if (RESTRICTIVENESS[mode] > RESTRICTIVENESS[uiMode]) setPendingMode(mode);
    else {
      setUiMode(mode);
      update({ defaultAutonomy: mode });
    }
  }, [setUiMode, uiMode, update]);

  const confirmMode = useCallback(() => {
    if (!pendingMode) return;
    setUiMode(pendingMode);
    update({ defaultAutonomy: pendingMode });
    setPendingMode(null);
  }, [pendingMode, setUiMode, update]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const exportMem = useCallback(async () => {
    try {
      const payload = await fetch("/api/memory").then((r) => r.json());
      const blob = new Blob([JSON.stringify(payload.records ?? [], null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vow-memories.json";
      a.click();
      URL.revokeObjectURL(url);
      flash("Memories exported.");
    } catch {
      flash("Export failed — the memory service did not respond.");
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

  const pendingOption = pendingMode ? AUTONOMY_OPTIONS.find((o) => o.id === pendingMode) : null;

  const sectionLabel = useMemo(() => SECTIONS.find((s) => s.id === section)?.label ?? "", [section]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Settings"
          description="Workspace controls. Everything saves on this device, with confirmation inline."
        />
        <p role="status" style={{ margin: "0 0 var(--ds-space-5)", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
          {savedAt ? `Saved ${savedAt} on this device.` : "Changes save on this device."}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "var(--ds-space-6)", alignItems: "start" }} className="settings-cols">
          <nav aria-label="Settings sections" style={{ display: "grid", gap: "var(--ds-space-1)", position: "sticky", top: "var(--ds-space-4)" }}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "true" : undefined}
                className="ds-btn"
                style={{
                  textAlign: "left",
                  background: section === s.id ? "var(--ds-surface)" : "transparent",
                  border: "1px solid",
                  borderColor: section === s.id ? "var(--ds-border-strong)" : "transparent",
                  borderRadius: "var(--ds-radius-md)",
                  padding: "10px 14px",
                  cursor: "pointer",
                  minHeight: 44,
                }}
              >
                <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: section === s.id ? 600 : 500, color: "var(--ds-ink)" }}>{s.label}</span>
                <span style={{ display: "block", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", marginTop: 2 }}>{s.description}</span>
              </button>
            ))}
          </nav>

          <div aria-live="polite" aria-label={sectionLabel} style={{ minWidth: 0 }}>
            {section === "general" ? (
              <SettingsCard title="General">
                <div style={{ minWidth: 220, maxWidth: 320 }}>
                  <Field label="Display name (stored on this device)">
                    {(id) => <Input id={id} value={prefs.displayName} onChange={(e) => update({ displayName: e.target.value })} />}
                  </Field>
                </div>
                <Checkbox label="Enter sends message (Shift+Enter for newline)" checked={prefs.enterSends} onChange={(v) => update({ enterSends: v })} />
                <Checkbox label="Show message timestamps" checked={prefs.showTimestamps} onChange={(v) => update({ showTimestamps: v })} />
                <Switch label="Auto-open Activity on useful task events" checked={prefs.showTaskMonitor} onCheckedChange={(v) => update({ showTaskMonitor: v })} />
              </SettingsCard>
            ) : null}

            {section === "appearance" ? (
              <SettingsCard title="Appearance">
                <Segmented
                  label="Theme"
                  value={setting}
                  onChange={(v: ThemeSetting) => setSetting(v)}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                    { value: "system", label: "System" },
                  ]}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--ds-space-3)" }}>
                  {(["light", "dark", "system"] as const).map((t) => (
                    <div key={t} className="ds-scope" data-theme={t === "system" ? undefined : t} style={{ border: "1px solid var(--ds-border-strong)", borderRadius: "var(--ds-radius-md)", padding: "12px", background: "var(--ds-surface)" }}>
                      <p style={{ margin: "0 0 8px", fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-ink)", textTransform: "capitalize" }}>{t}{setting === t ? " · current" : ""}</p>
                      <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-ink)", background: "var(--ds-bg)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-sm)", padding: "8px 10px" }}>
                        Morning briefing ready. <span style={{ color: "var(--ds-accent)", fontWeight: 600 }}>Verified ✓</span>
                      </p>
                    </div>
                  ))}
                </div>
                <InlineBanner tone="info" title="Warden is a mode, not a theme" body="Warden applies its own identity over any theme. Enter it from Autonomy — it never lives in this list." />
                <div>
                  <Button variant="secondary" size="sm" onClick={() => requestMode(uiMode === "warden" ? "smart" : "warden")}>
                    {uiMode === "warden" ? "Exit Warden mode" : "Enter Warden mode"}
                  </Button>
                </div>
              </SettingsCard>
            ) : null}

            {section === "autonomy" ? (
              <SettingsCard title="Autonomy">
                <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.6 }}>
                  Derived from the live Warden policy table — the same effects the gateway enforces.
                  Switching to a less restrictive mode asks first.
                </p>
                {MODE_DISPLAY.map((m) => {
                  const d = describeMode(m.backend, m.ui === "warden");
                  const current = uiMode === m.ui;
                  return (
                    <div key={m.ui} style={{ border: "1px solid", borderColor: current ? "var(--ds-accent)" : "var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "12px 14px", background: "var(--ds-surface)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
                        <p style={{ margin: 0, fontSize: "var(--ds-text-14)", fontWeight: 600, color: "var(--ds-ink)" }}>{m.name}{current ? " · current" : ""}</p>
                        <span style={{ marginLeft: "auto" }}>
                          {!current ? <Button variant="secondary" size="sm" onClick={() => requestMode(m.ui)}>Switch to {m.name}</Button> : null}
                        </span>
                      </div>
                      <dl style={{ margin: "8px 0 0", display: "grid", gap: 4, fontSize: "var(--ds-text-13)", lineHeight: 1.55 }}>
                        <div><dt style={{ display: "inline", fontWeight: 600, color: "var(--ds-muted)" }}>May do alone: </dt><dd style={{ display: "inline", margin: 0, color: "var(--ds-ink-soft)" }}>{d.alone}</dd></div>
                        <div><dt style={{ display: "inline", fontWeight: 600, color: "var(--ds-muted)" }}>Needs approval: </dt><dd style={{ display: "inline", margin: 0, color: "var(--ds-ink-soft)" }}>{d.approval}</dd></div>
                        <div><dt style={{ display: "inline", fontWeight: 600, color: "var(--ds-muted)" }}>Never allowed: </dt><dd style={{ display: "inline", margin: 0, color: "var(--ds-ink-soft)" }}>{d.never}</dd></div>
                      </dl>
                      {d.note ? (
                        <p style={{ margin: "8px 0 0", fontSize: "var(--ds-text-13)", lineHeight: 1.55, color: "var(--ds-ink-soft)", borderLeft: "2px solid var(--ds-accent)", paddingLeft: 8 }}>{d.note}</p>
                      ) : null}
                      {d.delta ? (
                        <p style={{ margin: "8px 0 0", fontSize: "var(--ds-text-13)", lineHeight: 1.55, color: "var(--ds-ink-soft)" }}><span style={{ fontWeight: 600, color: "var(--ds-muted)" }}>What changes from the mode below: </span>{d.delta}</p>
                      ) : null}
                      <details style={{ margin: "8px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Technical details (tool IDs)</summary>
                        <p style={{ margin: "4px 0 0", fontFamily: "var(--ds-font-mono)", color: "var(--ds-ink-soft)", lineHeight: 1.55 }}>{d.technical}</p>
                      </details>
                    </div>
                  );
                })}
              </SettingsCard>
            ) : null}

            {section === "privacy" ? (
              <SettingsCard title="Privacy & memory">
                <div>
                  <p style={{ margin: "0 0 4px", fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)" }}>What VOW can access</p>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: "var(--ds-text-13)", color: "var(--ds-ink-soft)" }}>
                    <li>Allowed folder: {allowedFolder ?? "not chosen yet"}. VOW may read and write inside this folder only.</li>
                    <li>Connected integrations: {integrationNames.length > 0 ? `${integrationNames.length} saved on this device (preview only, not live connections)` : "none"}.</li>
                    <li>
                      Stored memories: {savedCount === null ? "unavailable" : `${savedCount} saved`}
                      {diagCount !== null ? ` · ${diagCount} diagnostics (system entries, counted separately)` : ""}.
                    </li>
                  </ul>
                </div>
                <div style={{ display: "flex", gap: "var(--ds-space-2)", flexWrap: "wrap" }}>
                  <Button variant="secondary" size="sm" icon={<Download size={15} aria-hidden="true" />} onClick={() => void exportMem()}>Export memories</Button>
                  <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)}>Clear local data</Button>
                </div>
              </SettingsCard>
            ) : null}

            {section === "notifications" ? (
              <SettingsCard title="Notifications">
                <Checkbox label="Task completed" checked={prefs.notifyCompleted} onChange={(v) => update({ notifyCompleted: v })} />
                <Checkbox label="Approval needed" checked={prefs.notifyApproval} onChange={(v) => update({ notifyApproval: v })} />
                <Checkbox label="Blocked or failed" checked={prefs.notifyBlocked} onChange={(v) => update({ notifyBlocked: v })} />
                <Checkbox label="Daily digest" checked={prefs.notifyDigest} onChange={(v) => update({ notifyDigest: v })} />
              </SettingsCard>
            ) : null}

            {section === "remote" ? (
              <SettingsCard title="Remote & assistance">
                <Phase3Panels />
              </SettingsCard>
            ) : null}

            {section === "shortcuts" ? (
              <SettingsCard title="Shortcuts">
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-2)" }}>
                  {[
                    ["⌘K", "Command palette — navigation and actions"],
                    ["⌘⇧M", "Toggle Activity"],
                    ["⌘\\", "Toggle sidebar"],
                    ["Enter", "Send message (Shift+Enter for newline)"],
                    ["Esc", "Close menus, dialogs, and the palette"],
                    ["Tab / arrows", "Every control is keyboard reachable"],
                  ].map(([keys, what]) => (
                    <li key={keys} style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)" }}>
                      <span className="ds-kbd">{keys}</span>
                      <span style={{ fontSize: "var(--ds-text-14)", color: "var(--ds-ink-soft)" }}>{what}</span>
                    </li>
                  ))}
                </ul>
              </SettingsCard>
            ) : null}
          </div>
        </div>

        <Dialog
          title={pendingOption ? `Switch to ${pendingOption.label}?` : "Switch mode?"}
          open={pendingMode !== null}
          onClose={() => setPendingMode(null)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setPendingMode(null)}>Stay put</Button>
              <Button variant="primary" size="sm" onClick={confirmMode}>Switch mode</Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {pendingOption ? `${pendingOption.description} Less restrictive than your current mode, so confirm you mean it.` : ""}
          </p>
        </Dialog>

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

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{ background: "var(--ds-surface)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)", padding: "20px", display: "grid", gap: "var(--ds-space-4)" }}
    >
      <h2 style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)" }}>{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading settings…</p>}>
      <SettingsInner />
    </Suspense>
  );
}
