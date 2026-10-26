"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { relativeTime } from "@/lib/relative-time";
import { formatRecordSource, isDiagnosticMemory } from "@/lib/memory-display";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Tabs } from "@/components/ui/Tabs";
import { Dialog, Toast } from "@/components/ui/overlays";
import { EmptyState, InlineBanner } from "@/components/ui/feedback";

interface RawRecord {
  id: string;
  content: string;
  kind?: string;
  provenance?: unknown;
  source?: unknown;
  createdAt?: string;
  updatedAt?: string;
  keywords?: string[];
}

function provenanceOf(r: RawRecord): string {
  if (typeof r.provenance === "string" && r.provenance.trim()) return r.provenance;
  return formatRecordSource(r.source ?? r.provenance);
}

function dateOf(r: RawRecord): string | undefined {
  return r.updatedAt ?? r.createdAt;
}

export default function MemoryPage() {
  const { effective } = useTheme();
  const [records, setRecords] = useState<RawRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState("saved");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newKind, setNewKind] = useState("observation");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory").then((r) => r.json());
      setRecords(Array.isArray(res.records) ? (res.records as RawRecord[]) : []);
      setLoadError(null);
    } catch {
      setLoadError("Memory could not be loaded. Showing nothing rather than stale entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const handleAdd = useCallback(async () => {
    if (!newContent.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent.trim(), kind: newKind }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not save memory.");
      setNewContent("");
      setShowAdd(false);
      flash("Memory saved.");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not save memory.");
    } finally {
      setSaving(false);
    }
  }, [flash, load, newContent, newKind, saving]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      setRecords((prev) => prev.filter((r) => r.id !== id));
      flash("Memory removed.");
    } catch {
      flash("Could not remove that memory.");
    }
  }, [flash]);

  const startEdit = useCallback((r: RawRecord) => {
    setEditingId(r.id);
    setEditContent(r.content);
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    if (!editContent.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not update memory.");
      setEditingId(null);
      flash("Memory updated.");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not update memory.");
    } finally {
      setSaving(false);
    }
  }, [editContent, flash, load, saving]);

  const diagnostics = useMemo(() => records.filter(isDiagnosticMemory), [records]);
  const saved = useMemo(() => records.filter((r) => !isDiagnosticMemory(r)), [records]);

  const visible = useMemo(() => {
    const base = tab === "diagnostics" ? diagnostics : saved;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => r.content.toLowerCase().includes(q) || provenanceOf(r).toLowerCase().includes(q));
  }, [diagnostics, saved, search, tab]);

  const stats = useMemo(() => {
    const sources = new Set(saved.map((r) => provenanceOf(r)));
    let latest: string | undefined;
    for (const r of saved) {
      const d = dateOf(r);
      if (d && (!latest || d > latest)) latest = d;
    }
    return { count: saved.length, sources: sources.size, updated: latest ? relativeTime(latest) : null, diag: diagnostics.length };
  }, [diagnostics.length, saved]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Memory"
          description="Preferences, facts, and documents VOW remembers — yours to edit or remove."
          action={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setShowAdd(true)}>Add memory</Button>}
        />

        {loadError ? <InlineBanner tone="error" title="Memory unavailable" body={loadError} /> : null}

        <p
          role="status"
          style={{
            margin: "0 0 var(--ds-space-4)",
            fontSize: "var(--ds-text-13)",
            color: "var(--ds-muted)",
            border: "1px solid var(--ds-border)",
            borderRadius: "var(--ds-radius-md)",
            background: "var(--ds-surface)",
            padding: "8px 14px",
          }}
        >
          {loading ? "Loading memory…" : `${stats.count} saved · ${stats.sources} sources${stats.updated ? ` · updated ${stats.updated}` : ""} · ${stats.diag} diagnostics`}
        </p>

        <Tabs
          label="Memory sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "saved", label: `Saved (${saved.length})` },
            { value: "diagnostics", label: `Diagnostics (${diagnostics.length})` },
          ]}
        />

        {tab === "diagnostics" ? (
          <InlineBanner tone="info" title="System entries live here" body="Verifier output, Warden decisions, tool failures, and task-completion receipts are kept out of Saved so the default view stays clean." />
        ) : null}

        <div style={{ margin: "var(--ds-space-4) 0", maxWidth: 440 }}>
          <Field label={tab === "diagnostics" ? "Search diagnostics" : "Search saved memory"}>
            {(id) => <Input id={id} placeholder="Filter by text or source…" value={search} onChange={(e) => setSearch(e.target.value)} />}
          </Field>
        </div>

        {loading ? (
          <p style={{ color: "var(--ds-muted)", fontSize: "var(--ds-text-14)" }} aria-live="polite">Loading memory…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            title={tab === "diagnostics" ? "No diagnostic entries" : records.length === 0 ? "No memories yet" : "No memories match"}
            body={tab === "diagnostics" ? "No verifier, Warden, or tool-failure entries recorded." : records.length === 0 ? "Things you ask VOW to remember will appear here." : "Try a different search."}
            mascot={tab === "saved" && records.length === 0 ? "normal" : undefined}
            action={tab === "saved" && records.length === 0 ? { label: "Add a memory", onPress: () => setShowAdd(true) } : undefined}
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--ds-space-3)" }}>
            {visible.map((r) => {
              const sys = isDiagnosticMemory(r);
              const editing = editingId === r.id;
              return (
                <li
                  key={r.id}
                  style={{
                    background: "var(--ds-surface)",
                    border: "1px solid var(--ds-border)",
                    borderRadius: "var(--ds-radius-lg)",
                    padding: "14px 16px",
                  }}
                >
                  {editing ? (
                    <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                      <Field label="Edit memory">
                        {(id) => <Textarea id={id} rows={3} value={editContent} onChange={(e) => setEditContent(e.target.value)} />}
                      </Field>
                      <div style={{ display: "flex", gap: "var(--ds-space-2)" }}>
                        <Button variant="primary" size="sm" loading={saving} onClick={() => void saveEdit(r.id)}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)", lineHeight: 1.55, overflowWrap: "break-word" }}>{r.content}</p>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)", flexWrap: "wrap", marginTop: "var(--ds-space-3)" }}>
                        <span style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                          {provenanceOf(r)}{dateOf(r) ? ` · ${relativeTime(dateOf(r)) ?? "recently"}` : ""}
                        </span>
                        {r.kind ? (
                          <span style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-pill)", padding: "1px 10px" }}>{r.kind}</span>
                        ) : null}
                        <span style={{ marginLeft: "auto", display: "inline-flex", gap: "var(--ds-space-2)" }}>
                          {!sys ? (
                            <Button variant="ghost" size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => startEdit(r)} aria-label={`Edit memory ${r.id.slice(0, 8)}`}>
                              Edit
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => void handleDelete(r.id)} aria-label={`Delete memory ${r.id.slice(0, 8)}`}>
                            Delete
                          </Button>
                        </span>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Dialog
          title="Add memory"
          open={showAdd}
          onClose={() => setShowAdd(false)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={() => void handleAdd()}>Save memory</Button>
            </>
          }
        >
          <form onSubmit={(e) => { e.preventDefault(); void handleAdd(); }} style={{ display: "grid", gap: "var(--ds-space-4)" }}>
            <Field label="Kind">
              {(id) => (
                <Select id={id} value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                  <option value="observation">Observation</option>
                  <option value="preference">Preference</option>
                  <option value="semantic">Fact</option>
                  <option value="saved">Saved note</option>
                </Select>
              )}
            </Field>
            <Field label="Memory">
              {(id) => <Textarea id={id} rows={3} required placeholder="e.g. Prefers morning standup summaries." value={newContent} onChange={(e) => setNewContent(e.target.value)} />}
            </Field>
          </form>
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}
