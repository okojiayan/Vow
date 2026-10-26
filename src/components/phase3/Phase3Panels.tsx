"use client";

import { useEffect, useState } from "react";
import { explain, type ExplainLang } from "@/core/i18n/explain";

interface Deadline {
  id: string;
  date: string;
  explicit: boolean;
  source: string;
  snippet: string;
  stale: boolean;
}

export function Phase3Panels() {
  const [lang, setLang] = useState<ExplainLang>("en");
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [budgets, setBudgets] = useState<Array<{ id: string; remaining: number; maxUnits: number }>>([]);
  const [contacts, setContacts] = useState<Array<{ id: string; label: string; purposes: string[]; revoked: boolean }>>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/deadlines").then((r) => r.json()).then((j) => setDeadlines(j.deadlines ?? [])).catch(() => undefined);
    fetch("/api/budget").then((r) => r.json()).then((j) => setBudgets(j.budgets ?? [])).catch(() => undefined);
    fetch("/api/contacts").then((r) => r.json()).then((j) => setContacts(j.contacts ?? [])).catch(() => undefined);
    try {
      const saved = localStorage.getItem("vow-lang");
      if (saved === "hi" || saved === "hinglish" || saved === "en") setLang(saved);
    } catch { /* defaults */ }
  }, []);

  const pick = (l: ExplainLang) => {
    setLang(l);
    try { localStorage.setItem("vow-lang", l); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <section className="panel space-y-2 p-5" aria-label="Phone approval status">
        <h3 className="text-sm font-bold">Pocket Approval</h3>
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>{explain("pocket-unavailable", lang)}</p>
        <p className="text-xs">Pending parked actions are approved on this device. Phone transport is not connected — no action was sent anywhere.</p>
      </section>

      <section className="panel space-y-2 p-5" aria-label="Trusted contacts">
        <h3 className="text-sm font-bold">Trusted Contacts {contacts.length ? `(${contacts.length})` : ""}</h3>
        {contacts.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ds-muted)" }}>No trusted contacts. Reports are local previews only until you add one and configure delivery.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {contacts.map((c) => (
              <li key={c.id}>{c.label} — {c.purposes.join(", ")}{c.revoked ? " (revoked)" : ""}</li>
            ))}
          </ul>
        )}
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>{explain("delivery-preview", lang)}</p>
      </section>

      <section className="panel space-y-2 p-5" aria-label="Trust budget">
        <h3 className="text-sm font-bold">Trust Budget</h3>
        {budgets.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ds-muted)" }}>No budget configured. Create one from the API; spending is recorded from real executions only.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {budgets.map((b) => (
              <li key={b.id}>{b.id.slice(0, 12)}… — {b.remaining}/{b.maxUnits} left</li>
            ))}
          </ul>
        )}
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>{explain("budget-exhausted", lang)}</p>
      </section>

      <section className="panel space-y-2 p-5" aria-label="Deadline reminders">
        <h3 className="text-sm font-bold">Deadline Guardian (read-only)</h3>
        {deadlines.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ds-muted)" }}>No explicit deadlines found in memory or tasks. Nothing was invented.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {deadlines.slice(0, 8).map((d) => (
              <li key={d.id}>
                <strong>{d.date}</strong> — {d.snippet.slice(0, 90)}
                <span style={{ color: "var(--ds-muted)" }}> ({d.source}{d.stale ? ", stale" : ""}{d.explicit ? "" : ", inferred"})</span>
                <button type="button" className="secondary ml-2" onClick={() => {
                  fetch("/api/deadlines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismiss: d.id }) })
                    .then(() => setDeadlines((cur) => cur.filter((x) => x.id !== d.id)))
                    .catch(() => setNote("Dismiss failed."));
                }}>Dismiss</button>
              </li>
            ))}
          </ul>
        )}
        {note ? <p className="text-xs">{note}</p> : null}
      </section>

      <section className="panel space-y-2 p-5" aria-label="Language">
        <h3 className="text-sm font-bold">Language Mode</h3>
        <div className="flex gap-2" role="group" aria-label="Explanation language">
          {(["en", "hi", "hinglish"] as const).map((l) => (
            <button key={l} type="button" className="secondary" aria-pressed={lang === l} onClick={() => pick(l)}>{l}</button>
          ))}
        </div>
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>{explain("approval-required", lang, { tool: "fs.delete" })}</p>
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>Policy IDs and tool names stay in English; translation never changes permissions.</p>
      </section>

      <section className="panel space-y-2 p-5" aria-label="Community sharing">
        <h3 className="text-sm font-bold">Tricks Radar — community sharing</h3>
        <p className="text-xs" style={{ color: "var(--ds-muted)" }}>Simulated only. No sharing infrastructure exists in this build, so no reports leave this device and no community statistics are shown.</p>
      </section>
    </div>
  );
}
