"use client";

import { useRouter, usePathname } from "next/navigation";
import { PanelLeft, PanelRight } from "lucide-react";
import { useChrome } from "./ChromeContext";
import { AutonomyMenu } from "@/components/autonomy/AutonomyMenu";
import { useMode } from "./ModeContext";
import { Segmented } from "@/components/ui/Segmented";

const CRUMBS: Array<[string, string]> = [
  ["/tasks", "Tasks"],
  ["/memory", "Memory"],
  ["/routines", "Routines"],
  ["/skills", "Skills"],
  ["/tools", "Integrations"],
  ["/library", "Knowledge"],
  ["/search", "Search"],
  ["/evaluation", "Evaluation"],
  ["/settings", "Settings"],
  ["/account", "Account"],
  ["/devices", "Devices"],
  ["/history", "History"],
];

function crumbFor(pathname: string): string {
  if (pathname === "/") return "Chat";
  const hit = CRUMBS.find(([href]) => pathname === href || pathname.startsWith(href + "/"));
  return hit ? hit[1] : "VOW";
}

export function Topbar() {
  const { drawerOpen, toggleDrawer, toggleSidebar, sidebarOpen } = useChrome();
  const { uiMode, setUiMode } = useMode();
  const pathname = usePathname();
  const router = useRouter();
  const view = pathname.startsWith("/tasks") ? "tasks" : "chat";

  return (
    <div className="shell-topbar" role="banner">
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "none" }}>
        <button
          type="button"
          onClick={toggleSidebar}
          className="shell-iconbtn"
          title="Toggle sidebar (⌘\)"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
        >
          <PanelLeft size={16} aria-hidden="true" />
        </button>
        <p className="shell-crumb" aria-current="page">{crumbFor(pathname)}</p>
      </div>

      <div className="shell-topbar-center">
        <Segmented
          label="Views"
          options={[
            { value: "chat", label: "Chat" },
            { value: "tasks", label: "Tasks" },
          ]}
          value={view}
          onChange={(v) => router.push(v === "tasks" ? "/tasks" : "/")}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "none" }}>
        <div className="shell-mode-group" role="group" aria-label="Monitor and autonomy mode">
          <button
            type="button"
            onClick={toggleDrawer}
            aria-pressed={drawerOpen}
            aria-label={drawerOpen ? "Hide Activity (⌘⇧M)" : "Show Activity (⌘⇧M)"}
            title={drawerOpen ? "Hide Activity (⌘⇧M)" : "Show Activity (⌘⇧M)"}
            className="shell-monitor-btn"
          >
            <PanelRight size={14} aria-hidden="true" />
            <span>Activity</span>
          </button>
          <span className="shell-mode-divider" aria-hidden="true" />
          <AutonomyMenu value={uiMode} onChange={setUiMode} />
        </div>
      </div>
    </div>
  );
}
