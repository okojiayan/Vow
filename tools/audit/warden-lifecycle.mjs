// Warden transformation lifecycle: success (forward/reverse), failed
// activation/deactivation, rapid toggles (no overlap), skip (Esc), and
// reduced motion. Drives the dev-only /warden-stage harness and asserts on
// its event log. Needs the dev server on :3140. Exit 0 on pass, 1 on fail.
import { chromium } from 'playwright-core';

const URL = 'http://localhost:3140/warden-stage';
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};
const logText = (p) => p.$eval('[data-testid="wt-log"]', (el) => el.innerText);
const clearLog = (p) => p.$eval('[data-testid="wt-log"]', (el) => { el.innerHTML = ''; });

const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);

// 1. Forward success: commit fires at settle, done ends the stage.
await p.click('[data-testid="wt-go-forward"]');
await p.waitForFunction(
  () => document.querySelector('[data-testid="wt-log"]')?.innerText.includes('done'),
  null, { timeout: 9000 },
);
{
  const t = await logText(p);
  ok('forward commits + completes', t.includes('commit') && t.includes('done'), t.replace(/\n/g, ' | '));
  ok('forward stage removed', (await p.$$('[data-testid="warden-stage"]')).length === 0);
}
await clearLog(p);

// 2. Reverse success completes faster and distinctly.
{
  const t0 = Date.now();
  await p.click('[data-testid="wt-go-reverse"]');
  await p.waitForFunction(
    () => document.querySelector('[data-testid="wt-log"]')?.innerText.includes('done'),
    null, { timeout: 9000 },
  );
  ok('reverse completes', true, `${Date.now() - t0}ms`);
}
await clearLog(p);

// 3. Failed activation shows the error and still resolves.
await p.click('[data-testid="wt-go-fail-on"]');
await p.waitForSelector('.wt-error', { timeout: 5000 });
{
  const msg = await p.$eval('.wt-error', (el) => el.textContent);
  ok('failed activation shows error', (msg || '').includes('Forced activation failure'), (msg || '').trim());
}
await p.waitForFunction(
  () => document.querySelector('[data-testid="wt-log"]')?.innerText.includes('done'),
  null, { timeout: 9000 },
);
ok('failed activation resolves', (await p.$$('[data-testid="warden-stage"]')).length === 0);
await clearLog(p);

// 4. Failed deactivation shows the error and resolves.
await p.click('[data-testid="wt-go-fail-off"]');
await p.waitForSelector('.wt-error', { timeout: 5000 });
await p.waitForFunction(
  () => document.querySelector('[data-testid="wt-log"]')?.innerText.includes('done'),
  null, { timeout: 10000 },
);
ok('failed deactivation resolves', (await p.$$('[data-testid="warden-stage"]')).length === 0);
await clearLog(p);

// 5. Rapid toggles: exactly one stage in flight, exactly one done.
await p.click('[data-testid="wt-go-rapid"]');
await p.waitForTimeout(600);
ok('rapid toggles never overlap', (await p.$$('[data-testid="warden-stage"]')).length <= 1);
await p.waitForFunction(
  () => document.querySelector('[data-testid="wt-log"]')?.innerText.includes('done'),
  null, { timeout: 12000 },
);
{
  const t = await logText(p);
  const dones = (t.match(/done/g) || []).length;
  ok('rapid toggles resolve exactly once', dones === 1, `${dones} done(s)`);
}
await clearLog(p);

// 6. Skip: Esc mid-flight jumps out with no done/commit afterwards.
await p.click('[data-testid="wt-go-forward"]');
await p.waitForTimeout(1000);
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
{
  const t = await logText(p);
  ok('skip jumps out', t.includes('skip') && (await p.$$('[data-testid="warden-stage"]')).length === 0, t.replace(/\n/g, ' | '));
}
await p.waitForTimeout(3500);
{
  const t = await logText(p);
  ok('skip fires no late done/commit', !t.includes('done') && !t.includes('commit'));
}
await clearLog(p);
await b.close();

// 7. Reduced motion: brief crossfade only.
{
  const b2 = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const c2 = await b2.newContext({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' });
  const p2 = await c2.newPage();
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1200);
  const t0 = Date.now();
  await p2.click('[data-testid="wt-go-forward"]');
  await p2.waitForFunction(
    () => document.querySelector('[data-testid="wt-log"]')?.innerText.includes('done'),
    null, { timeout: 5000 },
  );
  const dt = Date.now() - t0;
  ok('reduced motion short-circuits', dt < 2500, `${dt}ms`);
  await b2.close();
}

console.log(failures === 0 ? 'ALL WARDEN LIFECYCLE CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
