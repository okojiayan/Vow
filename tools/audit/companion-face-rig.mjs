// Rig rule: the vector face (eyes/smile) must be a child of the same group
// that carries the body's hop/lean/wiggle/squash transform. If the face is a
// sibling overlay, a hop leaves the eyes behind while the body moves.
//
// Test: on the dev-only /companion-rig harness, measure the eye offset from
// the body origin at rest, trigger a hop via [data-testid=companion-poke],
// re-measure at the apex, assert the offset is unchanged. Also asserts the
// DOM nesting directly (face must be inside the body group).
//
// --sabotage moves the face out to a sibling overlay in the live page only
// (no source change) to prove the test fails when the rig rule is broken.
//
// Usage: node companion-face-rig.mjs [--sabotage]
// Needs the dev server on :3140. Exit 0 on pass, 1 on fail.
import { chromium } from 'playwright-core';

const sabotage = process.argv.includes('--sabotage');
const TOL_PX = 3;
const MIN_LIFT_PX = 10;

const metrics = () => {
  // Scope to <main>: the app shell can render its own (sometimes hidden)
  // rail/dock companions outside it; measuring those would be vacuous.
  const scope = document.querySelector('main') || document;
  const bodyEl = scope.querySelector('[data-testid="companion-body"]');
  const eye = scope.querySelectorAll('[data-testid="companion-eye"]')[0].getBoundingClientRect();
  const body = bodyEl.getBoundingClientRect();
  const face = bodyEl.querySelector('[data-testid="companion-face"]');
  return {
    dx: eye.left + eye.width / 2 - body.left,
    dy: eye.top + eye.height / 2 - body.top,
    bodyTop: body.top,
    nested: !!face,
  };
};

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:3140/companion-rig', { waitUntil: 'load' });
  await page.waitForSelector('main [data-testid="companion-body"] img', { state: 'visible' });
  await page.waitForTimeout(800);
  // Settle cursor tracking so the look offset is identical at rest and apex.
  const btn = await page.locator('main [data-testid="companion-poke"]').boundingBox();
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.waitForTimeout(1200);
  if (sabotage) {
    await page.evaluate(() => {
      const sc = document.querySelector('main') || document;
      const fc = sc.querySelector('[data-testid="companion-face"]');
      const bd = sc.querySelector('[data-testid="companion-body"]');
      bd.parentElement.appendChild(fc); // sibling overlay: must fail
    });
    await page.waitForTimeout(200);
  }
  const rest = await page.evaluate(metrics);
  await page.screenshot({ path: '/tmp/companion-rest.png' });
  await page.locator('main [data-testid="companion-poke"]').click();
  await page.waitForTimeout(250); // apex: hv=0.92, g=3.65/s^2 -> t~0.25s
  const apex = await page.evaluate(metrics);
  await page.screenshot({ path: '/tmp/companion-apex.png' });

  const lift = rest.bodyTop - apex.bodyTop;
  const drift = Math.hypot(apex.dx - rest.dx, apex.dy - rest.dy);
  console.log(`nested-in-body=${rest.nested}`);
  console.log(`rest offset dx=${rest.dx.toFixed(2)} dy=${rest.dy.toFixed(2)}`);
  console.log(`apex offset dx=${apex.dx.toFixed(2)} dy=${apex.dy.toFixed(2)}`);
  console.log(`body lift=${lift.toFixed(1)}px drift=${drift.toFixed(2)}px (tol ${TOL_PX}px)`);
  if (errors.length) console.log(`pageerrors: ${errors.join('; ')}`);

  let fail = '';
  if (!rest.nested) fail = 'FACE DETACHED: [data-testid=companion-face] is not inside [data-testid=companion-body]';
  else if (lift < MIN_LIFT_PX) fail = `hop did not move the body (lift ${lift.toFixed(1)}px) — test vacuous`;
  else if (drift > TOL_PX) fail = `FACE DETACHED: eye offset drifted ${drift.toFixed(2)}px at hop apex — face is not riding the body transform`;
  else if (errors.length) fail = `page errors: ${errors.join('; ')}`;
  if (sabotage) {
    if (fail) { console.log(`SABOTAGE correctly detected: ${fail}`); console.log('PASS sabotage check (test fails as designed)'); }
    else { console.log('FAIL sabotage check passed despite detached face — test is blind'); process.exitCode = 1; }
  } else {
    console.log(fail ? `FAIL ${fail}` : 'PASS face rides the body transform');
    process.exitCode = fail ? 1 : 0;
  }
} finally {
  await browser.close();
}
