"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Play } from "lucide-react";
import { relativeTime } from "@/lib/relative-time";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Dialog, Toast } from "@/components/ui/overlays";
import { Table } from "@/components/ui/Rows";
import { EmptyState, InlineBanner } from "@/components/ui/feedback";
import { VerificationBadge } from "@/components/ui/badges";
import { StepTimeline, type TimelineStep } from "@/components/ui/trust";

interface EvalResult {
  id: string;
  title: string;
  path: string;
  source: string;
  completed: boolean;
  verifiedCorrect: boolean;
  unauthorizedBlocked: boolean;
  summary: string;
  latencyMs: number;
}

interface EvalReport {
  id: string;
  createdAt: string;
  measured: boolean;
  simulated: boolean;
  note: string;
  results: EvalResult[];
  metrics: {
    baseline: { cases: number; completed: number; verifiedCorrect: number; unauthorizedBlocked: number; latencyMsTotal: number };
    vow: { cases: number; completed: number; verifiedCorrect: number; unauthorizedBlocked: number; latencyMsTotal: number };
  };
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function passRate(m: { verifiedCorrect: number; cases: number }): string {
  if (!m.cases) return "—";
  return `${Math.round((m.verifiedCorrect / m.cases) * 100)}% (${m.verifiedCorrect}/${m.cases})`;
}

export default function EvaluationPage() {
  const { effective } = useTheme();
  const router = useRouter();
  const [report, setReport] = useState<EvalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await fetch("/api/evals").then((r) => r.json());
      setReport((payload.report ?? null) as EvalReport | null);
      setLoadError(null);
    } catch {
      setLoadError("The evaluation service did not respond. Showing nothing rather than old results.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const payload = await fetch("/api/evals", { method: "POST" }).then((r) => r.json());
      if (!payload.report) throw new Error(payload.error ?? "The evaluation did not return a report.");
      setReport(payload.report as EvalReport);
      setToast("Evaluation finished — results below are measured, not simulated.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "The evaluation could not run.");
    } finally {
      setRunning(false);
      window.setTimeout(() => setToast(null), 4000);
    }
  }, []);

  const pairs = useMemo(() => {
    if (!report) return [];
    const out: Array<{ title: string; baseline: EvalResult; vow: EvalResult }> = [];
    for (let i = 0; i + 1 < report.results.length; i += 2) {
      const a = report.results[i];
      const b = report.results[i + 1];
      const baseline = a.path === "baseline" ? a : b.path === "baseline" ? b : a;
      const vow = baseline === a ? b : a;
      out.push({ title: baseline.title, baseline, vow });
    }
    return out;
  }, [report]);

  const diffPair = diffFor ? pairs.find((p) => p.title === diffFor) ?? null : null;
  const diffSteps: TimelineStep[] = diffPair
    ? [
        { id: "b", title: `Baseline — ${diffPair.baseline.summary || "no summary"}`, state: diffPair.baseline.verifiedCorrect ? "completed" : "failed" },
        { id: "v", title: `VOW — ${diffPair.vow.summary || "no summary"}`, state: diffPair.vow.verifiedCorrect ? "completed" : "failed" },
      ]
    : [];

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Evaluation"
          description="Reliability runs of baseline versus VOW, measured live. Nothing here is simulated."
          action={<Button variant="primary" icon={<Play size={16} aria-hidden="true" />} loading={running} onClick={() => void run()}>Run baseline vs VOW</Button>}
        />

        {loadError ? <InlineBanner tone="error" title="Evaluation unavailable" body={loadError} /> : null}

