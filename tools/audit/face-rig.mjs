// Rig rule: the vector face (eyes/smile) must be a child of the same group
// that carries the body's hop/lean/wiggle/squash transform (#fig). If the
// face is a sibling overlay in stage coordinates, a hop leaves the eyes
// behind while the body moves.
//
// Test: measure eye offset from the body origin at rest, trigger a hop,
// re-measure at the apex, assert the offset is unchanged.
//
// Usage: NODE_PATH=$PWD/node_modules node face-rig.mjs [path-to-prototype]
// Exit 0 on pass, 1 on fail.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

const target = process.argv[2]
  ?? '/Users/ayan/Downloads/VOW companion_ motion prototype.html';

const TOL_PX = 3;      // allowed offset drift (sub-pixel rounding)
const MIN_LIFT_PX = 10; // hop must actually move the body, else the test is vacuous

const metrics = () => {
  const eye = document.querySelector('#rL').getBoundingClientRect();
  const body = document.querySelector('#fig').getBoundingClientRect();
  return {
    dx: eye.left + eye.width / 2 - body.left,
    dy: eye.top + eye.height / 2 - body.top,
    bodyTop: body.top,
  };
};

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(target).href, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const rest = await page.evaluate(metrics);
  await page.locator('#fig').click(); // hop(1): apex at ~250ms (hv=480, g=1900)
  await page.waitForTimeout(250);
  const apex = await page.evaluate(metrics);

  const lift = rest.bodyTop - apex.bodyTop;
  const drift = Math.hypot(apex.dx - rest.dx, apex.dy - rest.dy);

  console.log(`rest offset dx=${rest.dx.toFixed(2)} dy=${rest.dy.toFixed(2)}`);
  console.log(`apex offset dx=${apex.dx.toFixed(2)} dy=${apex.dy.toFixed(2)}`);
  console.log(`body lift=${lift.toFixed(1)}px drift=${drift.toFixed(2)}px (tol ${TOL_PX}px)`);
  if (errors.length) console.log(`pageerrors: ${errors.join('; ')}`);

  let fail = '';
  if (lift < MIN_LIFT_PX) fail = `hop did not move the body (lift ${lift.toFixed(1)}px) — test vacuous`;
  else if (drift > TOL_PX) fail = `FACE DETACHED: eye offset drifted ${drift.toFixed(2)}px at hop apex — face is not riding the body transform`;
  else if (errors.length) fail = `page errors: ${errors.join('; ')}`;

  console.log(fail ? `FAIL ${fail}` : 'PASS face rides the body transform');
  process.exitCode = fail ? 1 : 0;
} finally {
  await browser.close();
}
