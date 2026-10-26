import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3140';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const now = new Date().toISOString();
const tasksBody = JSON.stringify({ tasks: [{ id: 'task-001-long-id-for-width-check', request: 'Summarize quarterly metrics for the team review with evidence', status: 'awaiting_approval', queuedAt: now, updatedAt: now, plan: { steps: [{ id: 's1', title: 'Gather metrics from the analytics warehouse', status: 'completed' }] }, verification: { passed: null, explanation: 'Awaiting approval before verification.' } }] });
for (const theme of ['light', 'dark', 'warden']) {
  for (const w of [390, 320]) {
    for (let run = 1; run <= 5; run++) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
      const p = await ctx.newPage();
      if (theme !== 'warden') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch(e){} }, theme);
      const row = { theme, w, run };
      try {
        await p.route('**/api/agent', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tasksBody }));
        await p.route('**/api/traces/all', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ traces: [] }) }));
        await p.route('**/api/approvals', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: [] }) }));
        await p.goto(BASE + '/tasks' + (theme === 'warden' ? '?mode=warden' : ''), { waitUntil: 'networkidle', timeout: 30000 });
        await p.waitForFunction(() => !!document.querySelector('table') || /No tasks yet|No tasks match/.test(document.body.textContent || ''), { timeout: 15000 });
        await p.waitForTimeout(500);
        if (theme === 'warden') { try { const d = p.getByText('Done (Esc)', { exact: false }); if (await d.count()) await d.first().click(); } catch {} await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(300); }
        row.wait = await p.evaluate(() => ({ table: !!document.querySelector('table'), stacked: getComputedStyle(document.querySelector('.ds-table tbody tr') || document.body).display }));
        row.overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        row.taps = await p.evaluate(() => {
          const els = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="tab"]')];
          const bad = [];
          for (const el of els) { const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue; if (r.bottom < 0 || r.top > innerHeight) continue; if (Math.round(r.height) < 44) bad.push({ tag: el.tagName.toLowerCase(), h: Math.round(r.height), t: (el.textContent || '').trim().slice(0, 25) }); }
          return { under44: bad.length, worst: bad.slice(0, 5) };
        });
      } catch (e) { row.error = String(e).slice(0, 120); }
      console.log(JSON.stringify(row));
      await ctx.close();
    }
  }
}
await browser.close();
console.log('TASKS-5X DONE');
