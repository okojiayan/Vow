"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen, CalendarDays, ChevronDown, ChevronRight, ChevronsLeft, CircleHelp, LayoutGrid,
  Layers, LogOut, MessageSquareText, ShieldCheck, Search, Settings, SquareCheckBig, UserRound, Plus, FileText, FolderOpen,
  Sparkles, BarChart3,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { loadPreferences } from "@/lib/preferences";
import { latestMessageTime, relativeTime } from "@/lib/relative-time";
import { useChrome } from "./ChromeContext";
import { useMode } from "./ModeContext";
import { useTheme, type ThemeSetting } from "./ThemeContext";

export const SIDEBAR_LINKS = [
  { href: "/", label: "Chat", icon: MessageSquareText, title: "Start or resume a conversation" },
  { href: "/tasks", label: "Tasks", icon: SquareCheckBig, title: "View active and completed agent tasks" },
  { href: "/memory", label: "Memory", icon: Layers, title: "Long-term memories, knowledge and preferences" },
  { href: "/routines", label: "Routines", icon: CalendarDays, title: "Recurring agent workflows and automations" },
  { href: "/skills", label: "Skills", icon: Sparkles, title: "Skills marketplace and agent extensions" },
  { href: "/tools", label: "Integrations", icon: LayoutGrid, title: "Built-in tools and connected services", expandable: true },
  { href: "/library", label: "Knowledge", icon: BookOpen, title: "Knowledge base and saved notes" },
  { href: "/search", label: "Search", icon: Search, title: "Search conversations, tasks, and memory" },
  { href: "/evaluation", label: "Evaluation", icon: BarChart3, title: "Reliability & Correctness benchmark harness" },
];

/** Primary rail destinations in approved order; everything else stays under More. */
const PRIMARY_ORDER = ["/", "/tasks", "/memory", "/routines", "/tools", "/library"];
const PRIMARY_HREFS = new Set(PRIMARY_ORDER);

interface RecentConversation {
  id: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
  updatedAt?: string;
}



function titleFor(c: RecentConversation): string {
  const m = c.messages.find((x) => x.role === "user") ?? c.messages[0];
  return ((m?.content ?? "Untitled conversation").split("\n")[0] || "Untitled").slice(0, 42);
}

function iconFor(c: RecentConversation) {
  const text = c.messages.map((m) => m.content).join(" ").toLowerCase();
  if (/folder|file|organize|note|library/.test(text)) return FolderOpen;
  return FileText;
}

