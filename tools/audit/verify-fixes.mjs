// Targeted re-verification: previously-failed combos 5x each on final code,
// palette with the correct key, light contrast, banner re-check.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const AXE = '/Users/ayan/Vow-repo/tools/audit/node_modules/axe-core/axe.min.js';
const BASE = 'http://localhost:3140';
let failures = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!c) failures += 1; };
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

// 1. Overflow combos 5x each.
for (const [route, w] of [['/search', 320], ['/routines', 320], ['/evaluation', 390]]) {
  for (let i = 0; i < 5; i++) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(BASE + route, { waitUntil: 'commit', timeout: 30000 });
    await p.waitForFunction(() => (document.querySelector('.ds-scope')?.innerText.length || 0) > 50, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`overflow ${route}@${w} run${i + 1}`, ov <= 0, `delta=${ov}`);
    await ctx.close();
  }
}
// 2. Warden theme combos 5x each.
for (const [route, w] of [['/tasks', 320], ['/search', 390], ['/library', 390]]) {
  for (let i = 0; i < 5; i++) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(BASE + route + '?mode=warden', { waitUntil: 'commit', timeout: 30000 });
    await p.waitForFunction(() => document.querySelector('.ds-scope')?.getAttribute('data-theme') === 'warden', null, { timeout: 30000 }).catch(() => {});
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(600);
    const dt = await p.evaluate(() => document.querySelector('.ds-scope')?.getAttribute('data-theme'));
    ok(`warden ${route}@${w} run${i + 1}`, dt === 'warden', `dt=${dt}`);
    await ctx.close();
  }
}
// 3. Banner fix: components page all themes/widths.
for (const theme of ['light', 'dark', 'warden']) {
  for (const w of [1440, 390, 320]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 } });
    const p = await ctx.newPage();
    if (theme !== 'light') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch (e) {} }, theme);
    await p.goto(BASE + '/design-system/components' + (theme === 'warden' ? '?mode=warden' : ''), { waitUntil: 'commit', timeout: 30000 });
    await p.waitForTimeout(2000);
    const src = fs.readFileSync(AXE, 'utf8');
    await p.evaluate((s) => { const el = document.createElement('script'); el.textContent = s; document.head.appendChild(el); }, src);
    const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => x.id === 'landmark-banner-is-top-level').length);
    ok(`banner ${theme}@${w}`, v === 0, `violations=${v}`);
    await ctx.close();
  }
}
// 4. Palette with correct key.
for (const theme of ['light', 'dark', 'warden']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  if (theme !== 'light') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch (e) {} }, theme);
  await p.goto(BASE + (theme === 'warden' ? '/?mode=warden' : '/'), { waitUntil: 'commit', timeout: 30000 });
  await p.waitForFunction(() => (document.querySelector('.ds-scope')?.innerText.length || 0) > 50, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.body.focus());
  await p.keyboard.press('Meta+k');
  await p.waitForTimeout(600);
  const opened = await p.evaluate(() => !!document.querySelector('[role="dialog"]'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const closed = await p.evaluate(() => !document.querySelector('[role="dialog"]'));
  const focusBack = await p.evaluate(() => document.activeElement && document.activeElement !== document.body);
  ok(`palette ${theme} opens/closes`, opened && closed, `opened=${opened} closed=${closed} focusMoved=${focusBack}`);
  await ctx.close();
}
// 5. Light contrast.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'commit', timeout: 30000 });
  await p.waitForFunction(() => (getComputedStyle(document.querySelector('.ds-scope')).getPropertyValue('--ds-bg') || '').trim().length > 0, null, { timeout: 30000 }).catch(() => {});
  const info = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.ds-scope')); const g = (n) => s.getPropertyValue(n).trim(); return { bg: g('--ds-bg'), ink: g('--ds-ink'), muted: g('--ds-muted'), border: g('--ds-border-strong'), accent: g('--ds-accent') }; });
  const lum = (hex) => { const v = [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const pairs = { 'ink/bg': [info.ink, info.bg], 'muted/bg': [info.muted, info.bg], 'border-strong/bg': [info.border, info.bg], 'accent/bg': [info.accent, info.bg] };
  let allAA = true;
  for (const [k, [a, c]] of Object.entries(pairs)) { const r = ratio(a, c); console.log(`  light ${k} = ${r.toFixed(2)}`); if (r < 4.5) allAA = false; }
  ok('light contrast all AA', allAA);
  await ctx.close();
}
await b.close();
console.log(failures === 0 ? 'ALL TARGETED CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
