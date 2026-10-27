import { chromium } from 'playwright-core';
import fs from 'node:fs';
const AXE = '/Users/ayan/Vow-repo/tools/audit/node_modules/axe-core/axe.min.js';
const BASE = 'http://localhost:3140';
const ROUTES = ['/', '/tasks', '/memory', '/search', '/library', '/history', '/routines', '/tools', '/skills', '/settings', '/account', '/devices', '/evaluation', '/design-system/components'];
const THEMES = (process.env.AUDIT_THEMES ? process.env.AUDIT_THEMES.split(',') : ['light', 'dark', 'warden']);
const WIDTHS = [1440, 390, 320];
const KEY = 'vow-ds-theme-v1';
function lum(hex) {
  const m = hex.replace('#',''); if (m.length !== 6) return null;
  const v = [0,2,4].map(i => parseInt(m.slice(i,i+2),16)/255).map(x => x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4));
  return 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); if (x === null || y === null) return null; return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
// Contrast per theme from .ds-scope on home (steady state, overlay dismissed)
const contrast = {};
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  if (theme !== 'warden') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch(e){} }, theme);
  await p.goto(BASE + (theme === 'warden' ? '/?mode=warden' : '/'), { waitUntil: 'commit', timeout: 30000 });
  await p.waitForFunction(() => document.querySelector('.ds-scope')?.innerText.length > 50, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(
    (exp) => document.querySelector('.ds-scope')?.getAttribute('data-theme') === exp,
    theme, { timeout: 30000 },
  ).catch(() => {});
  await p.waitForTimeout(600);
  if (theme === 'warden') { // dismiss celebratory overlay to reach steady state
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(600);
    await p.waitForFunction(() => !document.querySelector('[data-testid="warden-stage"]'), { timeout: 8000 }).catch(() => {});
  }
  const info = await p.evaluate(() => { const el = document.querySelector('.ds-scope'); if (!el) return null; const s = getComputedStyle(el); const g = (n) => s.getPropertyValue(n).trim(); return { theme: el.getAttribute('data-theme'), bg: g('--ds-bg'), surface: g('--ds-surface'), ink: g('--ds-ink'), soft: g('--ds-ink-soft'), muted: g('--ds-muted'), border: g('--ds-border-strong'), accent: g('--ds-accent') }; }).catch(() => null);
  if (info) {
    const pairs = { 'ink/bg': [info.ink, info.bg], 'ink-soft/bg': [info.soft, info.bg], 'muted/bg': [info.muted, info.bg], 'muted/surface': [info.muted, info.surface], 'ink/surface': [info.ink, info.surface], 'border-strong/bg': [info.border, info.bg], 'border-strong/surface': [info.border, info.surface], 'accent/bg': [info.accent, info.bg] };
    contrast[theme] = { dataTheme: info.theme, pairs: Object.fromEntries(Object.entries(pairs).map(([k, [a, b]]) => [k, a && b ? Number(ratio(a, b).toFixed(2)) : null])) };
  }
  await ctx.close();
}
const report = { contrast, routes: [] };
for (const route of ROUTES) {
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w === 1440 ? 900 : 844 } });
      const p = await ctx.newPage();
      if (theme !== 'warden') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch(e){} }, theme);
      const row = { route, theme, width: w };
      try {
        await p.goto(BASE + route + (theme === 'warden' ? (route.includes('?') ? '&mode=warden' : '?mode=warden') : ''), { waitUntil: 'commit', timeout: 30000 });
        if (route === '/tasks') { await p.waitForFunction(() => !!document.querySelector('table') || /No tasks yet|No tasks match/.test(document.body.textContent || ''), { timeout: 15000 }).catch(() => {}); }
        await p.waitForFunction(() => document.querySelector('.ds-scope')?.innerText.length > 50, null, { timeout: 30000 }).catch(() => {});
        await p.waitForFunction(
          (exp) => document.querySelector('.ds-scope')?.getAttribute('data-theme') === exp,
          theme, { timeout: 30000 },
        ).catch(() => {});
        await p.waitForTimeout(700);
        if (theme === 'warden') {
          await p.keyboard.press('Escape').catch(() => {});
          await p.waitForTimeout(500);
          await p.waitForFunction(() => !document.querySelector('[data-testid="warden-stage"]'), { timeout: 8000 }).catch(() => {});
          row.overlayDismissed = await p.evaluate(() => !document.querySelector('[data-testid="warden-stage"]'));
        }
        row.dataTheme = await p.evaluate(() => { const el = document.querySelector('.ds-scope'); return el && el.getAttribute('data-theme'); }).catch(() => null);
        row.overflow = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, delta: document.documentElement.scrollWidth - window.innerWidth }));
        if (w !== 1440) {
          row.taps = await p.evaluate(() => {
            const els = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"]')];
            const bad = [];
            for (const el of els) { const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue; if (r.bottom < 0 || r.top > innerHeight) continue; const h = Math.round(r.height); if (h < 44) bad.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60), h }); }
            return { under44: bad.length, worst: bad.slice(0, 8) };
          });
        }
        const axeSrc = fs.readFileSync(AXE, 'utf8');
        await p.evaluate((src) => { const s = document.createElement('script'); s.textContent = src; document.head.appendChild(s); }, axeSrc);
        row.axe = await p.evaluate(async () => { try { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return { violations: r.violations.length, ids: r.violations.map(v => v.id + ':' + v.nodes.length) }; } catch (e) { return { error: String(e).slice(0, 120) }; } });
        // real keyboard: Tab through, then palette open/close on home
        row.kb = await p.evaluate(async () => {
          const tags = []; let lost = 0;
          document.body.focus();
          for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 30)); }
          return 'skip';
        });
        const kbRes = { stops: 0, distinct: 0, lost: 0 };
        try {
          await p.evaluate(() => document.body.focus());
          const seen = [];
          for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(80); const t = await p.evaluate(() => { const a = document.activeElement; return a ? a.tagName + ':' + ((a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 25)) : 'NONE'; }); if (t === 'BODY:') kbRes.lost++; else { kbRes.stops++; seen.push(t); } }
          kbRes.distinct = new Set(seen).size;
        } catch (e) { kbRes.error = String(e).slice(0, 100); }
        row.kb = kbRes;
        if (route === '/' && w === 1440) {
          try {
            await p.keyboard.press('Meta+K'); await p.waitForTimeout(500);
            const opened = await p.evaluate(() => !!document.querySelector('[role="dialog"]'));
            await p.keyboard.press('Escape'); await p.waitForTimeout(400);
            const closed = await p.evaluate(() => !document.querySelector('[role="dialog"]'));
            row.palette = { opened, closed };
          } catch (e) { row.palette = { error: String(e).slice(0, 100) }; }
        }
      } catch (e) { row.error = String(e).slice(0, 200); }
      fs.appendFileSync('/Users/ayan/Vow-repo/tools/audit/audit2-progress-' + (process.env.AUDIT_TAG || 'all') + '.log', JSON.stringify({ route, theme, w, dt: row.dataTheme, ov: row.overflow && row.overflow.delta, taps: row.taps && row.taps.under44, axe: row.axe, kb: row.kb && (row.kb.stops + '/' + row.kb.distinct + '/lost' + row.kb.lost), pal: row.palette }));
      report.routes.push(row);
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync('/Users/ayan/Vow-repo/tools/audit/audit2-report-' + (process.env.AUDIT_TAG || 'all') + '.json', JSON.stringify(report, null, 1));
console.log('DONE2 routes=' + report.routes.length);
console.log('CONTRAST2 ' + JSON.stringify(report.contrast));
