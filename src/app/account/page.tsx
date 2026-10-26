"use client";

import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { loadPreferences, savePreferences } from "@/lib/preferences";
import { isDiagnosticMemory } from "@/lib/memory-display";

export default function AccountPage() {
  const [name, setName] = useState("Ayan");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    try { setName(loadPreferences().displayName || "Ayan"); } catch {}
    fetch("/api/memory").then((r) => r.json()).then((p) => setCount((p.records ?? []).filter((r: { kind?: unknown; provenance?: unknown; source?: unknown }) => !isDiagnosticMemory(r)).length)).catch(() => setCount(null));
  }, []);

  const save = () => {
    try {
      const prefs = loadPreferences();
      savePreferences({ ...prefs, displayName: name });
      alert("Profile saved on this device.");
    } catch { alert("Could not save — storage unavailable."); }
  };

  const exportMem = async () => {
    const payload = await fetch("/api/memory").then((r) => r.json());
    const blob = new Blob([JSON.stringify(payload.records ?? [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vow-memories.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportChats = async () => {
    const payload = await fetch("/api/conversations").then((r) => r.json()).catch(() => ({ conversations: [] }));
    const blob = new Blob([JSON.stringify(payload.conversations ?? [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vow-conversations.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-scroll">
      <p className="kicker">Account</p>
      <h1 className="page-title">Profile &amp; data</h1>
      <section className="panel flex items-center gap-4 p-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold" style={{ background: "var(--amber-wash)", color: "var(--amber-deep)" }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div>
          <p className="text-xl font-bold">{name}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Local profile · no cloud account · {count === null ? "memory count unavailable" : `${count} memories stored`}</p>
        </div>
      </section>
      <section className="panel space-y-3 p-6">
        <label className="block text-sm font-medium" htmlFor="display-name">Display name (stored on this device)</label>
        <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} className="input max-w-sm" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} className="btn-amber">Save profile</button>
          <button type="button" onClick={() => void exportMem()} className="secondary"><Download size={15} aria-hidden="true" /> Export memories</button>
          <button type="button" onClick={() => void exportChats()} className="secondary"><Download size={15} aria-hidden="true" /> Export chats</button>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>Exports download as JSON from the live API. Sign-out clears the device session only — server history is kept.</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" className="secondary deny" onClick={() => { if (window.confirm("Clear local preferences on this device? Server history is kept.")) { try { localStorage.clear(); } catch {} alert("Local storage cleared."); } }}><Trash2 size={14} aria-hidden="true" /> Clear local data</button>
        </div>
      </section>
      <section className="panel p-6" aria-label="Data controls">
        <p className="kicker">Privacy</p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>VOW works inside one allowed folder. Everything else stays off-limits. Manage the folder in Chat on first run, or in Settings → Privacy &amp; memory.</p>
      </section>
    </div>
  );
}
