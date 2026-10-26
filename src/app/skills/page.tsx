"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/fields";
import { Tabs } from "@/components/ui/Tabs";
import { Dialog, Drawer, Toast } from "@/components/ui/overlays";
import { EmptyState } from "@/components/ui/feedback";
import { VerificationBadge, PermissionBadge } from "@/components/ui/badges";
import { BUILTIN_TOOLS, SKILLS } from "@/lib/runtime-inventory";

const STORE_KEY = "vow-skills-disabled-v1";

function loadDisabled(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SkillsPage() {
  const { effective } = useTheme();
  const [tab, setTab] = useState("discover");
  const [query, setQuery] = useState("");
  const [disabled, setDisabled] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmEnableId, setConfirmEnableId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setDisabled(loadDisabled());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(disabled));
    } catch {
      /* storage unavailable */
    }
  }, [disabled]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (name: string, description: string) => !q || `${name} ${description}`.toLowerCase().includes(q),
    [q],
  );

  const discover = useMemo(() => SKILLS.filter((s) => matches(s.name, s.description)), [matches]);
  const installed = useMemo(
    () => SKILLS.filter((s) => !disabled.includes(s.id) && matches(s.name, s.description)),
    [disabled, matches],
  );

  const detail = detailId ? SKILLS.find((s) => s.id === detailId) ?? null : null;
  const confirmSkill = confirmEnableId ? SKILLS.find((s) => s.id === confirmEnableId) ?? null : null;
  const visible = tab === "discover" ? discover : installed;

  const disable = useCallback((id: string) => {
    setDisabled((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setDetailId(null);
    flash("Skill disabled on this device.");
  }, [flash]);

  const enable = useCallback((id: string) => {
    setDisabled((prev) => prev.filter((x) => x !== id));
    setConfirmEnableId(null);
    setDetailId(null);
    flash("Skill enabled.");
  }, [flash]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Skills"
          description="Agent capabilities from the verified in-repo registry. Enable only what a task needs."
        />

        <Tabs
          label="Skill catalog"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "discover", label: `Discover (${discover.length})` },
            { value: "installed", label: `Installed (${installed.length})` },
          ]}
        />

        <div style={{ margin: "var(--ds-space-4) 0", maxWidth: 440 }}>
          <Field label="Search skills">
            {(id) => <Input id={id} placeholder="Filter by name or purpose…" value={query} onChange={(e) => setQuery(e.target.value)} />}
          </Field>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title={tab === "installed" ? "No skills installed" : "No skills match"}
            body={tab === "installed" ? "Disabled skills can be re-enabled from Discover at any time." : "Try a different search."}
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-3)" }}>
            {visible.map((s) => {
              const isDisabled = disabled.includes(s.id);
              return (
                <li
                  key={s.id}
                  style={{
                    background: "var(--ds-surface)",
                    border: "1px solid var(--ds-border)",
                    borderRadius: "var(--ds-radius-lg)",
                    padding: "14px 16px",
                    opacity: isDisabled ? 0.75 : 1,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-2)", flexWrap: "wrap" }}>
                        <p style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)" }}>{s.name}</p>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                          <ShieldCheck size={14} aria-hidden="true" />
                          Verified
                        </span>
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.55 }}>{s.description}</p>
                      <p style={{ margin: "6px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                        By {s.author} · v{s.version} · {isDisabled ? "disabled on this device" : "installed"}
                      </p>
                    </div>
                    <div style={{ marginLeft: "auto", flex: "none" }}>
                      <Button variant="secondary" size="sm" onClick={() => setDetailId(s.id)}>Details</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Drawer title={detail ? detail.name : "Skill details"} open={detail !== null} onClose={() => setDetailId(null)}>
          {detail ? (
            <div style={{ display: "grid", gap: "var(--ds-space-4)" }}>
              <div style={{ display: "flex", gap: "var(--ds-space-2)", alignItems: "center", flexWrap: "wrap" }}>
                <VerificationBadge state="verified" />
                <span style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>By {detail.author} · v{detail.version}</span>
              </div>
              <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)", lineHeight: 1.6 }}>{detail.description}</p>
              <div>
                <p style={{ margin: "0 0 4px", fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)" }}>Tools it uses</p>
                <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
                  {detail.tools.map((t) => {
                    const def = BUILTIN_TOOLS.find((b) => b.name === t);
                    return (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-2)", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-ink)" }}>{t}</span>
                        {def ? <PermissionBadge level={def.permission} /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p style={{ margin: "0 0 4px", fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)" }}>It needs from you</p>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
                  {detail.needs.map((n) => (
                    <li key={n} style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-ink-soft)" }}>{n}</li>
                  ))}
                </ul>
              </div>
              <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.6 }}>Limits: {detail.limits}</p>
              <div style={{ display: "flex", gap: "var(--ds-space-2)", justifyContent: "flex-end" }}>
                {disabled.includes(detail.id) ? (
                  <Button variant="primary" size="sm" onClick={() => setConfirmEnableId(detail.id)}>Enable skill</Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => disable(detail.id)}>Disable on this device</Button>
                )}
              </div>
            </div>
          ) : null}
        </Drawer>

        <Dialog
          title={confirmSkill ? `Enable ${confirmSkill.name}?` : "Enable skill?"}
          open={confirmEnableId !== null}
          onClose={() => setConfirmEnableId(null)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmEnableId(null)}>Not now</Button>
              {confirmSkill ? <Button variant="primary" size="sm" onClick={() => enable(confirmSkill.id)}>Enable with these permissions</Button> : null}
            </>
          }
        >
          {confirmSkill ? (
            <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
              <p style={{ margin: 0 }}>This skill will be allowed to use:</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
                {confirmSkill.tools.map((t) => (
                  <li key={t} style={{ fontSize: "var(--ds-text-14)" }}><span style={{ fontFamily: "var(--ds-font-mono)" }}>{t}</span></li>
                ))}
              </ul>
              <p style={{ margin: 0 }}>Limits: {confirmSkill.limits}</p>
            </div>
          ) : null}
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}
