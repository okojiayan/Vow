# Component inventory (`src/components/ui/`, all on `--ds-*` tokens)

Every component ships default / hover / focus-visible / active / disabled /
loading / error states where they apply. Contrast verified per state; any
pair below AA is reported, not shipped silently.

## Primitives
Button (primary/secondary/ghost/destructive; 3 sizes — max one primary per
view), Input, Textarea, Select, Checkbox, Switch, Segmented, Tabs
(underline), Menu, Popover, Tooltip (with shortcut hint), Dialog, Drawer,
Toast, inline Banner, skeleton, Command palette (Cmd+K, all routes, Esc
closes, focus returns), Sidebar specimens (240px + collapsed 56px rail,
mascot mark in both, isolated specimens only).

## Status
Badge; StatusBadge (dot + label: queued, running, waiting, completed,
failed, blocked, unverified, stale, needs review); VerificationBadge
(verified / unverified / failed); PermissionBadge (read / read+append /
write); Table and list rows (status = dot + label, no tinted background).

## Signature trust components
- EvidenceReceipt (collapsed + expanded)
- ApprovalCard (Approve / Deny with leading icons + Edit scope; full-width
  stacked ≥44px targets under 480px; blast-radius rows stack: permission
  badge, mono path with overflow-wrap:anywhere, description)
- StepTimeline (plan → steps → verification; verification row shares the
  dot column, connector and alignment)
- EmptyState (optional mascot slot — 88px static companion, in-flow only)
- ThemeSwitch (Light / Dark / System + Warden as a semantic mode)

## Companion (`src/components/vow/Companion.tsx`)
Variant normal/warden; liveliness live/static/calm; states idle, listening,
running, waiting, verified, blocked; sleepy after ~60s without input;
poke escalation (hop → wiggle → cooldown + "too many pokes"); keyboard
operable (Enter/Space) with aria-label; `data-testid` hooks
(companion-body, companion-face, companion-look, companion-eye,
companion-poke) for the rig/placement audits. One shared rAF loop for the
whole app; pauses off-screen or when the tab hides. Optical tiers:
hero/empty ×1, dock eyes ×1.1/smile ×1.25, rail eyes ×1.2/smile ×1.5.

## Transformation (`src/components/vow/WardenTransformation.tsx`)
Props: entering, origin (hero/dock/rail), verdict, error, onSkip, onDone,
onCommit (fires once at settle). Forward ~3.2s (charge → orb → assembly
crown/shoulders/belt/katana/guards → reveal → ring pulse → settle);
reverse ~2.6s distinct dissolve; failed paths surface the error and roll
visuals back; Esc/click skips to confirmed; reduced-motion crossfades.
