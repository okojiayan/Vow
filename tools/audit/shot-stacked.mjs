import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const now = new Date().toISOString();
for (const w of [390, 320]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('vow-ds-theme-v1', 'light'); } catch(e){} });
  await p.route('**/api/agent', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [{ id: 'task-001', request: 'Summarize quarterly metrics for the team review', status: 'awaiting_approval', queuedAt: now, updatedAt: now, plan: { steps: [{ id: 's1', title: 'Gather metrics', status: 'completed' }] }, verification: { passed: null, explanation: 'x' } }] }) }));
  await p.route('**/api/traces/all', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ traces: [] }) }));
  await p.route('**/api/approvals', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: [] }) }));
  await p.goto('http://localhost:3140/tasks', { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForFunction(() => !!document.querySelector('table'), { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/Users/ayan/Desktop/Wow Scr/5c-tasks-stacked-' + w + '.png' });
  await ctx.close();
}
await browser.close();
console.log('STACKED SHOTS DONE');
