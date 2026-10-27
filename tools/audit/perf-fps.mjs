// Companion perf: fps + idle CPU over 5s on /companion-rig (live hero).
// Needs dev server on :3140.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await (await b.newContext({ viewport: { width: 800, height: 800 } })).newPage();
await p.goto('http://localhost:3140/companion-rig', { waitUntil: 'commit' });
await p.waitForTimeout(2000);
const fps = await p.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n += 1; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else res((n / (performance.now() - t0) * 1000).toFixed(1)); };
  requestAnimationFrame(tick);
}));
console.log('FPS ' + fps);
await b.close();
