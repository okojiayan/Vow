# VOW design principles — "the quiet instrument"

One page. Everything in the UI must satisfy all four.

## 1. Quiet instrument
Flat surfaces with hairline borders (`--ds-*` tokens only, never hard-coded
hex). No eyebrow labels, gradient headlines, glass on content, glow, emoji
icons, or pill chips outside badges and toggles. One primary button per view.
Shared page header everywhere: title 28, one-line description, at most one
primary action. The interface recedes; the work is the subject.

## 2. Honesty rules
- Never show a task as running unless a live heartbeat says so.
- Agent states come from real data only (listening = mic active, running =
  executing with heartbeat, waiting = pending approval on a live task,
  verified = evidence receipt passed, blocked/failed = task failed or
  approval denied, idle otherwise).
- No fabricated data: no fake stats, activity, statuses, star ratings, or
  placeholder numbers. Missing data = honest empty state, never invented.
  No placeholder conversation titles in any production path.
- Stale vs needs-review stay calm but distinct; every status has a dot or
  icon shape that survives grayscale (queued hollow ring, running spinner,
  waiting clock, needs-review flag, unverified eye-off, stale dashed ring,
  blocked slash, failed x, completed check). Pending checks use a neutral
  clock — never the red failed x.
- Table rows: status dot + label with no tinted background. Tinted pills
  live in cards and detail views only.

## 3. Mascot rules
- The mascot is the product identity: exact silhouette, felt-black body,
  curled antenna, cream pill eyes, small rounded-U smile (curve depth 2.7,
  −8° tilt). Never redraw or restyle; every variant builds on the supplied
  renders in `public/mascot/`.
- Reserved slots, never floating over content: 176px hero (96px at 390/320)
  centered above the greeting in layout flow; 88px-tall dock slot at the
  sidebar bottom (~72px mascot) once a chat starts; 56px rail footer (~40px,
  blink + look only, no bubbles); 88px static-pose empty states; 28px
  static topbar mark on mobile. Exactly one live animated mascot at a time.
- Optical sizing keeps the face legible small (silhouette never changes):
  hero/empty = base geometry, dock = smile ×1.25 / eyes ×1.1,
  rail = smile ×1.5 / eyes ×1.2, smile length unchanged.
- Rig rule: vector eyes/smile and every overlay (armor included) are
  children of the group carrying the hop/lean/wiggle/squash transform —
  never siblings in stage coordinates. Only cursor-look, blink and smile
  morphs live inside the face.
- Warden armor (violet crystal, gold filigree) is the Warden identity.
  The transformation lifts the mascot into a temporary ~300px stage for
  under 3.5s — the one allowed exception to "never over content" — then
  returns it. Skip (Esc/click) jumps to the confirmed state, never delays
  the real request; the topbar says "Warden active" only after the real
  `/api/warden` result confirms.

## 4. Anti-pattern list (self-review every change against this)
Mascot overlapping UI; floating panels over content; duplicate controls
(e.g. two mode/activity groups); eyebrow labels; gradient/glass/glow on
content; diagnostics in user-facing copy; `rm -rf` or failure logs in seed
or default views; more than one primary button per view; tinted status
pills in table rows; color-only status; targets under 44px on mobile;
horizontal scroll from app chrome at 390/320; focus loss on dialogs,
palette, or panel; invented numbers.
