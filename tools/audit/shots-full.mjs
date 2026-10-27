// Full-app screenshot set: every route x light/dark/warden @1440, main
// routes @390/320. Real app, no demo hooks. Needs dev server on :3140.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = 'http://localhost:3140';
const ROUTES = ['/', '/tasks', '/memory', '/search', '/library', '/history', '/routines', '/tools', '/skills', '/settings', '/account', '/devices', '/evaluation', '/design-system/components'];
const THEMES = ['light', 'dark', 'warden'];
const MAIN = ['/', '/tasks', '/settings'];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
fs.mkdirSync('/tmp/vow-shots', { recursive: true });
const shot = async (route, theme, w, h, tag) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  if (theme !== 'light') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); localStorage.setItem('vow-ui-preferences-v1', JSON.stringify({ theme: t === 'warden' ? 'warm' : t })); } catch (e) {} }, theme);
  const url = BASE + route + (theme === 'warden' ? (route.includes('?') ? '&mode=warden' : '?mode=warden') : '');
  await p.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await p.waitForFunction(() => (document.querySelector('.ds-scope')?.innerText.length || 0) > 50, null, { timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(1500);
  if (theme === 'warden') { await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(800); }
  const name = `${route === '/' ? 'home' : route.replace(/\//g, '')}-${theme}-${w}${tag ? '-' + tag : ''}.png`;
  await p.screenshot({ path: `/tmp/vow-shots/${name}` });
  console.log('shot', name);
  await ctx.close();
};
for (const r of ROUTES) for (const t of THEMES) await shot(r, t, 1440, 900);
for (const r of MAIN) for (const t of THEMES) { await shot(r, t, 390, 844); await shot(r, t, 320, 568); }
await b.close();
console.log('SCREENSHOTS DONE');
