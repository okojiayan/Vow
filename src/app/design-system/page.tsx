import type { Metadata } from "next";
import { Inter } from "next/font/google";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  Clock,
  FileText,
  ShieldCheck,
} from "lucide-react";
import "./tokens.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = { title: "Design System — VOW" };

const card: React.CSSProperties = {
  background: "var(--ds-surface)",
  border: "1px solid var(--ds-border)",
  borderRadius: "var(--ds-radius-lg)",
  padding: "var(--ds-space-6)",
  boxShadow: "var(--ds-elev-1)",
};

const h2: React.CSSProperties = {
  fontSize: "var(--ds-text-20)",
  fontWeight: 600,
  marginBottom: "var(--ds-space-4)",
};
const h3: React.CSSProperties = {
  fontSize: "var(--ds-text-13)",
  fontWeight: 600,
  color: "var(--ds-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "var(--ds-space-3)",
};
const body: React.CSSProperties = { fontSize: "var(--ds-text-14)", lineHeight: 1.6 };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, marginBottom: "var(--ds-space-6)" }}>
      <h2 style={h2}>{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, token, hex, ink = "#fff" }: { name: string; token: string; hex: string; ink?: string }) {
  const value = `var(${token})`;
  return (
    <div style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-md)", overflow: "hidden" }}>
      <div style={{ background: value, color: ink, padding: "var(--ds-space-4)", fontSize: "var(--ds-text-13)", fontWeight: 600 }}>{name}</div>
      <div style={{ padding: "var(--ds-space-2) var(--ds-space-3)", fontFamily: "var(--ds-font-mono)", fontSize: "var(--ds-text-12)", color: "var(--ds-muted)" }}>{hex}</div>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <div className={`ds-scope ${inter.className}`} style={{ minHeight: "100%", padding: "var(--ds-space-8)", maxWidth: 1080, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--ds-space-8)" }}>
        <p style={{ fontSize: "var(--ds-text-13)", fontWeight: 600, color: "var(--ds-accent)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "var(--ds-space-2)" }}>
          VOW Foundations · Stage 2
        </p>
        <h1 style={{ fontSize: "var(--ds-text-28)", fontWeight: 600, marginBottom: "var(--ds-space-2)" }}>Design tokens &amp; specimen sheet</h1>
        <p style={{ ...body, color: "var(--ds-muted)", maxWidth: 640 }}>
          One warm-bronze accent, four semantic ramps, a 4px spacing grid, and restrained motion.
          All text pairs meet WCAG AA. Adapts to light, dark, and Warden modes.
        </p>
      </header>

      <Section title="1 · Color ramps">
        <h3 style={h3}>Brand anchor — the VOW mascot</h3>
        <p style={{ ...body, color: "var(--ds-muted)", marginBottom: "var(--ds-space-3)", maxWidth: 640 }}>
          Neutrals descend from the mascot&apos;s near-black plumage; accent washes carry its warm-white
          eye glow. Dark surfaces <em>are</em> the character&apos;s body color.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "var(--ds-space-3)", marginBottom: "var(--ds-space-6)" }}>
          <Swatch name="Mascot body · neutrals" token="--ds-mascot-body" hex="#1A151F" />
          <Swatch name="Eye glow · accent wash" token="--ds-mascot-glow" hex="#F6F0DC" ink="#92400E" />
        </div>
        <h3 style={h3}>Accent — warm bronze (interactive)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: "var(--ds-space-3)", marginBottom: "var(--ds-space-6)" }}>
          <Swatch name="Bronze 50" token="--ds-bronze-050" hex="#FBF6EC" ink="currentColor" />
          <Swatch name="Bronze 100" token="--ds-bronze-100" hex="#F6EAD2" ink="currentColor" />
          <Swatch name="Bronze 200" token="--ds-bronze-200" hex="#ECD3A6" ink="#1C1917" />
          <Swatch name="Bronze 500" token="--ds-bronze-500" hex="#B45309" />
          <Swatch name="Bronze 700 · accent" token="--ds-bronze-700" hex="#92400E" />
          <Swatch name="Bronze 900" token="--ds-bronze-900" hex="#78350F" />
        </div>
        <h3 style={h3}>Semantic ramps</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "var(--ds-space-3)" }}>
          <div style={{ background: "var(--ds-green-wash)", color: "var(--ds-green-700)", borderRadius: "var(--ds-radius-md)", padding: "var(--ds-space-4)", display: "flex", gap: "var(--ds-space-3)", alignItems: "center" }}>
            <CheckCircle2 size={18} /><span style={body}>Success — task completed</span>
          </div>
          <div style={{ background: "var(--ds-amber-wash)", color: "var(--ds-amber-700)", borderRadius: "var(--ds-radius-md)", padding: "var(--ds-space-4)", display: "flex", gap: "var(--ds-space-3)", alignItems: "center" }}>
            <AlertTriangle size={18} /><span style={body}>Warning — needs approval</span>
          </div>
          <div style={{ background: "var(--ds-red-wash)", color: "var(--ds-red-700)", borderRadius: "var(--ds-radius-md)", padding: "var(--ds-space-4)", display: "flex", gap: "var(--ds-space-3)", alignItems: "center" }}>
            <XCircle size={18} /><span style={body}>Error — run failed</span>
          </div>
          <div style={{ background: "var(--ds-blue-wash)", color: "var(--ds-blue-700)", borderRadius: "var(--ds-radius-md)", padding: "var(--ds-space-4)", display: "flex", gap: "var(--ds-space-3)", alignItems: "center" }}>
            <Info size={18} /><span style={body}>Info — queued behind 2 tasks</span>
          </div>
        </div>
      </Section>

      <Section title="2 · Type scale">
        <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
          <div><div style={h3}>28 · semibold — page title</div><p style={{ fontSize: "var(--ds-text-28)", fontWeight: 600 }}>Draft Q3 launch brief</p></div>
          <div><div style={h3}>20 · semibold — section heading</div><p style={{ fontSize: "var(--ds-text-20)", fontWeight: 600 }}>Pending approvals</p></div>
          <div><div style={h3}>16 · medium — lead / message</div><p style={{ fontSize: "var(--ds-text-16)", fontWeight: 500 }}>Approve: write summary to /workspace/notes/launch.md?</p></div>
          <div><div style={h3}>14 · regular — body (minimum)</div><p style={body}>The agent finished the research pass and is waiting on your approval before writing files.</p></div>
          <div><div style={h3}>13 · medium — labels, metadata</div><p style={{ fontSize: "var(--ds-text-13)", fontWeight: 500, color: "var(--ds-muted)" }}>Updated 2 min ago · 3 steps · model router</p></div>
          <div><div style={h3}>12 · regular — captions only</div><p style={{ fontSize: "var(--ds-text-12)", color: "var(--ds-muted)" }}>Retention 30 days · EU region</p></div>
          <div><div style={h3}>Mono — IDs &amp; traces</div><p style={{ fontFamily: "var(--ds-font-mono)", fontSize: "var(--ds-text-13)" }}>task_9f3k2 · trace 01J9… · 200 OK in 1.8s</p></div>
        </div>
      </Section>

      <Section title="3 · Spacing (4px grid)">
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--ds-space-4)" }}>
          {[["4", "var(--ds-space-1)", 4], ["8", "var(--ds-space-2)", 8], ["12", "var(--ds-space-3)", 12], ["16", "var(--ds-space-4)", 16], ["24", "var(--ds-space-6)", 24], ["32", "var(--ds-space-8)", 32], ["48", "var(--ds-space-12)", 48], ["64", "var(--ds-space-16)", 64]].map(([label, token, px]) => (
            <div key={label as string} style={{ textAlign: "center" }}>
              <div style={{ width: 40, height: `${px}px`, background: "var(--ds-accent-wash)", border: "1px solid var(--ds-accent)", borderRadius: 4, margin: "0 auto" }} />
              <div style={{ fontFamily: "var(--ds-font-mono)", fontSize: "var(--ds-text-12)", color: "var(--ds-muted)", marginTop: "var(--ds-space-2)" }}>{label}</div>
              <div style={{ display: "none" }}>{token as string}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="4 · Radius">
        <div style={{ display: "flex", gap: "var(--ds-space-4)", flexWrap: "wrap" }}>
          <div style={{ ...card, boxShadow: "var(--ds-elev-0)", borderRadius: "var(--ds-radius-sm)", padding: "var(--ds-space-4)" }}>6px — inputs, small cards</div>
          <div style={{ ...card, boxShadow: "var(--ds-elev-0)", borderRadius: "var(--ds-radius-md)", padding: "var(--ds-space-4)" }}>8px — buttons, menus</div>
          <div style={{ ...card, boxShadow: "var(--ds-elev-0)", borderRadius: "var(--ds-radius-lg)", padding: "var(--ds-space-4)" }}>12px — panels, dialogs</div>
          <div style={{ display: "flex", gap: "var(--ds-space-2)", alignItems: "center" }}>
            <span style={{ background: "var(--ds-green-wash)", color: "var(--ds-green-700)", borderRadius: "var(--ds-radius-pill)", padding: "4px 12px", fontSize: "var(--ds-text-13)", fontWeight: 500 }}>Approved</span>
            <span style={{ background: "var(--ds-amber-wash)", color: "var(--ds-amber-700)", borderRadius: "var(--ds-radius-pill)", padding: "4px 12px", fontSize: "var(--ds-text-13)", fontWeight: 500 }}>Pending</span>
          </div>
        </div>
        <p style={{ ...body, color: "var(--ds-muted)", marginTop: "var(--ds-space-4)" }}>Pills are reserved for badges and toggles only.</p>
      </Section>

      <Section title="5 · Elevation">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "var(--ds-space-4)" }}>
          <div style={{ ...card, boxShadow: "var(--ds-elev-0)" }}><h3 style={h3}>Level 0 — flat</h3><p style={body}>Page background, dividers.</p></div>
          <div style={{ ...card, boxShadow: "var(--ds-elev-1)" }}><h3 style={h3}>Level 1 — raised</h3><p style={body}>Cards, list rows, sidebar panels.</p></div>
          <div style={{ ...card, boxShadow: "var(--ds-elev-2)" }}><h3 style={h3}>Level 2 — floating</h3><p style={body}>Dialogs, popovers, toasts.</p></div>
        </div>
      </Section>

      <Section title="6 · Motion">
        <div style={{ display: "flex", gap: "var(--ds-space-3)", flexWrap: "wrap", marginBottom: "var(--ds-space-4)" }}>
          <button className="ds-demo-btn" style={{ background: "var(--ds-accent)", color: "var(--ds-accent-ink)", border: "none", borderRadius: "var(--ds-radius-md)", padding: "10px 20px", fontSize: "var(--ds-text-14)", fontWeight: 500, transition: "transform var(--ds-dur-2) var(--ds-ease-out), opacity var(--ds-dur-1) var(--ds-ease-out)" }}>
            Hover me — 160ms ease-out
          </button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--ds-space-2)", fontSize: "var(--ds-text-14)", color: "var(--ds-muted)" }}>
            <Clock size={16} /> Panels animate ≤ 240ms
          </span>
        </div>
        <style>{`.ds-demo-btn:hover{transform:translateY(-1px);opacity:.92}.ds-demo-btn:active{transform:translateY(0)}`}</style>
        <p style={{ ...body, color: "var(--ds-muted)" }}>Micro-interactions 120–200ms ease-out; panel transitions cap at 240ms. All motion disabled under prefers-reduced-motion.</p>
      </Section>

      <Section title="7 · Composition example">
        <div style={{ border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)", padding: "var(--ds-space-4)", display: "flex", gap: "var(--ds-space-4)", alignItems: "flex-start", background: "var(--ds-bg)" }}>
          <div style={{ background: "var(--ds-accent-wash)", borderRadius: "var(--ds-radius-md)", padding: "var(--ds-space-3)" }}>
            <FileText size={18} color="var(--ds-accent)" />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "var(--ds-text-14)", fontWeight: 500 }}>Draft Q3 launch brief</p>
            <p style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>Updated 2 min ago · 3 steps · <span style={{ fontFamily: "var(--ds-font-mono)" }}>task_9f3k2</span></p>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--ds-green-wash)", color: "var(--ds-green-700)", borderRadius: "var(--ds-radius-pill)", padding: "4px 12px", fontSize: "var(--ds-text-13)", fontWeight: 500 }}>
            <ShieldCheck size={14} /> Verified
          </span>
        </div>
      </Section>
    </div>
  );
}
