"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Checkbox, Switch } from "@/components/ui/fields";
import { Menu, Dialog, Drawer, Toast } from "@/components/ui/overlays";
import { EmptyState } from "@/components/ui/feedback";
import { PermissionBadge } from "@/components/ui/badges";
import { BUILTIN_TOOLS } from "@/lib/runtime-inventory";

interface Routine {
  id: string;
  name: string;
  kind: "daily" | "weekdays" | "push" | "pr";
  time?: string;
  branch?: string;
  tools: string[];
  enabled: boolean;
  createdAt: string;
}

const STORE_KEY = "vow-routines-v2";

function loadRoutines(): Routine[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Routine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function describeSchedule(r: Routine): string {
  if (r.kind === "daily") return `Every day at ${r.time ?? "8:00"}`;
  if (r.kind === "weekdays") return `Every weekday at ${r.time ?? "8:00"}`;
  if (r.kind === "push") return `On git push to ${r.branch ?? "main"}`;
  return "When a pull request is opened";
}

function needsApproval(r: Routine): boolean {
  return r.tools.some((name) => BUILTIN_TOOLS.find((t) => t.name === name)?.permission !== "read");
}

function preview(kind: Routine["kind"], time: string, branch: string, tools: string[]): string {
  const r: Routine = { id: "", name: "", kind, time, branch, tools, enabled: true, createdAt: "" };
  return `${describeSchedule(r)}. ${needsApproval(r) ? "Needs approval for writes." : "Reads only; runs without approval."}`;
}

export default function RoutinesPage() {
  const { effective } = useTheme();
  const router = useRouter();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<Routine["kind"]>("weekdays");
  const [time, setTime] = useState("8:00");
  const [branch, setBranch] = useState("main");
  const [tools, setTools] = useState<string[]>(["fs.read", "notes.create"]);

  useEffect(() => {
    setRoutines(loadRoutines());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(routines));
    } catch {
      /* storage unavailable */
    }
  }, [routines]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const openNew = useCallback(() => {
    setEditingId(null);
    setName("");
    setKind("weekdays");
    setTime("8:00");
    setBranch("main");
    setTools(["fs.read", "notes.create"]);
    setDrawerOpen(true);
  }, []);

  const openEdit = useCallback((r: Routine) => {
    setEditingId(r.id);
    setName(r.name);
    setKind(r.kind);
    setTime(r.time ?? "8:00");
    setBranch(r.branch ?? "main");
    setTools(r.tools);
    setDrawerOpen(true);
  }, []);

  const save = useCallback(() => {
    if (!name.trim()) return;
    const entry: Routine = {
      id: editingId ?? `routine-${Date.now()}`,
      name: name.trim(),
      kind,
      time: kind === "daily" || kind === "weekdays" ? time : undefined,
      branch: kind === "push" ? branch.trim() || "main" : undefined,
      tools,
      enabled: editingId ? routines.find((r) => r.id === editingId)?.enabled ?? true : true,
      createdAt: editingId ? routines.find((r) => r.id === editingId)?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
    };
    setRoutines((prev) => (editingId ? prev.map((r) => (r.id === editingId ? entry : r)) : [entry, ...prev]));
    setDrawerOpen(false);
    flash(editingId ? "Routine updated." : "Routine created.");
  }, [branch, editingId, flash, kind, name, routines, time, tools]);

  const duplicate = useCallback((id: string) => {
    setRoutines((prev) => {
      const src = prev.find((r) => r.id === id);
      if (!src) return prev;
      return [{ ...src, id: `routine-${Date.now()}`, name: `${src.name} (copy)`, createdAt: new Date().toISOString() }, ...prev];
    });
    flash("Routine duplicated.");
  }, [flash]);

  const confirmDelete = useCallback(() => {
    if (!deleteId) return;
    setRoutines((prev) => prev.filter((r) => r.id !== deleteId));
    setDeleteId(null);
    flash("Routine deleted.");
  }, [deleteId, flash]);

  const runNow = useCallback(async (r: Routine) => {
    setRunningId(r.id);
    try {
      const res = await fetch("/api/agent/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `Routine "${r.name}": ${describeSchedule(r)}. Permitted tools: ${r.tools.join(", ") || "none"}.` }),
      });
      if (!res.ok) throw new Error("Could not start the routine.");
      flash("Routine started — follow it in Tasks.");
      router.push("/tasks");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not start the routine.");
    } finally {
      setRunningId(null);
    }
  }, [flash, router]);

  const toggleTool = useCallback((tool: string) => {
    setTools((prev) => (prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]));
  }, []);

  const deleting = useMemo(() => routines.find((r) => r.id === deleteId) ?? null, [deleteId, routines]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Routines"
          description="Recurring agent work, in plain language. Runs are tracked as tasks."
          action={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={openNew}>New routine</Button>}
        />

        {routines.length === 0 ? (
          <EmptyState
            title="No routines yet"
            body="Describe a schedule in plain language — for example, a weekday briefing — and VOW will track each run as a task."
            mascot="normal"
            action={{ label: "New routine", onPress: openNew }}
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-3)" }}>
            {routines.map((r) => (
              <li
                key={r.id}
                style={{
                  background: "var(--ds-surface)",
                  border: "1px solid var(--ds-border)",
                  borderRadius: "var(--ds-radius-lg)",
                  padding: "14px 16px",
                  opacity: r.enabled ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)", overflowWrap: "break-word" }}>{r.name}</p>
                    <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>{describeSchedule(r)}</p>
                    <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                      Last run: <span>Not run yet</span>
                      {needsApproval(r) ? " · Warden approval required for writes" : " · reads only"}
                    </p>
                    <div style={{ display: "flex", gap: "var(--ds-space-2)", flexWrap: "wrap", marginTop: "var(--ds-space-2)" }}>
                      {r.tools.map((t) => {
                        const def = BUILTIN_TOOLS.find((b) => b.name === t);
                        return def ? <PermissionBadge key={t} level={def.permission} /> : null;
                      })}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-2)", marginLeft: "auto" }}>
                    <Switch label={r.enabled ? `Disable ${r.name}` : `Enable ${r.name}`} checked={r.enabled} onCheckedChange={() => setRoutines((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)))} />
                    <Menu
                      label={`Actions for ${r.name}`}
                      items={[
                        { label: "Run now", onSelect: () => void runNow(r) },
                        { label: "Edit", onSelect: () => openEdit(r) },
                        { label: "Duplicate", onSelect: () => duplicate(r.id) },
                        { label: "Delete", danger: true, onSelect: () => setDeleteId(r.id) },
                      ]}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Drawer title={editingId ? "Edit routine" : "New routine"} open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <div style={{ display: "grid", gap: "var(--ds-space-4)" }}>
            <Field label="Routine name">
              {(id) => <Input id={id} placeholder="Weekday briefing" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Schedule">
              {(id) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Routine["kind"])}>
                  <option value="daily">Every day at…</option>
                  <option value="weekdays">Every weekday at…</option>
                  <option value="push">On git push to…</option>
                  <option value="pr">On pull request opened</option>
                </Select>
              )}
            </Field>
            {kind === "daily" || kind === "weekdays" ? (
              <Field label="Time">
                {(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
              </Field>
            ) : null}
            {kind === "push" ? (
              <Field label="Branch">
                {(id) => <Input id={id} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />}
              </Field>
            ) : null}
            <fieldset style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "12px 14px", margin: 0 }}>
              <legend style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-muted)", padding: "0 6px" }}>Permitted tools</legend>
              <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
                {BUILTIN_TOOLS.map((t) => (
                  <Checkbox key={t.name} label={`${t.name} — ${t.purpose}`} checked={tools.includes(t.name)} onChange={() => toggleTool(t.name)} />
                ))}
              </div>
            </fieldset>
            <p role="status" style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "10px 14px", background: "var(--ds-bg)" }}>
              {preview(kind, time, branch, tools)}
            </p>
            <div style={{ display: "flex", gap: "var(--ds-space-2)", justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={!name.trim()} onClick={save}>{editingId ? "Save changes" : "Create routine"}</Button>
            </div>
          </div>
        </Drawer>

        <Dialog
          title="Delete this routine?"
          open={deleteId !== null}
          onClose={() => setDeleteId(null)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>Keep</Button>
              <Button variant="destructive" size="sm" onClick={confirmDelete}>Delete routine</Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {deleting ? `“${deleting.name}” will stop running. ` : ""}Past task runs stay in Tasks; only the schedule is removed.
          </p>
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
        {runningId ? <p aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Starting routine…</p> : null}
      </div>
    </div>
  );
}
