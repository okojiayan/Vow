# MERGE READINESS — VOW end-to-end UI pass (redesign/foundations, DO NOT merge yet)

## What changed (all visual layer; no backend logic, API, policy, or task-display.ts)
- Companion smile: deep rounded U (depth 2.7, −8° tilt) matching the render.
- Optical sizing tiers: dock smile ×1.25/eyes ×1.1, rail ×1.5/×1.2.
- Rig rule kept: face + overlays are children of the body transform group.
- WardenTransformation: click-to-skip added; onCommit fires exactly once
  (was re-firing every render with an inline handler).
- Dev-only harnesses (production-gated): `/companion-rig`, `/warden-stage`.
- Audit scripts: `tools/audit/{companion-face-rig,warden-lifecycle,
  companion-placement}.mjs`; `face-rig.mjs` (prototype); `audit2.mjs`
  hardened (commit-load + content settle instead of networkidle).
- Deleted dead `HomeMascot.tsx` + `home-mascot.css` (unreferenced, hard hex).
- Lint: fixed PersistentLiveActivity deps, Rows StatusInline import,
  settings/tools/AutonomyMenu unused vars (2 backend-file warnings left
  untouched: api/house-rules, core/keep — out of scope).
- Docs: `docs/design-principles.md`, `docs/component-inventory.md`;
  tokens changelog header in `tokens.css`.

## How to run every check
- `npx tsc --noEmit`
- `npx vitest run tests/unit/task-display.test.ts` (18/18)
- `npx vitest run` — 103 files, 681 tests, all green
- `node tools/audit/companion-face-rig.mjs` — PASS (drift 0.06-0.64px); `--sabotage` FAILS as designed
- `node tools/audit/warden-lifecycle.mjs` — 8/8 PASS
- `node tools/audit/companion-placement.mjs` — 12/12 PASS
- `node tools/audit/verify-fixes.mjs` — 47/47 PASS (combos 5x, banner 9x, palette 3x, contrast)
- `node tools/audit/contrast3.mjs` — 24/24 pairs AA
- `node tools/audit/audit2.mjs` (lum parses rgb() — prod serializes tokens as rgb, not hex) — prod build, 126 rows: 121 clean, 5 load-flake cells (parallel-run only), all 5 pass isolated recheck — 126/126 effective
- `node tools/audit/contrast3.mjs` — 24/24 pairs AA on the production build
- Home TTI (dev, hero paint): ~2.4s before → ~0.5s after the no-wait fix (WorkspaceApp renders shell+mascot+composer before /api/conversations resolves; recents load behind skeleton)
- Idle perf on prod (10s traces, headless): hero 60fps at ~41% CPU, tasks-dock 59fps at ~72% CPU — MISSES the 5% target (see open items)
- Shots: `/tmp/vow-shots/` — 60 full-app + 19 empty + 10 transformation + slots + grayscale + face-sizes

## Known limitations / open items (outside UI scope — backend decisions needed)
- Supervised vs Assisted behave identically in the policy table; the
  Settings copy says so honestly. Merge or differentiate (product call).
- Warden enforcement lives server-side; UI only reflects `/api/warden`.
- memory.store + run_sql run without approval under Supervised (stated in UI).
- skill.invoke has no inventory entry (stated in UI).
- `/api/conversations` returns ~911KB (full histories); `/api/agent` ~8MB, `/api/traces/all` ~8.5MB. Home no longer waits on them (fixed this round), but 3-5s polling of these payloads + always-on mascot animation keep idle CPU at ~40-70% vs the 5% target. Backend pagination / lighter poll payloads would fix it. Not touched (out of scope).
- If `next build` fails with no direct app page entry found for /icon.svg, clear .next and rebuild: a dev server racing the build poisons the incremental cache. Not an app bug.

## Manual click-through for the owner
Desktop + a real phone. Hero, dock and rail. Every route in all three
themes. A real task through running → approval → completed. Warden on and
off including a forced failure (`/warden-stage` documents the flows).
Companion Off / Subtle / Full in Settings > Appearance. Keyboard only
(Tab through shell, palette, dialogs; Esc closes). OS reduced-motion on.
