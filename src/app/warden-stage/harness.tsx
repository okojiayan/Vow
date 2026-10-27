"use client";

import { useCallback, useRef, useState } from "react";
import { WardenTransformation, type TransformVerdict } from "@/components/vow/WardenTransformation";

interface T {
  id: number;
  entering: boolean;
  verdict: TransformVerdict;
  error: string | null;
}

export function WardenStageHarness() {
  const [t, setT] = useState<T | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const id = useRef(0);
  const push = useCallback((m: string) => setLog((l) => [...l, m]), []);
  const start = useCallback(
    (entering: boolean, verdict: TransformVerdict, error: string | null = null) => {
      id.current += 1;
      const nid = id.current;
      push(`start id=${nid} entering=${entering ? 1 : 0} verdict=${verdict}`);
      setT({ id: nid, entering, verdict, error });
    },
    [push],
  );
  const rapid = useCallback(() => {
    start(true, "confirmed");
    setTimeout(() => start(false, "confirmed"), 80);
    setTimeout(() => start(true, "confirmed"), 160);
  }, [start]);
  return (
    <main style={{ minHeight: "100vh", padding: 32 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button type="button" data-testid="wt-go-forward" onClick={() => start(true, "confirmed")}>Forward success</button>
        <button type="button" data-testid="wt-go-reverse" onClick={() => start(false, "confirmed")}>Reverse success</button>
        <button type="button" data-testid="wt-go-fail-on" onClick={() => start(true, "failed", "Forced activation failure.")}>Failed activation</button>
        <button type="button" data-testid="wt-go-fail-off" onClick={() => start(false, "failed", "Forced deactivation failure.")}>Failed deactivation</button>
        <button type="button" data-testid="wt-go-rapid" onClick={rapid}>Rapid x3</button>
      </div>
      {t ? (
        <WardenTransformation
          key={t.id}
          entering={t.entering}
          origin="dock"
          verdict={t.verdict}
          error={t.error}
          onSkip={() => { push("skip"); setT(null); }}
          onDone={() => { push("done"); setT(null); }}
          onCommit={() => push("commit")}
        />
      ) : null}
      <ol data-testid="wt-log">
        {log.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ol>
    </main>
  );
}
