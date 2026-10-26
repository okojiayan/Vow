"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Plus, Trash2, Upload } from "lucide-react";
import { relativeTime } from "@/lib/relative-time";
import { formatRecordSource, isDiagnosticMemory } from "@/lib/memory-display";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/fields";
import { Dialog, Toast } from "@/components/ui/overlays";
import { Finder, type FinderGroup, type FinderItem } from "@/components/finder/Finder";

interface Rec {
  id: string;
  content: string;
  kind: string;
  provenance?: unknown;
  source?: unknown;
  updatedAt?: string;
  createdAt?: string;
}

const COLLECTIONS_KEY = "vow-collections";

function provenanceOf(r: Rec): string {
  if (typeof r.provenance === "string" && r.provenance.trim()) return r.provenance;
  return formatRecordSource(r.source ?? r.provenance);
}

function groupLabel(kind: string): string {
  const k = kind.toLowerCase();
  if (k === "document") return "Documents";
  if (k === "saved" || k === "note") return "Notes";
  return "Facts and preferences";
}

export default function LibraryPage() {
  const { effective } = useTheme();
  const router = useRouter();
  const [records, setRecords] = useState<Rec[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [showSave, setShowSave] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await fetch("/api/memory").then((r) => r.json());
      setRecords(Array.isArray(payload.records) ? payload.records : []);
    } catch {
      setRecords([]);
    } finally {
      setLoaded(true);
    }
    try {
      const raw = window.localStorage.getItem(COLLECTIONS_KEY);
      setCollections(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setCollections([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const save = useCallback(async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), kind: "saved" }),
      });
      if (!res.ok) throw new Error("Save failed.");
      setContent("");
      setShowSave(false);
      flash("Saved to Knowledge.");
      await load();
    } catch {
      flash("Could not save that note.");
    } finally {
      setSaving(false);
    }
  }, [content, flash, load, saving]);

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      setRecords((prev) => prev.filter((r) => r.id !== id));
      flash("Removed from Knowledge.");
    } catch {
      flash("Could not remove that entry.");
    }
  }, [flash]);

  const addCollection = useCallback(() => {
    const name = window.prompt("Collection name:", "Research");
    if (!name || !name.trim()) return;
    try {
      const raw = window.localStorage.getItem(COLLECTIONS_KEY);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      if (!arr.includes(name.trim())) arr.push(name.trim());
      window.localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(arr));
      setCollections(arr);
      flash(`Collection “${name.trim()}” created on this device.`);
    } catch {
      flash("Could not create collection — storage unavailable.");
    }
  }, [flash]);

  const removeCollection = useCallback((name: string) => {
    try {
      const next = collections.filter((c) => c !== name);
      window.localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(next));
      setCollections(next);
      flash(`Collection “${name}” removed.`);
    } catch {
      flash("Could not remove that collection.");
    }
  }, [collections, flash]);

  const clean = useMemo(() => records.filter((r) => !isDiagnosticMemory(r)), [records]);

  const groups: FinderGroup[] = useMemo(() => {
    const out: FinderGroup[] = [];
    if (filter === "all" || filter === "items") {
      const byGroup = new Map<string, Rec[]>();
      for (const r of clean) {
        const g = groupLabel(r.kind);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)?.push(r);
      }
      for (const [label, items] of byGroup) {
        out.push({
          key: label,
          label,
          items: items.map((r) => ({
            id: `item:${r.id}`,
            title: r.content.slice(0, 140),
            meta: `${r.kind} · ${provenanceOf(r)}`,
          })),
        });
      }
    }
    if ((filter === "all" || filter === "collections") && collections.length > 0) {
      out.push({
        key: "collections",
        label: "Collections",
        items: collections.map((c) => ({ id: `collection:${c}`, title: c, meta: "Collection on this device" })),
      });
    }
    return out;
  }, [clean, collections, filter]);

  const findItem = useCallback((item: FinderItem) => {
    const idx = item.id.indexOf(":");
    const ns = item.id.slice(0, idx);
    const raw = item.id.slice(idx + 1);
    if (ns === "item") return { ns, rec: clean.find((r) => r.id === raw) ?? null };
    return { ns, rec: null };
  }, [clean]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Knowledge"
          description="Saved notes, documents, and collections — everything backed by memory."
          action={<Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setShowSave(true)}>Save note</Button>}
        />

        <div style={{ display: "flex", gap: "var(--ds-space-2)", marginBottom: "var(--ds-space-4)" }}>
          <Button variant="secondary" size="sm" icon={<Upload size={15} aria-hidden="true" />} onClick={() => router.push("/?attach=1")}>Upload</Button>
          <Button variant="secondary" size="sm" icon={<FolderPlus size={15} aria-hidden="true" />} onClick={addCollection}>New collection</Button>
        </div>

        {!loaded ? (
          <p style={{ color: "var(--ds-muted)", fontSize: "var(--ds-text-14)" }} aria-live="polite">Loading knowledge…</p>
        ) : (
          <Finder
            placeholder="Search notes, documents, and collections…"
            filterLabel="Show"
            filterOptions={[
              { value: "all", label: "All" },
              { value: "items", label: "Items" },
              { value: "collections", label: "Collections" },
            ]}
            filterValue={filter}
            onFilter={setFilter}
            groups={groups}
            emptyTitle={clean.length === 0 && collections.length === 0 ? "Nothing saved yet" : "No matches"}
            emptyBody={clean.length === 0 && collections.length === 0 ? "Save a note above — it persists and appears here instantly." : "Try a different search or filter."}
            previewTitle="Preview"
            renderPreview={(item) => {
              const found = findItem(item);
              if (found.ns === "collection") {
                const name = item.id.slice("collection:".length);
                return (
                  <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)" }}>{name}</p>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>Collection on this device.</p>
                    <div>
                      <Button variant="ghost" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => removeCollection(name)} aria-label={`Remove collection ${name}`}>Remove</Button>
                    </div>
                  </div>
                );
              }
              const r = found.rec as Rec | null;
              if (!r) return <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>That entry is no longer available.</p>;
              return (
                <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                  <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)", lineHeight: 1.6, overflowWrap: "break-word" }}>{r.content}</p>
                  <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                    {r.kind} · {provenanceOf(r)}{r.updatedAt ?? r.createdAt ? ` · ${relativeTime((r.updatedAt ?? r.createdAt) as string) ?? ""}` : ""}
                  </p>
                  <div>
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => void remove(r.id)} aria-label={`Remove entry ${r.id.slice(0, 8)}`}>Remove</Button>
                  </div>
                </div>
              );
            }}
          />
        )}

        <Dialog
          title="Save note"
          open={showSave}
          onClose={() => setShowSave(false)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowSave(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>Save</Button>
            </>
          }
        >
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "grid", gap: "var(--ds-space-4)" }}>
            <Field label="Note">
              {(id) => <Textarea id={id} rows={4} required placeholder="Save anything worth remembering…" value={content} onChange={(e) => setContent(e.target.value)} />}
            </Field>
          </form>
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}
