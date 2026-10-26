"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquareText, PanelRight, Plus, SquareCheckBig } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ModeProvider, useMode } from "./ModeContext";
import { ChromeProvider, useChrome } from "./ChromeContext";
import { ThemeProvider, useTheme } from "./ThemeContext";

import { shouldPlayActivation } from "@/lib/task-display";
import { WardenTransformation } from "@/components/vow/WardenTransformation";
import { PersistentLiveActivity } from "@/components/live/PersistentLiveActivity";
import { DEFAULT_PREFERENCES, loadPreferences, type UiPreferences } from "@/lib/preferences";

function ShellChrome({ children }: { children: React.ReactNode }) {
  const { warden } = useMode();
  const { drawerOpen, sidebarOpen, setSidebarOpen, toggleSidebar, toggleDrawer, requestNewChat } = useChrome();
  const [prefs, setPrefs] = useState<UiPreferences>(DEFAULT_PREFERENCES);
  const [transforming, setTransforming] = useState(false);
  const [transformEntering, setTransformEntering] = useState(true);
  const prevWarden = useRef(warden);
  const endTransform = useCallback(() => setTransforming(false), []);

  useEffect(() => {
    try { setPrefs(loadPreferences()); } catch { /* default */ }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = prefs.reduceMotion ? "reduced" : "full";
    document.body.classList.toggle("warden", warden);
    document.body.classList.remove("world");
  }, [prefs, warden]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Cmd+K: new chat
      if (meta && e.key === "k" && !e.shiftKey) { e.preventDefault(); requestNewChat(); }
      // Cmd+Shift+M: toggle task monitor
      if (meta && e.shiftKey && (e.key === "m" || e.key === "M")) { e.preventDefault(); toggleDrawer(); }
      // Cmd+\: toggle sidebar
      if (meta && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestNewChat, toggleDrawer, toggleSidebar]);

  // Security visuals switch instantly via body class + CSS. The transformation
  // overlay is purely celebratory: it never moves focus, never scrolls, and never
  // gates the policy change. Skip, Escape, reduced motion, or the appearance
  // preference all bypass it without affecting the enforced mode.
  useEffect(() => {
    if (warden === prevWarden.current) return;
    const entering = warden;
    prevWarden.current = warden;
    // Policy visuals apply instantly via body class above; the overlay below is
    // celebratory only. An interrupted animation therefore cannot misreport
    // the enforced mode, which always comes from the backend-confirmed state.
    let prefersReduced = false;
    try {
      prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      prefersReduced = false;
    }
    if (
      !shouldPlayActivation({
        reduceMotion: prefs.reduceMotion,
        playFullActivation: prefs.playFullActivation,
        prefersReducedMotion: prefersReduced,
      })
    ) {
      return;
    }
    setTransformEntering(entering);
    setTransforming(true);
  }, [warden, prefs.reduceMotion, prefs.playFullActivation]);

  const { effective } = useTheme();
  const pathname = usePathname();
  // Only the chat/home screen migrates to the DS in Stage 4. Every other
  // route keeps its existing styling until Stage 5.
  const isChat = pathname === "/";
  return (
    <div className={`shell-grid${drawerOpen ? " task-open" : ""}${sidebarOpen ? " side-open" : ""}`} id="vow-app">
      <div className="ds-scope" data-theme={effective}>
        <Sidebar rail={!sidebarOpen} />
      </div>
      <div className="shell-main">
        <div className="ds-scope" data-theme={effective}>
          <Topbar />
        </div>
        {isChat ? (
          <div className="ds-scope shell-content" data-theme={effective}>
            {children}
          </div>
        ) : (
          <div className="shell-content">{children}</div>
        )}
        <div className="ds-scope" data-theme={effective}>
          <MobileNav />
        </div>
      </div>
      <div className="ds-scope" data-theme={effective}>
        <PersistentLiveActivity />
      </div>
      {sidebarOpen ? <div className="shell-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" /> : null}
      {transforming ? (
        <WardenTransformation entering={transformEntering} onSkip={endTransform} onDone={endTransform} />
      ) : null}
    </div>
  );
}

// Deliberate responsive shortcut: on narrow viewports the sidebar rail is
// hidden, so this bottom bar exposes the same canonical destinations. Every
// href here must also exist in SIDEBAR_LINKS (enforced by unit test); this is
// the only sanctioned navigation duplicate.
export const MOBILE_NAV_LINKS = [
  { href: "/", label: "Chat" },
  { href: "/tasks", label: "Tasks" },
  { href: "/search", label: "Search" },
  { href: "/memory", label: "Memory" },
];

function MobileNav() {
  const { requestNewChat, drawerOpen, toggleDrawer } = useChrome();
  const pathname = usePathname();
  return (
    <nav className="shell-mobilebar" aria-label="Primary">
      <button type="button" onClick={requestNewChat} aria-label="New chat">
        <Plus size={18} aria-hidden="true" />
        <span>New chat</span>
      </button>
      <Link href="/" aria-current={pathname === "/" ? "page" : undefined} aria-label="Chat">
        <MessageSquareText size={18} aria-hidden="true" />
        <span>Chat</span>
      </Link>
      <Link href="/tasks" aria-current={pathname.startsWith("/tasks") ? "page" : undefined} aria-label="Tasks">
        <SquareCheckBig size={18} aria-hidden="true" />
        <span>Tasks</span>
      </Link>
      <button type="button" onClick={toggleDrawer} aria-pressed={drawerOpen} aria-label={drawerOpen ? "Hide activity" : "Show activity"}>
        <PanelRight size={18} aria-hidden="true" />
        <span>Activity</span>
      </button>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ModeProvider>
      <ChromeProvider>
        <ThemeProvider>
          <ShellChrome>{children}</ShellChrome>
        </ThemeProvider>
      </ChromeProvider>
    </ModeProvider>
  );
}
