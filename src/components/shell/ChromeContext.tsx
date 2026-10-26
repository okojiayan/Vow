"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface ChromeState {
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  newChatSignal: number;
  requestNewChat: () => void;
  prewarmSignal: number;
  requestPrewarm: () => void;
  conversationTitle: string;
  setConversationTitle: (t: string) => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  pendingApprovals: number;
  setPendingApprovals: (n: number) => void;
}

const ChromeContext = createContext<ChromeState>({
  drawerOpen: false,
  setDrawerOpen: () => {},
  toggleDrawer: () => {},
  sidebarOpen: false,
  setSidebarOpen: () => {},
  toggleSidebar: () => {},
  newChatSignal: 0,
  requestNewChat: () => {},
  prewarmSignal: 0,
  requestPrewarm: () => {},
  conversationTitle: "New chat",
  setConversationTitle: () => {},
  conversationId: null,
  setConversationId: () => {},
  unreadCount: 0,
  setUnreadCount: () => {},
  pendingApprovals: 0,
  setPendingApprovals: () => {},
});

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  // Initial states are viewport-independent so SSR and the first client
  // render agree (no hydration mismatch). The mount effect below applies the
  // responsive defaults immediately after.
  const [drawerOpen, setDrawerOpen] = useState(true);
  // Visual-verification hook (?monitor=1 or 0) and responsive initialization.
  // Parent effects run after children's, so this must never force the
  // desktop Activity open: the Activity panel's own mount effect collapses
  // itself when idle, and a forced `true` here would undo that. The `true`
  // initial above is the desktop default; mobile and explicit params close.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("monitor");
      if (q === "1") setDrawerOpen(true);
      else if (q === "0") setDrawerOpen(false);
      else if (window.innerWidth < 1024) setDrawerOpen(false);
      if (window.innerWidth < 1024) setSidebarOpen(false);
    } catch { /* ignore */ }
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newChatSignal, setNewChatSignal] = useState(0);
  const [prewarmSignal, setPrewarmSignal] = useState(0);
  const [conversationTitle, setConversationTitle] = useState("New chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const requestNewChat = useCallback(() => {
    setNewChatSignal((n) => n + 1);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, []);
  const requestPrewarm = useCallback(() => setPrewarmSignal((n) => n + 1), []);
  const value = useMemo(
    () => ({ drawerOpen, setDrawerOpen, toggleDrawer, sidebarOpen, setSidebarOpen, toggleSidebar, newChatSignal, requestNewChat, prewarmSignal, requestPrewarm, conversationTitle, setConversationTitle, conversationId, setConversationId, unreadCount, setUnreadCount, pendingApprovals, setPendingApprovals }),
    [drawerOpen, toggleDrawer, sidebarOpen, toggleSidebar, newChatSignal, requestNewChat, prewarmSignal, requestPrewarm, conversationTitle, conversationId, unreadCount, pendingApprovals],
  );
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome() {
  return useContext(ChromeContext);
}
