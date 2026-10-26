"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/shell/ThemeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/feedback";

function describeThisDevice(): string {
  try {
    const ua = navigator.userAgent;
    const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : "this browser";
    const browser = /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "browser";
    return `${browser} on ${os}`;
  } catch {
    return "this browser";
  }
}

export default function DevicesPage() {
  const { effective } = useTheme();
  const [device, setDevice] = useState("this browser");

  useEffect(() => {
    setDevice(describeThisDevice());
  }, []);

  return (
    <div className="ds-scope" data-theme={effective}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "var(--ds-space-6)", width: "100%", boxSizing: "border-box" }}>
        <PageHeader
          title="Devices"
          description="Where your local VOW profile lives. The backend reports no other devices."
        />
        <ul style={{ listStyle: "none", margin: "0 0 var(--ds-space-4)", padding: 0, display: "grid", gap: "var(--ds-space-3)" }}>
          <li
            style={{ background: "var(--ds-surface)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-lg)", padding: "14px 16px" }}
          >
            <p style={{ margin: 0, fontSize: "var(--ds-text-15)", fontWeight: 600, color: "var(--ds-ink)" }}>This device</p>
            <p style={{ margin: "4px 0 0", fontSize: "var(--ds-text-13)", color: "var(--ds-muted)" }}>
              {device} · preferences and routine schedules stored locally
            </p>
          </li>
        </ul>
        <EmptyState
          title="No other devices"
          body="VOW has no cloud account, so there is nothing else signed in. If device sync ever ships, it will be listed here."
        />
      </div>
    </div>
  );
}
