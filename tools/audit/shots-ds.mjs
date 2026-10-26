import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
for (const theme of ['light', 'dark', 'warden']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  if (theme !== 'warden') await p.addInitScript((t) => { try { localStorage.setItem('vow-ds-theme-v1', t); } catch(e){} }, theme);
  await p.goto('http://localhost:3140/design-system/components' + (theme === 'warden' ? '?mode=warden' : ''), { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(800);
  if (theme === 'warden') { try { const d = p.getByText('Done (Esc)', { exact: false }); if (await d.count()) await d.first().click(); } catch {} await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(400); }
  await p.screenshot({ path: '/Users/ayan/Desktop/Wow Scr/5c-ds-components-1440-' + theme + '.png', fullPage: true });
  console.log('shot ' + theme);
  await ctx.close();
}
await browser.close();
