import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3140';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const now = new Date().toISOString();
for (const w of [390, 320]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('vow-ds-theme-v1', 'light'); } catch(e){} });
  await p.route('**/api/agent', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [{ id: 'task-appr-001', request: 'Summarize quarterly metrics', status: 'awaiting_approval', queuedAt: now, updatedAt: now, plan: { steps: [{ id: 's1', title: 'Gather', status: 'completed' }] }, verification: { passed: null, explanation: 'x' } }] }) }));
  await p.route('**/api/traces/all', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ traces: [] }) }));
  await p.route('**/api/approvals', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: [{ id: 'a1', taskId: 'task-appr-001', tool: 'filesystem.write', target: '/data/workspace/q.md', status: 'pending' }] }) }) : r.fallback());
  await p.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(500);
  await p.click('button[aria-label^="Open details for"]');
  await p.getByText('access request').first().waitFor({ timeout: 10000 });
  const m = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /^(approve|deny|edit scope)/i.test((b.textContent || '').trim()));
    const card = btns.length ? btns[0].closest('section,div') : null;
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, btns: btns.map(b => ({ t: (b.textContent || '').trim(), h: Math.round(b.getBoundingClientRect().height) })) };
  });
  console.log('APPROVAL-W' + w + ' ' + JSON.stringify(m));
  await ctx.close();
}
await browser.close();
