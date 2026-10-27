// Transformation frames: forward + reverse at ~0.3/0.9/1.5/2.1/2.8/3.5s,
// from the dock origin on /warden-stage. Needs dev server on :3140.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
await p.goto('http://localhost:3140/warden-stage', { waitUntil: 'commit' });
await p.waitForTimeout(1500);
fs.mkdirSync('/tmp/vow-shots/wt', { recursive: true });
const grab = async (btn, tag, times) => {
  await p.click(btn);
  const t0 = Date.now();
  for (const t of times) {
    await p.waitForTimeout(Math.max(0, t * 1000 - (Date.now() - t0)));
    await p.screenshot({ path: `/tmp/vow-shots/wt/${tag}-${String(t).replace('.', 'p')}s.png` });
    console.log('frame', tag, t);
  }
  await p.waitForFunction(() => !document.querySelector('[data-testid="warden-stage"]'), null, { timeout: 15000 }).catch(() => {});
};
await grab('[data-testid="wt-go-forward"]', 'fwd', [0.3, 0.9, 1.5, 2.1, 2.8]);
await grab('[data-testid="wt-go-reverse"]', 'rev', [0.3, 0.9, 1.5, 2.1, 2.5]);
await b.close();
console.log('FRAMES DONE');
