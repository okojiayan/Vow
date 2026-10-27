// Empty-state shots on the isolated empty-data server (:3141).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = 'http://localhost:3141';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
fs.mkdirSync('/tmp/vow-shots', { recursive: true });
const shot = async (route, theme, w, h, name) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  if (theme !== 'light') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch (e) {} }, theme);
  await p.goto(BASE + route + (theme === 'warden' ? '?mode=warden' : ''), { waitUntil: 'commit', timeout: 30000 });
  await p.waitForFunction(() => (document.querySelector('.ds-scope')?.innerText.length || 0) > 50, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  if (theme === 'warden') { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(600); }
  await p.screenshot({ path: `/tmp/vow-shots/empty-${name}.png` });
  console.log('shot empty-' + name);
  await ctx.close();
};
for (const t of ['light', 'dark', 'warden']) {
  await shot('/', t, 1440, 900, `home-${t}-1440`);
  await shot('/tasks', t, 1440, 900, `tasks-${t}-1440`);
  await shot('/memory', t, 1440, 900, `memory-${t}-1440`);
  await shot('/evaluation', t, 1440, 900, `evaluation-${t}-1440`);
  await shot('/routines', t, 1440, 900, `routines-${t}-1440`);
}
await shot('/', 'light', 390, 844, 'home-light-390');
await shot('/', 'dark', 390, 844, 'home-dark-390');
await shot('/tasks', 'light', 390, 844, 'tasks-light-390');
await shot('/tasks', 'light', 320, 568, 'tasks-light-320');
await b.close();
console.log('EMPTY SHOTS DONE');
