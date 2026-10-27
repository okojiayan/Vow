// Contrast for all three themes with rgb()/hex parsing + NaN guard.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3140';
let failures = 0;
const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lumRgb = (r, g, b) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const lum = (s) => {
  s = (s || '').trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) { const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); return lumRgb(v[0], v[1], v[2]); }
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return lumRgb(+m[1], +m[2], +m[3]);
  return NaN;
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const theme of ['light', 'dark', 'warden']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  if (theme !== 'light') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch (e) {} }, theme);
  await p.goto(BASE + (theme === 'warden' ? '/?mode=warden' : '/'), { waitUntil: 'commit', timeout: 30000 });
  await p.waitForFunction(() => (getComputedStyle(document.querySelector('.ds-scope')).getPropertyValue('--ds-bg') || '').trim().length > 0, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1000);
  if (theme === 'warden') { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(500); }
  const info = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.ds-scope')); const g = (n) => s.getPropertyValue(n); return { bg: g('--ds-bg'), surface: g('--ds-surface'), ink: g('--ds-ink'), soft: g('--ds-ink-soft'), muted: g('--ds-muted'), border: g('--ds-border-strong'), accent: g('--ds-accent') }; });
  const pairs = { 'ink/bg': [info.ink, info.bg], 'ink-soft/bg': [info.soft, info.bg], 'muted/bg': [info.muted, info.bg], 'muted/surface': [info.muted, info.surface], 'ink/surface': [info.ink, info.surface], 'border-strong/bg': [info.border, info.bg], 'border-strong/surface': [info.border, info.surface], 'accent/bg': [info.accent, info.bg] };
  for (const [k, [a, c]] of Object.entries(pairs)) {
    const r = ratio(a, c);
    const pass = Number.isFinite(r) && r >= (k.startsWith('border') ? 3 : 4.5);
    console.log(`${pass ? 'PASS' : 'FAIL'} contrast ${theme} ${k} = ${Number.isFinite(r) ? r.toFixed(2) : 'NaN'} (${a.trim()} on ${c.trim()})`);
    if (!pass) failures += 1;
  }
  await ctx.close();
}
await b.close();
console.log(failures === 0 ? 'ALL CONTRAST AA' : `${failures} CONTRAST FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
