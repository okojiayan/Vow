"use client";

import { useCallback, useEffect, useState } from "react";
import { Inter } from "next/font/google";
import "../tokens.css";
import "@/components/ui/ui.css";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/fields";
import { Segmented } from "@/components/ui/Segmented";
import { Tabs } from "@/components/ui/Tabs";
import {
  Badge,
  BlockedNote,
  PermissionBadge,
  StaleNote,
  StatusBadge,
  StatusInline,
  VerificationBadge,
  type TaskStatus,
} from "@/components/ui/badges";
import { ListRow, Table } from "@/components/ui/Rows";
import { Dialog, Drawer, Menu, Popover, Toast, Tooltip } from "@/components/ui/overlays";
import { EmptyState, InlineBanner, Skeleton } from "@/components/ui/feedback";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { ApprovalCard, EvidenceReceipt, StepTimeline } from "@/components/ui/trust";
import { SidebarFull, SidebarRail } from "@/components/ui/SidebarSpecimen";
import { ThemeSwitch, type ThemeChoice } from "@/components/ui/ThemeSwitch";

const inter = Inter({ subsets: ["latin"] });

const card: React.CSSProperties = {
  background: "var(--ds-surface)",
  border: "1px solid var(--ds-border)",
  borderRadius: "var(--ds-radius-lg)",
  padding: "var(--ds-space-6)",
  boxShadow: "var(--ds-elev-1)",
  marginBottom: "var(--ds-space-6)",
};

const h2: React.CSSProperties = { fontSize: "var(--ds-text-20)", fontWeight: 600, marginBottom: "var(--ds-space-2)" };
const sub: React.CSSProperties = { fontSize: "var(--ds-text-14)", color: "var(--ds-muted)", lineHeight: 1.6, marginBottom: "var(--ds-space-4)" };
const h3: React.CSSProperties = {
  fontSize: "var(--ds-text-13)",
  fontWeight: 600,
  color: "var(--ds-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  margin: "var(--ds-space-6) 0 var(--ds-space-3)",
};
const row: React.CSSProperties = { display: "flex", gap: "var(--ds-space-3)", flexWrap: "wrap", alignItems: "center" };
const mono: React.CSSProperties = { fontFamily: "var(--ds-font-mono)", fontSize: "var(--ds-text-13)" };

const statuses: TaskStatus[] = ["queued", "running", "waiting", "completed", "failed", "blocked", "unverified", "stale", "needs-review"];

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  updated: string;
}

const taskRows: TaskRow[] = [
  { id: "task_9f3k2", title: "Draft Q3 launch brief", status: "waiting", updated: "2 min ago" },
  { id: "task_7h1qd", title: "Organize workspace notes", status: "running", updated: "6 min ago" },
  { id: "task_4m8zx", title: "Verify backup receipts", status: "completed", updated: "1 h ago" },
  { id: "task_2p5rv", title: "Summarize inbox threads", status: "failed", updated: "3 h ago" },
];

