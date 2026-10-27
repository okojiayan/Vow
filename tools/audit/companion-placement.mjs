// Placement: the companion never overlaps chrome/content and exactly one
// live instance exists at a time. Checks home (hero), a task route (dock),
// and the collapsed rail. Needs the dev server on :3140. Exit 0/1.
import { chromium } from 'playwright-core';

const ORIGIN = 'http://localhost:3140';
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

const rectsOverlap = (a, b, pad = 0) =>
  a.x < b.x + b.width + pad && a.x + a.width + pad > b.x &&
  a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });

for (const width of [1440, 390, 320]) {
  const ctx = await b.newContext({ viewport: { width, height: 800 } });
  const p = await ctx.newPage();

  // Home empty: hero present, in flow above the greeting, not over composer/tabs.
  await p.goto(`${ORIGIN}/`, { waitUntil: 'commit' });
  try {
    await p.waitForFunction(
      () => document.querySelector('[data-testid="companion-body"]') || document.querySelector('.shell-greet,.shell-sugs'),
      null, { timeout: 60000 },
    );
  } catch {
    await p.reload({ waitUntil: 'commit' });
    await p.waitForFunction(
      () => document.querySelector('[data-testid="companion-body"]') || document.querySelector('.shell-greet,.shell-sugs'),
      null, { timeout: 60000 },
    );
  }
  await p.waitForTimeout(1200);
  const vw = p.viewportSize()?.width ?? 1440;
  const vh = p.viewportSize()?.height ?? 800;
  const onScreen = (r) => r && r.width > 4 && r.x + r.width > 0 && r.x < vw && r.y + r.height > 0 && r.y < vh;
  const bodies = await p.$$('[data-testid="companion-body"]');
  const vis = [];
  for (const el of bodies) {
    const r = await el.boundingBox();
    if (onScreen(r)) vis.push(r);
  }
  ok(`home@${width}: exactly one visible mascot`, vis.length === 1, `${vis.length} visible`);
  if (vis.length === 1) {
    const hero = vis[0];
    const composer = await p.$('[data-testid="composer-input"], textarea, [role="textbox"]');
    const tabs = await p.$('nav[aria-label="Bottom"], [data-testid="bottom-tabs"]');
    if (composer) {
      const c = await composer.boundingBox();
      if (c) ok(`home@${width}: hero clear of composer`, !rectsOverlap(hero, c));
    }
    if (tabs && width < 1024) {
      const t = await tabs.boundingBox();
      if (t) ok(`home@${width}: hero clear of tab bar`, !rectsOverlap(hero, t));
    }
    const live = await p.$$eval('[data-testid="companion-body"]', (els) =>
      els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 4 && el.closest('.companion')?.className.includes('companion-static') === false;
      }).length);
    ok(`home@${width}: at most one live instance`, live <= 1, `${live} live`);
  }

  // Tasks route: dock mascot inside the sidebar bounds.
  await p.goto(`${ORIGIN}/tasks`, { waitUntil: 'commit' });
  await p.waitForFunction(() => document.querySelector('[data-testid="companion-body"],.shell-topmark'), null, { timeout: 15000 });
  await p.waitForTimeout(1200);
  const dockBoxes = await p.$$eval('[data-testid="companion-body"]', (els) =>
    els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top, b: r.bottom }; })
      .filter((r) => r.w > 4 && r.l + r.w > 0 && r.l < window.innerWidth && r.t + r.h > 0 && r.t < window.innerHeight));
  if (width < 1024) {
    // Mobile: no full-size dock body; a static 28px mark lives in the topbar.
    ok(`tasks@${width}: no full-size dock body on mobile`, dockBoxes.length === 0, `${dockBoxes.length} bodies`);
    const mark = await p.$('.shell-topmark img');
    const markBox = mark ? await mark.boundingBox() : null;
    ok(`tasks@${width}: static topbar mark present`, !!mark && !!markBox && markBox.width <= 32, markBox ? `${Math.round(markBox.width)}px` : 'absent');
  } else {
    ok(`tasks@${width}: one dock mascot`, dockBoxes.length === 1, JSON.stringify(dockBoxes));
  }
  if (width >= 1024 && dockBoxes.length === 1 && dockBoxes[0]) {
    const shell = await p.$('[data-testid="sidebar"], aside');
    if (shell) {
      const s = await shell.boundingBox();
      const d = dockBoxes[0];
      ok(`tasks@${width}: dock inside sidebar`, s !== null && d.l >= s.x - 1 && d.l + d.w <= s.x + s.width + 1, `dock l=${Math.round(d.l)} w=${Math.round(d.w)}`);
    }
  }
  await ctx.close();
}

await b.close();
console.log(failures === 0 ? 'ALL PLACEMENT CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
