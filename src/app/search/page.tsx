"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/relative-time";
import { formatRecordSource, isDiagnosticMemory } from "@/lib/memory-display";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Finder, type FinderGroup, type FinderItem } from "@/components/finder/Finder";

interface MemHit {
  id: string;
  content?: string;
  kind?: string;
  provenance?: unknown;
  source?: unknown;
  updatedAt?: string;
  createdAt?: string;
}

interface TaskHit {
  id: string;
  request: string;
  status: string;
  queuedAt?: string | null;
  updatedAt?: string;
}

function provenanceOf(m: MemHit): string {
  if (typeof m.provenance === "string" && m.provenance.trim()) return m.provenance;
  return formatRecordSource(m.source ?? m.provenance);
}

export default function SearchPage() {
  const { effective } = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [mem, setMem] = useState<MemHit[]>([]);
  const [tasks, setTasks] = useState<TaskHit[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [m, t] = await Promise.all([
          fetch("/api/memory").then((r) => r.json()).catch(() => ({ records: [] })),
          fetch("/api/agent").then((r) => r.json()).catch(() => ({ tasks: [] })),
        ]);
        if (!live) return;
        setMem(Array.isArray(m.records) ? m.records : []);
        setTasks(Array.isArray(t.tasks) ? t.tasks : []);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => { live = false; };
  }, []);

  const cleanMem = useMemo(() => mem.filter((m) => !isDiagnosticMemory(m)), [mem]);

  const groups: FinderGroup[] = useMemo(() => {
    const out: FinderGroup[] = [];
    if (filter === "all" || filter === "chats") {
      out.push({
        key: "tasks",
        label: "Tasks and chats",
        items: tasks.map((t) => ({
          id: `task:${t.id}`,
          title: t.request,
          meta: `${t.status} · ${relativeTime(t.queuedAt ?? t.updatedAt) ?? "recently"}`,
        })),
      });
    }
    if (filter === "all" || filter === "memories") {
      out.push({
        key: "memories",
        label: "Memories",
        items: cleanMem.map((m) => ({
          id: `memory:${m.id}`,
          title: (m.content ?? "").slice(0, 140),
          meta: `${m.kind ?? "memory"} · ${provenanceOf(m)}`,
        })),
      });
    }
    return out;
  }, [cleanMem, filter, tasks]);

  const byId = useCallback((item: FinderItem) => {
    const [ns, ...rest] = item.id.split(":");
    const raw = rest.join(":");
    if (ns === "task") return { ns, rec: tasks.find((t) => t.id === raw) ?? null };
    return { ns, rec: cleanMem.find((m) => m.id === raw) ?? null };
  }, [cleanMem, tasks]);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Search"
          description="Find anything VOW remembers — chats, tasks, and saved memory."
        />
        {!loaded ? (
          <p style={{ color: "var(--ds-muted)", fontSize: "var(--ds-text-14)" }} aria-live="polite">Loading index…</p>
        ) : (
          <Finder
            placeholder="Search chats, tasks, and memory…"
            filterLabel="Result types"
            filterOptions={[
              { value: "all", label: "All" },
              { value: "chats", label: "Chats" },
              { value: "memories", label: "Memories" },
            ]}
            filterValue={filter}
            onFilter={setFilter}
            groups={groups}
            emptyTitle="No matches"
            emptyBody="Try a shorter phrase, or browse recent tasks and memories."
            previewTitle="Preview"
            renderPreview={(item) => {
              const found = byId(item);
              if (found.ns === "task" && found.rec) {
                const t = found.rec as TaskHit;
                return (
                  <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)", overflowWrap: "break-word" }}>{t.request}</p>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                      {t.status} · started {relativeTime(t.queuedAt ?? t.updatedAt) ?? "recently"}
                    </p>
                    <div>
                      <Button variant="secondary" size="sm" onClick={() => router.push(`/?task=${t.id}`)}>Open in Chat</Button>
                    </div>
                  </div>
                );
              }
              if (found.ns === "memory" && found.rec) {
                const m = found.rec as MemHit;
                return (
                  <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-ink)", lineHeight: 1.6, overflowWrap: "break-word" }}>{m.content}</p>
                    <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                      {(m.kind ?? "memory")} · {provenanceOf(m)}{m.updatedAt ?? m.createdAt ? ` · ${relativeTime((m.updatedAt ?? m.createdAt) as string) ?? ""}` : ""}
                    </p>
                  </div>
                );
              }
              return <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>That result is no longer available.</p>;
            }}
          />
        )}
      </div>
    </div>
  );
}
