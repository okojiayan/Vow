"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { relativeTime } from "@/lib/relative-time";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Finder, type FinderGroup, type FinderItem } from "@/components/finder/Finder";

interface TraceEvent {
  id: string;
  kind: string;
  title: string;
  detail?: string;
  createdAt?: string;
}

interface TaskLite {
  id: string;
  request: string;
  status: string;
  queuedAt?: string | null;
  updatedAt?: string;
}

/** Withhold sensitive-command text from log views; the entry stays, the payload does not. */
function redact(text: string): string {
  if (/(rm\s+-rf|\bpasswd\b|\bcurl\b|\bwget\b|shell\.exec|http\.fetch|bearer\s|sk-[a-z0-9]{8})/i.test(text)) {
    return "[command withheld — shown as metadata only]";
  }
  return text;
}

export default function HistoryPage() {
  const { effective } = useTheme();
  const router = useRouter();
  const [traces, setTraces] = useState<Array<{ taskId: string; events: TraceEvent[] }>>([]);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [copiedTask, setCopiedTask] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [tr, t] = await Promise.all([
          fetch("/api/traces/all").then((r) => r.json()).catch(() => ({ traces: [] })),
          fetch("/api/agent").then((r) => r.json()).catch(() => ({ tasks: [] })),
        ]);
        if (!live) return;
        setTraces(Array.isArray(tr.traces) ? tr.traces : []);
        setTasks(Array.isArray(t.tasks) ? t.tasks : []);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => { live = false; };
  }, []);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const groups: FinderGroup[] = useMemo(() => {
    const list = traces.filter((tr) => {
      if (filter === "recent") {
        const t = taskById.get(tr.taskId);
        try {
          return !!t?.queuedAt && Date.now() - Date.parse(t.queuedAt) < 24 * 3600 * 1000;
        } catch {
          return false;
        }
      }
      return tr.events.length > 0;
    });
    return list.map((tr) => {
      const t = taskById.get(tr.taskId);
      const label = t ? t.request.slice(0, 48) : `Untitled run ${tr.taskId.slice(0, 8)}`;
      return {
        key: tr.taskId,
        label: `${label}`,
        items: tr.events.map((e) => ({
          id: `${tr.taskId}::${e.id}`,
          title: redact(e.title).slice(0, 140),
          meta: `${e.kind}${e.createdAt ? ` · ${relativeTime(e.createdAt) ?? ""}` : ""}`,
        })),
      };
    });
  }, [filter, taskById, traces]);

  const findEvent = (item: FinderItem): { taskId: string; event: TraceEvent | null } => {
    const idx = item.id.indexOf("::");
    const taskId = item.id.slice(0, idx);
    const eventId = item.id.slice(idx + 2);
    const tr = traces.find((x) => x.taskId === taskId);
    return { taskId, event: tr?.events.find((e) => e.id === eventId) ?? null };
  };

  const copyTaskId = async (taskId: string) => {
    try {
      await navigator.clipboard.writeText(taskId);
    } catch {
      /* clipboard unavailable */
    }
    setCopiedTask(true);
    window.setTimeout(() => setCopiedTask(false), 2000);
  };

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="History"
          description="Every recorded run, step by step — approvals, checks, and outcomes."
        />
        {!loaded ? (
          <p style={{ color: "var(--ds-muted)", fontSize: "var(--ds-text-14)" }} aria-live="polite">Loading history…</p>
        ) : (
          <Finder
            placeholder="Search steps and events…"
            filterLabel="Range"
            filterOptions={[
              { value: "all", label: "All runs" },
              { value: "recent", label: "Last 24h" },
            ]}
            filterValue={filter}
            onFilter={setFilter}
            groups={groups}
            emptyTitle="No recorded history"
            emptyBody="Finished and in-progress runs leave their trace here."
            previewTitle="Event"
            renderPreview={(item) => {
              const { taskId, event } = findEvent(item);
              if (!event) return <p style={{ margin: 0, fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>That event is no longer available.</p>;
              const t = taskById.get(taskId);
              return (
                <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
                  <p style={{ margin: 0, fontSize: "var(--ds-text-14)", fontWeight: 600, color: "var(--ds-ink)", overflowWrap: "break-word" }}>{redact(event.title)}</p>
                  <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
                    {event.kind}{event.createdAt ? ` · ${relativeTime(event.createdAt) ?? ""}` : ""}
                  </p>
                  {event.detail ? (
                    <p style={{ margin: 0, fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-ink)", overflowWrap: "anywhere", background: "var(--ds-bg)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", padding: "8px 12px" }}>
                      {redact(event.detail)}
                    </p>
                  ) : null}
                  <div style={{ display: "flex", gap: "var(--ds-space-2)", flexWrap: "wrap", alignItems: "center" }}>
                    <span title={taskId} style={{ fontSize: "var(--ds-text-13)", fontFamily: "var(--ds-font-mono)", color: "var(--ds-muted)" }}>
                      Task {taskId.slice(0, 12)}…
                    </span>
                    <Button variant="ghost" size="sm" icon={copiedTask ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={() => void copyTaskId(taskId)} aria-label={`Copy full task ID ${taskId}`}>
                      {copiedTask ? "Copied" : "Copy task ID"}
                    </Button>
                    {t ? <Button variant="secondary" size="sm" onClick={() => router.push(`/?task=${taskId}`)}>Open in Chat</Button> : null}
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
