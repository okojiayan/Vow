import Image from "next/image";
import { BarChart3, CheckSquare, Cpu, FolderOpen, Layers, Plus, Settings } from "lucide-react";

const links = [
  { label: "Chat", Icon: Cpu, active: true },
  { label: "Tasks", Icon: CheckSquare, active: false },
  { label: "Memory", Icon: Layers, active: false },
  { label: "Library", Icon: FolderOpen, active: false },
  { label: "Evaluation", Icon: BarChart3, active: false },
  { label: "Settings", Icon: Settings, active: false },
];

const shell: React.CSSProperties = {
  background: "var(--ds-surface)",
  border: "1px solid var(--ds-border)",
  borderRadius: "var(--ds-radius-lg)",
  boxShadow: "var(--ds-elev-1)",
  overflow: "hidden",
};

/** Isolated 240px sidebar specimen — mascot mark in the header. Not wired into the app. */
export function SidebarFull({ warden = false }: { warden?: boolean }) {
  return (
    <div style={{ ...shell, width: 240, padding: "var(--ds-space-4)", display: "flex", flexDirection: "column", gap: "var(--ds-space-2)" }} role="navigation" aria-label="Sidebar specimen">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-3)", padding: "4px 4px var(--ds-space-3)" }}>
        <Image
          src={warden ? "/assets/vow/warden.webp" : "/assets/vow/mascot.webp"}
          alt="VOW"
          width={32}
          height={32}
          style={{ borderRadius: "var(--ds-radius-sm)" }}
        />
        <div>
          <p style={{ fontSize: "var(--ds-text-14)", fontWeight: 600, color: "var(--ds-ink)", lineHeight: 1.2 }}>VOW</p>
          <p style={{ fontSize: "var(--ds-text-12)", color: "var(--ds-muted)" }}>Your AI Agent</p>
        </div>
      </div>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--ds-space-2)",
          background: "var(--ds-accent)",
          color: "var(--ds-accent-ink)",
          borderRadius: "var(--ds-radius-md)",
          padding: "9px 12px",
          fontSize: "var(--ds-text-14)",
          fontWeight: 500,
        }}
      >
        <Plus size={15} aria-hidden="true" />
        New Chat
      </span>
      {links.map(({ label, Icon, active }) => (
        <span
          key={label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--ds-space-3)",
            borderRadius: "var(--ds-radius-md)",
            padding: "8px 12px",
            fontSize: "var(--ds-text-14)",
            fontWeight: active ? 600 : 400,
            background: active ? "var(--ds-surface-2)" : "transparent",
            color: active ? "var(--ds-accent)" : "var(--ds-ink-soft)",
          }}
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Isolated 56px collapsed rail specimen — mascot mark stays, labels collapse to tooltips. */
export function SidebarRail({ warden = false }: { warden?: boolean }) {
  return (
    <div
      style={{ ...shell, width: 56, padding: "12px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--ds-space-2)" }}
      role="navigation"
      aria-label="Collapsed rail specimen"
    >
      <Image
        src={warden ? "/assets/vow/warden.webp" : "/assets/vow/mascot.webp"}
        alt="VOW home"
        width={32}
        height={32}
        style={{ borderRadius: "var(--ds-radius-sm)", marginBottom: "var(--ds-space-2)" }}
      />
      {links.map(({ label, Icon, active }) => (
        <span
          key={label}
          title={label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            height: 38,
            borderRadius: "var(--ds-radius-md)",
            background: active ? "var(--ds-surface-2)" : "transparent",
            color: active ? "var(--ds-accent)" : "var(--ds-ink-soft)",
          }}
        >
          <Icon size={17} aria-hidden="true" />
          <span className="ds-sr">{label}</span>
        </span>
      ))}
    </div>
  );
}
