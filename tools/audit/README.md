# VOW UI audit harness

Playwright + axe-core checks for every route at 1440 / 390 / 320 in
light, dark, and Warden themes. Needs the dev server on :3140 and
`npm install` here (playwright-core drives the installed Chrome).

- Full audit (overflow, tap targets, axe, keyboard, contrast):
  `NODE_PATH=$PWD/node_modules node audit2.mjs` (writes `audit2-report.json`)
- /tasks repeat check, 5 runs per width/theme with render wait:
  `NODE_PATH=$PWD/node_modules node tasks-5x.mjs`
- Approval-card button heights at 390/320:
  `NODE_PATH=$PWD/node_modules node measure-approval.mjs`
- Screenshots: `shots-approval.mjs`, `shots-ds.mjs`, `shot-stacked.mjs`
  (output goes to `~/Desktop/Wow Scr/`).

Warden runs dismiss the celebratory transformation overlay first, so the
numbers describe the steady-state theme. `?demo=` hooks are production-gated
in the app; `?mode=warden` only selects the theme for verification.
- Face-rig rule (React component): `node companion-face-rig.mjs [--sabotage]` (exit 1 if the eyes do not ride the body hop; `--sabotage` detaches the face in-page only to prove the test fails).
- Face-rig rule (mascot prototype): `NODE_PATH=$PWD/node_modules node face-rig.mjs [file]` (exit 1 if the eyes do not ride the body hop).
