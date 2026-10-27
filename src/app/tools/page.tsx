"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Checkbox, Switch } from "@/components/ui/fields";
import { Segmented } from "@/components/ui/Segmented";
import { Dialog, Drawer, Toast } from "@/components/ui/overlays";
import { EmptyState } from "@/components/ui/feedback";
import { PermissionBadge } from "@/components/ui/badges";
import { Stepper } from "@/components/ui/Stepper";
import { BUILTIN_TOOLS, CONNECTORS, } from "@/lib/runtime-inventory";

interface ConnectionConfig {
  method: "oauth" | "token";
  scopes: string[];
  requireApproval: boolean;
  configuredAt: string;
}

const STORE_KEY = "vow-integrations-v1";
const WIZARD_STEPS = [{ id: "choose", label: "Choose" }, { id: "auth", label: "Authenticate" }, { id: "configure", label: "Configure" }, { id: "review", label: "Review and connect" }];

function loadConfigs(): Record<string, ConnectionConfig> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ConnectionConfig>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--ds-space-2)", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "var(--ds-accent)" : "var(--ds-muted)" }} />
      {connected ? "Connected" : "Available"}
    </span>
  );
}

export default function IntegrationsPage() {
  const { effective } = useTheme();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "connected" | "available">("all");
  const [configs, setConfigs] = useState<Record<string, ConnectionConfig>>({});
  const [toast, setToast] = useState<string | null>(null);

  const [inspectBuiltIn, setInspectBuiltIn] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [connectorId, setConnectorId] = useState<string>(CONNECTORS[0].id);
  const [method, setMethod] = useState<"oauth" | "token">("oauth");
  const [scopes, setScopes] = useState<string[]>(CONNECTORS[0].scopes);
  const [requireApproval, setRequireApproval] = useState(true);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);

  useEffect(() => {
    setConfigs(loadConfigs());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(configs));
    } catch {
      /* storage unavailable */
    }
  }, [configs]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const connector = useMemo(() => CONNECTORS.find((c) => c.id === connectorId) ?? CONNECTORS[0], [connectorId]);

  const openWizard = useCallback((id: string) => {
    const c = CONNECTORS.find((x) => x.id === id) ?? CONNECTORS[0];
    setConnectorId(c.id);
    setMethod("oauth");
    setScopes(c.scopes);
    setRequireApproval(true);
    setStep(0);
    setWizardOpen(true);
  }, []);


  const confirmDisconnect = useCallback(() => {
    if (!disconnectId) return;
    setConfigs((prev) => {
      const next = { ...prev };
      delete next[disconnectId];
      return next;
    });
    setDisconnectId(null);
    flash("Connection removed from this device.");
  }, [disconnectId, flash]);

  const q = query.trim().toLowerCase();
  const matchQ = useCallback((...parts: string[]) => !q || parts.join(" ").toLowerCase().includes(q), [q]);

  const builtIns = useMemo(() => BUILTIN_TOOLS.filter((t) => matchQ(t.name, t.purpose)), [matchQ]);
  const connectedConnectors = useMemo(
    () => CONNECTORS.filter((c) => configs[c.id] && matchQ(c.name, c.purpose)),
    [configs, matchQ],
  );
  const availableConnectors = useMemo(
    () => CONNECTORS.filter((c) => !configs[c.id] && matchQ(c.name, c.purpose)),
    [configs, matchQ],
  );

  const showConnected = filter === "all" || filter === "connected";
  const showAvailable = filter === "all" || filter === "available";
  const empty =
    (filter === "connected" && builtIns.length + connectedConnectors.length === 0) ||
    (filter === "available" && availableConnectors.length === 0) ||
    (filter === "all" && builtIns.length + connectedConnectors.length + availableConnectors.length === 0);

  const inspectedTool = inspectBuiltIn ? BUILTIN_TOOLS.find((t) => t.name === inspectBuiltIn) ?? null : null;
  const disconnecting = disconnectId ? CONNECTORS.find((c) => c.id === disconnectId) ?? null : null;

  const rowStyle: React.CSSProperties = {
    background: "var(--ds-surface)",
    border: "1px solid var(--ds-border)",
    borderRadius: "var(--ds-radius-lg)",
    padding: "14px 16px",
  };

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Integrations"
          description="Built-in runtime tools and the services VOW can connect to — with approval rules up front."
        />

        <div style={{ display: "flex", gap: "var(--ds-space-3)", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "var(--ds-space-5)" }}>
          <div style={{ minWidth: 220, flex: "1 1 240px" }}>
            <Field label="Search integrations">
              {(id) => <Input id={id} placeholder="Filter by name or purpose…" value={query} onChange={(e) => setQuery(e.target.value)} />}
            </Field>
          </div>
          <Segmented label="Connection filter" value={filter} onChange={setFilter} options={[
            { value: "all", label: "All" },
            { value: "connected", label: "Connected" },
            { value: "available", label: "Available" },
          ]} />
        </div>

        {empty ? (
          <EmptyState
            title="No integrations match"
            body="Try a different search, or clear the filter."
            action={{ label: "Clear search", onPress: () => { setQuery(""); setFilter("all"); } }}
          />
        ) : (
          <div style={{ display: "grid", gap: "var(--ds-space-6)" }}>
            {showConnected ? (
              <section aria-label="Connected">
                <h2 style={{ fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)", margin: "0 0 var(--ds-space-3)" }}>Connected</h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-3)" }}>
                  {builtIns.map((t) => (
                    <li key={t.name} style={rowStyle}>
                      <RowBody
                        name={t.name}
                        purpose={t.purpose}
                        meta={t.wardenNote}
                        permission={t.permission}
                        connected
                        sub="Built into the runtime"
                        action={<Button variant="secondary" size="sm" onClick={() => setInspectBuiltIn(t.name)}>Configure</Button>}
                      />
                    </li>
                  ))}
                  {connectedConnectors.map((c) => {
                    const cfg = configs[c.id];
                    return (
                      <li key={c.id} style={rowStyle}>
                        <RowBody
                          name={c.name}
                          purpose={c.purpose}
                          meta={cfg ? `Saved on this device · preview only, not a live connection` : undefined}
                          permission={c.permission}
                          scopes={c.scopes}
                          connected
                          action={<Button variant="secondary" size="sm" onClick={() => setDisconnectId(c.id)}>Disconnect</Button>}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {showAvailable && availableConnectors.length > 0 ? (
              <section aria-label="Available">
                <h2 style={{ fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)", margin: "0 0 var(--ds-space-3)" }}>Available</h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-3)" }}>
                  {availableConnectors.map((c) => (
                    <li key={c.id} style={rowStyle}>
                      <RowBody
                        name={c.name}
                        purpose={c.purpose}
                        permission={c.permission}
                        scopes={c.scopes}
                        connected={false}
                        action={<Button variant="secondary" size="sm" onClick={() => openWizard(c.id)}>Connect</Button>}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        <Drawer title={inspectedTool ? `Configure ${inspectedTool.name}` : "Configure tool"} open={inspectedTool !== null} onClose={() => setInspectBuiltIn(null)}>
          {inspectedTool ? (
            <div style={{ display: "grid", gap: "var(--ds-space-4)" }}>
              <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)", lineHeight: 1.6 }}>{inspectedTool.purpose}</p>
              <div style={{ display: "flex", gap: "var(--ds-space-2)", alignItems: "center" }}>
                <PermissionBadge level={inspectedTool.permission} />
                <StatusDot connected />
              </div>
              <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.6 }}>{inspectedTool.wardenNote} Built-in tools cannot be removed; approval policy is set by Warden, not here.</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="secondary" size="sm" onClick={() => setInspectBuiltIn(null)}>Done</Button>
              </div>
            </div>
          ) : null}
        </Drawer>

        <Drawer title={wizardOpen ? `Connect ${connector.name}` : "Connect"} open={wizardOpen} onClose={() => setWizardOpen(false)}>
          <div style={{ display: "grid", gap: "var(--ds-space-5)" }}>
            <Stepper label="Connection steps" steps={WIZARD_STEPS} current={step} onChange={setStep} />

            {step === 0 ? (
              <Field label="Choose a service">
                {(id) => (
                  <Select id={id} value={connectorId} onChange={(e) => {
                    const c = CONNECTORS.find((x) => x.id === e.target.value) ?? CONNECTORS[0];
                    setConnectorId(c.id);
                    setScopes(c.scopes);
                  }}>
                    {CONNECTORS.filter((c) => !configs[c.id]).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} — {c.purpose}</option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            {step === 1 ? (
              <Field label="Authentication method">
                {(id) => (
                  <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as "oauth" | "token")}>
                    <option value="oauth">Sign in with the provider (OAuth)</option>
                    <option value="token">Paste an API token (stays on this device)</option>
                  </Select>
                )}
              </Field>
            ) : null}

            {step === 2 ? (
              <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                <fieldset style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "12px 14px", margin: 0 }}>
                  <legend style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", padding: "0 6px" }}>Scopes to request</legend>
                  <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
                    {connector.scopes.map((s) => (
                      <Checkbox
                        key={s}
                        label={s}
                        checked={scopes.includes(s)}
                        onChange={() => setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                      />
                    ))}
                  </div>
                </fieldset>
                <Switch label="Require approval for writes" checked={requireApproval} onCheckedChange={setRequireApproval} />
              </div>
            ) : null}

            {step === 3 ? (
              <div style={{ display: "grid", gap: "var(--ds-space-3)", fontSize: "var(--ds-text-14)", color: "var(--ds-ink)", lineHeight: 1.6 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{connector.name} — what this connection means</p>
                <SummaryList title="VOW can read" items={connector.canRead} />
                <SummaryList title="VOW can change" items={connector.canChange} />
                <SummaryList title="VOW cannot touch" items={connector.cannotTouch} />
                {connector.requiresApproval.length > 0 ? <SummaryList title="Actions that will require approval" items={connector.requiresApproval} /> : null}
                <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                  Method: {method === "oauth" ? "provider sign-in" : "device-stored token"} · Scopes: {scopes.length > 0 ? scopes.join(", ") : "none selected"} · Writes {requireApproval ? "need approval" : "run without approval"}.
                </p>
              </div>
            ) : null}

            {step === 3 ? (
              <p role="note" style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "10px 14px", background: "var(--ds-bg)" }}>
                Live connections are not yet available in this build, so this review is a preview of what connecting would request. Nothing is sent anywhere.
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "var(--ds-space-2)", justifyContent: "space-between" }}>
              <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Button>
              {step < 3 ? (
                <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.min(3, s + 1))}>Continue</Button>
              ) : (
                <Button variant="secondary" size="sm" disabled title="Live connections are not yet available">Not yet available</Button>
              )}
            </div>
          </div>
        </Drawer>

        <Dialog
          title={disconnecting ? `Disconnect ${disconnecting.name}?` : "Disconnect?"}
          open={disconnectId !== null}
          onClose={() => setDisconnectId(null)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setDisconnectId(null)}>Keep</Button>
              <Button variant="destructive" size="sm" onClick={confirmDisconnect}>Disconnect</Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>VOW will stop using this connection on this device. Past task history is unchanged.</p>
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}

function RowBody({
  name,
  purpose,
  meta,
  permission,
  scopes,
  connected,
  sub,
  action,
}: {
  name: string;
  purpose: string;
  meta?: string;
  permission: React.ComponentProps<typeof PermissionBadge>["level"];
  scopes?: string[];
  connected: boolean;
  sub?: string;
  action: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 240px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
          <p style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)" }}>{name}</p>
          <StatusDot connected={connected} />
        </div>
        <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.55 }}>{purpose}</p>
        {scopes && scopes.length > 0 ? (
          <p style={{ margin: "6px 0 0", fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-muted)", overflowWrap: "anywhere" }}>
            {scopes.join(" · ")}
          </p>
        ) : null}
        {meta || sub ? (
          <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>{[sub, meta].filter(Boolean).join(" · ")}</p>
        ) : null}
        <div style={{ marginTop: "var(--ds-space-2)" }}>
          <PermissionBadge level={permission} />
        </div>
      </div>
      <div style={{ marginLeft: "auto", flex: "none" }}>{action}</div>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p style={{ margin: "0 0 4px", fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)" }}>{title}</p>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
        {items.map((i) => (
          <li key={i} style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-ink-soft)" }}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