export default function ComponentsShowcase() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const [notify, setNotify] = useState(true);
  const [confirmWrites, setConfirmWrites] = useState(true);
  const [density, setDensity] = useState("comfortable");
  const [tab, setTab] = useState("plan");
  const [env, setEnv] = useState("supervised");
  const [approved, setApproved] = useState<string | null>(null);

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  // Scoped Cmd+K: capture-phase so it never reaches the app-wide new-chat shortcut while mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const warden = theme === "warden";

  return (
    <div className={`ds-scope ${inter.className}`} data-theme={theme === "system" ? undefined : theme} style={{ minHeight: "100%", padding: "var(--ds-space-8)", background: "var(--ds-bg)", color: "var(--ds-ink)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ marginBottom: "var(--ds-space-8)" }}>
          <h1 style={{ fontSize: "var(--ds-text-28)", fontWeight: 600, marginBottom: "var(--ds-space-2)" }}>Component library</h1>
          <p style={{ fontSize: "var(--ds-text-14)", color: "var(--ds-muted)", lineHeight: 1.6, maxWidth: 680, marginBottom: "var(--ds-space-4)" }}>
            Every component runs on <span style={mono}>--ds-*</span> semantic tokens — no hard-coded color.
            Tab through any control to see its focus ring; interactive states are live below.
          </p>
          <ThemeSwitch value={theme} onChange={setTheme} />
        </div>

        <section style={card} aria-label="Buttons">
          <h2 style={h2}>Button</h2>
          <p style={sub}>Primary is the single bronze action per view. Loading keeps its width; disabled dims but never shifts layout.</p>
          <h3 style={h3}>Variants</h3>
          <div style={row}>
            <Button variant="primary">Approve brief</Button>
            <Button variant="secondary">Preview</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="destructive">Delete draft</Button>
          </div>
          <h3 style={h3}>Sizes</h3>
          <div style={row}>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
          <h3 style={h3}>States</h3>
          <div style={row}>
            <Button loading>Publishing</Button>
            <Button disabled>Unavailable</Button>
            <Button variant="primary" disabled loading>Working</Button>
          </div>
        </section>

        <section style={card} aria-label="Text fields">
          <h2 style={h2}>Input · Textarea · Select</h2>
          <p style={sub}>Hint text guides; error text announces via role=alert and marks the control invalid.</p>
          <div style={{ display: "grid", gap: "var(--ds-space-4)", maxWidth: 520 }}>
            <Field label="Task title" hint="Shown in the sidebar and receipts.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} defaultValue="Draft Q3 launch brief" />}
            </Field>
            <Field label="Summary" hint="One or two sentences for the activity feed.">
              {(id, describedBy) => <Textarea id={id} aria-describedby={describedBy} defaultValue="Research pass finished. Waiting on approval before writing files." />}
            </Field>
            <Field label="Execution environment">
              {(id) => (
                <Select id={id} value={env} onChange={(e) => setEnv(e.target.value)}>
                  <option value="supervised">Supervised — asks before acting</option>
                  <option value="semi">Semi-autonomous — asks for writes</option>
                  <option value="warden">Warden — every action verified</option>
                </Select>
              )}
            </Field>
            <Field label="Blocked field" error="A workspace is required before continuing.">
              {(id, describedBy) => <Input id={id} aria-describedby={describedBy} error placeholder="e.g. /workspace/notes" />}
            </Field>
            <Field label="Disabled field">
              {(id) => <Input id={id} disabled defaultValue="Cannot edit while running" />}
            </Field>
          </div>
        </section>

        <section style={card} aria-label="Selection controls">
          <h2 style={h2}>Checkbox · Switch · Segmented · Tabs</h2>
          <p style={sub}>Native inputs where possible; roving tabindex with arrow keys on segmented and tabs.</p>
          <h3 style={h3}>Checkbox</h3>
          <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
            <Checkbox label="Email me when verification completes" defaultChecked />
            <Checkbox label="Pin this task to the top of Tasks" />
            <Checkbox label="Archived runs (locked)" disabled />
          </div>
          <h3 style={h3}>Switch</h3>
          <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
            <Switch label="Notify on completion" checked={notify} onCheckedChange={setNotify} />
            <Switch label="Require approval for writes" checked={confirmWrites} onCheckedChange={setConfirmWrites} />
            <Switch label="Warden enforcement (locked)" checked={false} disabled onCheckedChange={() => {}} />
          </div>
          <h3 style={h3}>Segmented control</h3>
          <Segmented label="Density" options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} value={density} onChange={setDensity} />
          <h3 style={h3}>Tabs</h3>
          <Tabs
            label="Task detail"
            tabs={[
              { value: "plan", label: "Plan", badge: "4" },
              { value: "evidence", label: "Evidence" },
              { value: "activity", label: "Activity" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <p style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", marginTop: "var(--ds-space-3)" }}>
            Active panel: <span style={mono}>{tab}</span> · density: <span style={mono}>{density}</span>
          </p>
        </section>

        <section style={card} aria-label="Badges">
          <h2 style={h2}>Badge · Status · Verification · Permission</h2>
          <p style={sub}>Pills are reserved for badges and toggles. Every status has a dot plus a text label — never color alone.</p>
          <h3 style={h3}>Neutral</h3>
          <div style={row}>
            <Badge>4 steps</Badge>
            <Badge>EU region</Badge>
          </div>
          <h3 style={h3}>Task status</h3>
          <div style={row}>{statuses.map((s) => <StatusBadge key={s} status={s} />)}</div>
          <h3 style={h3}>Verification</h3>
          <div style={row}>
            <VerificationBadge state="verified" />
            <VerificationBadge state="unverified" />
            <VerificationBadge state="failed" />
          </div>
          <h3 style={h3}>Permission level</h3>
          <div style={row}>
            <PermissionBadge level="read" />
            <PermissionBadge level="read-append" />
            <PermissionBadge level="write" />
          </div>
          <h3 style={h3}>Inline notes</h3>
          <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
            <StaleNote />
            <BlockedNote />
          </div>
        </section>

        <section style={card} aria-label="Rows">
          <h2 style={h2}>Table · List rows</h2>
          <p style={sub}>Rows are focusable and read in order; status is always text, not color alone.</p>
          <Table<TaskRow>
            label="Recent tasks"
            columns={[
              { key: "title", header: "Task", render: (r) => r.title },
              { key: "id", header: "ID", render: (r) => <span style={mono}>{r.id}</span> },
              { key: "status", header: "Status", render: (r) => <StatusInline status={r.status} /> },
              { key: "updated", header: "Updated", render: (r) => <span style={{ color: "var(--ds-muted)" }}>{r.updated}</span> },
            ]}
            rows={taskRows}
          />
          <h3 style={h3}>List</h3>
          <div style={{ display: "grid", gap: "var(--ds-space-2)" }}>
            <ListRow title="Draft Q3 launch brief" meta="task_9f3k2 · waiting approval" />
            <ListRow title="Verify backup receipts" meta="task_4m8zx · completed in 1.8s" />
          </div>
        </section>

        <section style={card} aria-label="Overlays">
          <h2 style={h2}>Menu · Popover · Tooltip · Dialog · Drawer · Toast</h2>
          <p style={sub}>Esc closes everything; focus returns to the trigger. Menus and palettes move with arrows.</p>
          <div style={row}>
            <Menu
              label="Task actions"
              items={[
                { label: "Open detail", hint: "↵", onSelect: () => {} },
                { label: "Duplicate task", hint: "⌘D", onSelect: () => {} },
                { label: "Archive task", danger: true, onSelect: () => {} },
              ]}
            />
            <Popover label="Retention info">
              <p style={{ fontSize: "var(--ds-text-14)", fontWeight: 600, color: "var(--ds-ink)", marginBottom: 4 }}>30-day retention</p>
              <p style={{ fontSize: "var(--ds-text-13)", color: "var(--ds-muted)", lineHeight: 1.5 }}>
                Run traces and receipts are kept for 30 days in the EU region, then deleted automatically.
              </p>
            </Popover>
            <Tooltip tip="Create a new task" shortcut="⌘K">
              <Button>Hover or focus me</Button>
            </Tooltip>
            <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
            <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
            <Button onClick={() => setToastKey((k) => k + 1)}>Show toast</Button>
          </div>
          <div style={{ marginTop: "var(--ds-space-4)", display: "grid", gap: "var(--ds-space-3)", maxWidth: 420 }}>
            {toastKey > 0 ? (
              <Toast key={toastKey} title="Brief published" body="Receipt task_9f3k2 is ready in Tasks." action={{ label: "View", onPress: () => {} }} />
            ) : null}
          </div>
          <Dialog
            title="Publish launch brief?"
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            actions={
              <>
                <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setDialogOpen(false)}>Publish</Button>
              </>
            }
          >
            This writes <span style={mono}>/workspace/notes/launch.md</span> and files a verification receipt. You can undo within 30 days.
          </Dialog>
          <Drawer title="Run trace" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <div style={{ display: "grid", gap: "var(--ds-space-3)", fontSize: "var(--ds-text-14)", color: "var(--ds-ink-soft)", lineHeight: 1.6 }}>
              <p><span style={mono}>task_9f3k2</span> · 4 steps · completed in 1.8s</p>
              <p>Plan → research → draft → verify. Every step carries a deterministic receipt.</p>
              <Button onClick={() => setDrawerOpen(false)}>Close panel</Button>
            </div>
          </Drawer>
        </section>

        <section style={card} aria-label="Feedback">
          <h2 style={h2}>Banner · Empty state · Skeleton</h2>
          <div style={{ display: "grid", gap: "var(--ds-space-3)" }}>
            <InlineBanner tone="info" title="Warden is in supervised mode" body="Writes ask for approval first. Reads never do." />
            <InlineBanner tone="success" title="Backup verified" body="All 12 receipts checked against stored hashes." />
            <InlineBanner tone="warning" title="Approval waiting for 2 h" body="The launch brief draft is ready for your review." action={{ label: "Review", onPress: () => {} }} />
            <InlineBanner tone="error" title="Run failed at step 3" body="The research tool timed out. Retry or edit the plan." action={{ label: "Retry", onPress: () => {} }} />
          </div>
          <h3 style={h3}>Empty state (mascot slot, in-flow)</h3>
          <div style={{ border: "1px dashed var(--ds-border-strong)", borderRadius: "var(--ds-radius-lg)" }}>
            <EmptyState
              mascot={warden ? "warden" : "normal"}
              title="No approvals waiting"
              body="When an agent needs permission — a file write, a send, a purchase — it will appear here with its blast radius."
              action={{ label: "Review policy", onPress: () => {} }}
            />
          </div>
          <h3 style={h3}>Skeleton</h3>
          <Skeleton lines={3} label="Loading tasks" />
        </section>

        <section style={card} aria-label="Command palette">
          <h2 style={h2}>Command palette</h2>
          <p style={sub}>Opens here with ⌘K (scoped to this page) or the button. Arrows move, Enter runs, Esc closes and returns focus.</p>
          <Button variant="primary" onClick={openPalette}>Open palette (⌘K)</Button>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            items={[
              { id: "t1", label: "Draft Q3 launch brief", hint: "waiting approval", kind: "task", onRun: () => {} },
              { id: "t2", label: "Verify backup receipts", hint: "completed", kind: "task", onRun: () => {} },
              { id: "a1", label: "Start a new task", hint: "action", kind: "action", onRun: () => {} },
              { id: "g1", label: "Review Warden policy", hint: "guard", kind: "guard", onRun: () => {} },
            ]}
          />
        </section>

        <section id="signature" style={card} aria-label="Signature trust components">
          <h2 style={h2}>Signature trust components</h2>
          <p style={sub}>Designed most carefully: receipts prove work, approvals show blast radius, timelines end in verification.</p>
          <h3 style={h3}>Evidence receipt — collapsed</h3>
          <EvidenceReceipt
            taskId="task_4m8zx"
            title="Verify backup receipts"
            duration="1.8s"
            state="verified"
            checks={[
              { label: "Plan hash matches", detail: "sha256:9f3k…41ad", state: "passed" },
              { label: "12 tool calls logged", detail: "trace 01J9…77QW", state: "passed" },
              { label: "Output matches receipt", detail: "200 OK · 1.8s", state: "passed" },
            ]}
          />
          <h3 style={h3}>Evidence receipt — expanded</h3>
          <EvidenceReceipt
            taskId="task_9f3k2"
            title="Draft Q3 launch brief"
            duration="42s"
            state="unverified"
            defaultOpen
            checks={[
              { label: "Plan hash matches", detail: "sha256:7h1q…90be", state: "passed" },
              { label: "Research sources cited", detail: "3 sources · notes/brief.md", state: "passed" },
              { label: "Independent verification", detail: "awaiting reviewer sign-off", state: "pending" },
            ]}
          />
          <h3 style={h3}>Approval card</h3>
          {approved ? (
            <InlineBanner tone={approved === "approved" ? "success" : "info"} title={approved === "approved" ? "Approved — write queued" : approved === "denied" ? "Denied — nothing was written" : "Scope editor opened (demo)"} />
          ) : null}
          <div style={{ marginTop: approved ? "var(--ds-space-3)" : 0 }}>
            <ApprovalCard
              title="Write summary to launch notes?"
              tool="write_file"
              scope="Supervised · asks first"
              blastRadius={[
                { path: "/workspace/notes/launch.md", permission: "write", note: "Creates or overwrites this file" },
                { path: "/workspace/notes/", permission: "read", note: "Reads existing notes for context" },
                { path: "clipboard", permission: "read-append", note: "May append the summary for pasting" },
              ]}
              onApprove={() => setApproved("approved")}
              onDeny={() => setApproved("denied")}
              onEditScope={() => setApproved("edited")}
            />
          </div>
          <h3 style={h3}>Step timeline</h3>
          <StepTimeline
            steps={[
              { id: "s1", title: "Plan the brief", state: "completed", detail: "4 steps · 0.4s" },
              { id: "s2", title: "Research sources", state: "completed", detail: "3 sources · 28s" },
              { id: "s3", title: "Draft the document", state: "running", detail: "step 3 of 4" },
              { id: "s4", title: "Request approval", state: "waiting" },
            ]}
            verification="unverified"
          />
        </section>

        <section style={card} aria-label="Sidebar specimens">
          <h2 style={h2}>Sidebar specimens</h2>
          <p style={sub}>Isolated specimens for Stage 4 wiring — 240px sidebar and 56px rail, mascot mark in both, following the active theme.</p>
          <div style={{ display: "flex", gap: "var(--ds-space-6)", alignItems: "flex-start", flexWrap: "wrap" }}>
            <SidebarFull warden={warden} />
            <SidebarRail warden={warden} />
          </div>
        </section>
      </div>
    </div>
  );
}