export function Sidebar({ rail = false }: { rail?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { requestNewChat, setSidebarOpen } = useChrome();
  const { warden, toggleWarden } = useMode();
  const { setting, setSetting } = useTheme();
  const [name, setName] = useState("Ayan");
  const [recents, setRecents] = useState<RecentConversation[] | null>(null);
  const [recentsError, setRecentsError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setName(loadPreferences().displayName || "Ayan"); } catch { /* default */ }
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((p) => {
        const list = (p.conversations ?? []) as RecentConversation[];
        setRecents(list.slice(0, 8));
        setRecentsError(false);
      })
      .catch(() => {
        setRecents([]);
        setRecentsError(true);
      });
  }, [pathname]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (footRef.current && !footRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        if (typeof window !== "undefined" && window.innerWidth < 1024) {
          setSidebarOpen(false);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        requestNewChat();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [setSidebarOpen, requestNewChat]);

  const go = (href: string) => { setMenuOpen(false); if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false); router.push(href); };
  // Order policy: most recently active conversations first, so security-test
  // commands and other older history never outrank current work. History
  // itself is never modified or hidden by this ordering.
  // No seed titles: with no real conversations the list is honestly empty.
  const recentSource = (recents ?? []).slice(0, 8);
  const filteredRecents = searchQuery.trim()
    ? recentSource.filter((c) => titleFor(c).toLowerCase().includes(searchQuery.toLowerCase()))
    : recentSource;
  const visible = showAll ? filteredRecents : filteredRecents.slice(0, 6);
  const loaded = recents !== null;

  const primaryLinks = SIDEBAR_LINKS.filter((l) => PRIMARY_HREFS.has(l.href)).sort((a, b) => PRIMARY_ORDER.indexOf(a.href) - PRIMARY_ORDER.indexOf(b.href));

  if (rail) {
    return (
      <nav className="shell-rail" aria-label="Primary">
        <span className="shell-iconbtn" aria-hidden="true" style={{ cursor: "default" }}>
          <Image src={warden ? "/assets/vow/warden.webp" : "/assets/vow/mascot.webp"} alt="VOW" width={32} height={32} />
        </span>
        <button
          type="button"
          className="shell-iconbtn"
          onClick={() => { requestNewChat(); setSidebarOpen(true); }}
          title="New chat (⌘K)"
          aria-label="New chat"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
        {primaryLinks.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.label}
              href={link.href}
              className="shell-iconbtn"
              aria-label={link.label}
              aria-current={active ? "page" : undefined}
              title={link.title}
              style={active ? { background: "var(--ds-accent-wash)", color: "var(--ds-accent)" } : undefined}
            >
              <Icon size={18} aria-hidden="true" />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside className="shell-side" aria-label="Primary">
      <div className="shell-brand">
        <Image src={warden ? "/assets/vow/warden.webp" : "/assets/vow/mascot.webp"} alt="VOW" width={34} height={34} style={{ borderRadius: "var(--ds-radius-sm)", flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="shell-brand-name">VOW</p>
          <p className="shell-brand-sub">Your AI Agent</p>
        </div>
        <button type="button" className="shell-iconbtn" aria-label="Collapse sidebar" title="Collapse sidebar (⌘\)" onClick={() => setSidebarOpen(false)} style={{ minWidth: 44 }}>
          <ChevronsLeft size={16} aria-hidden="true" />
        </button>
      </div>
      <button type="button" onClick={() => { requestNewChat(); if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false); }} className="shell-newchat" title="New chat (⌘K)">
        <Plus size={17} aria-hidden="true" />
        New Chat
      </button>
      <nav className="shell-nav" aria-label="Sections">
        {primaryLinks.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link key={`${link.label}`} href={link.href} onClick={() => { if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebarOpen(false); }} className={`shell-navlink${active ? " active" : ""}`} aria-current={active ? "page" : undefined} title={link.title}>
              <Icon size={18} aria-hidden="true" />
              {link.label}
              {(link as { expandable?: boolean }).expandable ? <ChevronRight size={15} aria-hidden="true" style={{ marginLeft: "auto" }} /> : null}
            </Link>
          );
        })}
      </nav>
      <div style={{ minHeight: 0, overflowY: "auto", flex: "none" }}>
        <p className="shell-sect">
          <span>Recent Chats</span>
          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            className="shell-iconbtn"
            style={{ minWidth: 44 }}
            title="Search chats"
            aria-label="Search chats"
            aria-expanded={showSearch}
          >
            <Search size={15} aria-hidden="true" />
          </button>
        </p>
        {showSearch ? (
          <div style={{ padding: "0 12px 8px" }}>
            <input
              type="text"
              placeholder="Filter chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="shell-filter"
              aria-label="Filter recent chats"
              autoFocus
            />
          </div>
        ) : null}
        {!loaded ? (
          <p className="shell-muted" style={{ padding: "0 16px" }} aria-live="polite">Loading conversations…</p>
        ) : recentsError ? (
          <p className="shell-muted" style={{ padding: "0 16px" }} role="alert">Could not load conversations.</p>
        ) : visible.length === 0 ? (
          <p className="shell-muted" style={{ padding: "0 16px" }}>No conversations yet.</p>
        ) : (
          <ul className="shell-recent-list">
            {visible.map((c) => {
              const Icon = iconFor(c);
              const time = relativeTime(c.updatedAt ?? latestMessageTime(c.messages));
              const title = titleFor(c);
              return (
                <li key={c.id}>
                  <Link href={`/?convo=${c.id}`} onClick={() => setSidebarOpen(false)} className="shell-recent" title={title}>
                    <span className="shell-trace-ic" aria-hidden="true"><Icon size={15} /></span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="shell-recent-t">{title}</span>
                      {time ? <span className="shell-recent-time">{time}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {recentSource.length > 5 ? (
          <button type="button" className="shell-recent" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            <span className="shell-trace-ic" aria-hidden="true"><ChevronDown size={15} style={{ transform: showAll ? "rotate(180deg)" : undefined }} /></span>
            <span className="shell-recent-t">{showAll ? "Show less" : "Show more"}</span>
          </button>
        ) : null}
      </div>
      <div className="shell-side-foot" ref={footRef}>
        {menuOpen ? (
          <div className="shell-account-menu" role="menu" aria-label="Account">
            <button type="button" role="menuitem" onClick={() => go("/account")}><UserRound size={16} aria-hidden="true" /> Account</button>
            <button type="button" role="menuitem" onClick={() => go("/settings")}><Settings size={16} aria-hidden="true" /> Settings</button>
            <button type="button" role="menuitem" onClick={() => go("/settings#shortcuts")}><CircleHelp size={16} aria-hidden="true" /> Help &amp; shortcuts</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); toggleWarden(); }}><ShieldCheck size={16} aria-hidden="true" /> {warden ? "Exit Warden mode" : "Enter Warden mode"}</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); try { localStorage.removeItem("vow-session"); } catch {} alert("Signed out on this device. Server history is kept."); }}><LogOut size={16} aria-hidden="true" /> Sign out</button>
          </div>
        ) : null}
        <button type="button" className="shell-space" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} title={`${name}’s workspace`}>
          <span className="shell-ava" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
              <circle cx="16" cy="16" r="16" fill="#6366f1" />
              <circle cx="16" cy="13" r="6" fill="#fde047" />
              <path d="M10 13c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="#312e81" />
              <path d="M6 28c0-5.5 4.5-10 10-10s10 4.5 10 10" fill="#4338ca" />
            </svg>
          </span>
          <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
            <span style={{ display: "block", fontSize: "var(--ds-text-14)", fontWeight: 600 }}>My Space</span>
            <span style={{ display: "block", fontSize: "var(--ds-text-12)", color: "var(--ds-muted)" }}>{name} · Settings</span>
          </span>
          <ChevronRight size={15} aria-hidden="true" style={{ opacity: 0.5 }} />
        </button>
        <div className="shell-theme-row">
          <p className="shell-theme-label">Theme</p>
          <div role="group" aria-label="Color theme" style={{ display: "inline-flex", gap: 2 }}>
            {(["light", "dark", "system"] as ThemeSetting[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={setting === v}
                onClick={() => setSetting(v)}
                className="shell-iconbtn"
                style={{
                  minWidth: 44,
                  fontSize: "var(--ds-text-12)",
                  fontWeight: 600,
                  textTransform: "capitalize",
                  background: setting === v ? "var(--ds-accent-wash)" : undefined,
                  color: setting === v ? "var(--ds-accent)" : undefined,
                }}
              >
                {v === "system" ? "Auto" : v}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
