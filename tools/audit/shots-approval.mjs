import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3140';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const now = new Date().toISOString();
for (const w of [390, 320]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', JSON.stringify({ theme: 'light', warden: false })); } catch(e){} });
  await p.route('**/api/agent', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [{ id: 'task-appr-001', request: 'Summarize quarterly metrics for the team review', status: 'awaiting_approval', queuedAt: now, updatedAt: now, plan: { summary: 'Draft the summary', steps: [{ id: 's1', title: 'Gather metrics', status: 'completed' }, { id: 's2', title: 'Draft summary', status: 'awaiting_approval', instruction: 'Write the draft to the workspace file' }] }, verification: { passed: null, explanation: 'Awaiting approval before verification.' } }] }) }));
  await p.route('**/api/traces/all', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ traces: [{ taskId: 'task-appr-001', events: [] }] }) }));
  await p.route('**/api/approvals', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approvals: [{ id: 'appr-1', taskId: 'task-appr-001', tool: 'filesystem.write', target: '/data/workspace/quarterly-summary.md', status: 'pending' }] }) });
    return r.fallback();
  });
  await p.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(600);
  await p.click('button[aria-label^="Open details for"]');
  await p.getByText('access request').first().waitFor({ timeout: 10000 });
  await p.waitForTimeout(400);
  const info = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /approve|deny|edit scope/i.test(b.textContent || ''));
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, btns: btns.map(b => ({ t: (b.textContent || '').trim().slice(0, 20), h: Math.round(b.getBoundingClientRect().height) })) };
  });
  console.log('width ' + w + ' ' + JSON.stringify(info));
  await p.screenshot({ path: '/Users/ayan/Desktop/Wow Scr/5c-approval-' + w + '.png' });
  await ctx.close();
}
await browser.close();
console.log('SHOTS DONE');