        {loading ? (
          <p style={{ color: "var(--ds-muted)", fontSize: "var(--ds-text-14)" }} aria-live="polite">Loading reports…</p>
        ) : !report ? (
          <EmptyState
            title="No runs yet"
            body="Run your first evaluation to measure baseline against VOW on dangerous-prompt handling, verification coverage, and unauthorized-action blocking. It takes a few minutes; each case runs both paths."
            mascot="normal"
            action={{ label: "Run baseline vs VOW", onPress: () => void run() }}
          />
        ) : (
          <div style={{ display: "grid", gap: "var(--ds-space-5)" }}>
            {report.simulated ? (
              <InlineBanner tone="error" title="Simulated report" body="This report is labelled simulated and is not shown as a result." />
            ) : (
              <>
                <Table<{ id: string }>
                  label="Evaluation runs"
                  rows={[{ id: report.id }]}
                  columns={[
                    {
                      key: "date",
                      header: "Date",
                      render: () => <span style={{ whiteSpace: "nowrap" }}>{relativeTime(report.createdAt) ?? report.createdAt}</span>,
                    },
                    { key: "suite", header: "Suite", render: () => <span>Reliability (RCF)</span> },
                    { key: "pass", header: "Pass rate", render: () => <span style={{ fontFamily: "var(--ds-font-mono)", whiteSpace: "nowrap" }}>{passRate(report.metrics.vow)}</span> },
                    {
                      key: "vs",
                      header: "vs baseline",
                      render: () => {
                        const d = report.metrics.vow.verifiedCorrect - report.metrics.baseline.verifiedCorrect;
                        return <span style={{ fontFamily: "var(--ds-font-mono)", whiteSpace: "nowrap" }}>{d >= 0 ? `+${d}` : `${d}`} verified cases</span>;
                      },
                    },
                    {
                      key: "duration",
                      header: "Duration",
                      render: () => <span style={{ fontFamily: "var(--ds-font-mono)", whiteSpace: "nowrap" }}>{fmtDuration(report.metrics.baseline.latencyMsTotal + report.metrics.vow.latencyMsTotal)}</span>,
                    },
                    {
                      key: "open",
                      header: "",
                      render: () => (
                        <Button variant="ghost" size="sm" icon={<FlaskConical size={14} aria-hidden="true" />} onClick={() => setDiffFor(pairs[0]?.title ?? null)}>
                          Case diff
                        </Button>
                      ),
                    },
                  ]}
                />
                <Table<{ id: string; title: string; baseline: EvalResult; vow: EvalResult }>
                  label="Cases: baseline versus VOW"
                  rows={pairs.map((x) => ({ ...x, id: x.title }))}
                  columns={[
                    {
                      key: "case",
                      header: "Case",
                      render: (p) => <span style={{ display: "block", fontWeight: 500, overflowWrap: "break-word" }}>{p.title}</span>,
                    },
                    {
                      key: "baseline",
                      header: "Baseline",
                      render: (p) => <VerificationBadge state={p.baseline.verifiedCorrect ? "verified" : p.baseline.completed ? "unverified" : "failed"} />,
                    },
                    {
                      key: "vow",
                      header: "VOW",
                      render: (p) => <VerificationBadge state={p.vow.verifiedCorrect ? "verified" : p.vow.completed ? "unverified" : "failed"} />,
                    },
                    {
                      key: "blocked",
                      header: "Unauthorized blocked",
                      render: (p) => <span>{p.vow.unauthorizedBlocked ? "yes" : "no"}</span>,
                    },
                    {
                      key: "open",
                      header: "",
                      render: (p) => <Button variant="ghost" size="sm" onClick={() => setDiffFor(p.title)}>Diff</Button>,
                    },
                  ]}
                />
                <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>{report.note}</p>
              </>
            )}
          </div>
        )}

        <Dialog
          title={diffPair ? `Diff: ${diffPair.title}` : "Case diff"}
          open={diffPair !== null}
          onClose={() => setDiffFor(null)}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => router.push("/tasks")}>View tasks</Button>
              <Button variant="secondary" size="sm" onClick={() => setDiffFor(null)}>Close</Button>
            </>
          }
        >
          {diffPair ? (
            <div style={{ display: "grid", gap: "var(--ds-space-4)" }}>
              <StepTimeline steps={diffSteps} verification={diffPair.vow.verifiedCorrect ? "verified" : "unverified"} />
              <p style={{ margin: 0, fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.6 }}>
                Baseline: {diffPair.baseline.completed ? "completed" : "did not complete"} · {diffPair.baseline.latencyMs} ms · {diffPair.baseline.summary || "no summary recorded."}
                <br />
                VOW: {diffPair.vow.completed ? "completed" : "did not complete"} · {diffPair.vow.latencyMs} ms · {diffPair.vow.summary || "no summary recorded."}
              </p>
            </div>
          ) : null}
        </Dialog>

        {toast ? <Toast title={toast} /> : null}
      </div>
    </div>
  );
}
