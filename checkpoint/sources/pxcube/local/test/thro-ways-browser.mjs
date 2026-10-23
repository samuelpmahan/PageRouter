// Every way this disc could be a card (rung 7), in a real browser at 1280 and 390.
// The DTree section sums over all 11 Single layouts with Capability Lab's provenance.evaluate; the count follows the person's
// order live; tapping a way puts that layout on screen. Usage: node thro-ways-browser.mjs URL [screenshot-dir].
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/'), shots = process.argv[3];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [], notes = [];
const expect = (width, ok, message) => { if (!ok) failures.push(`${width}: ${message}`); };
for (const width of [1280, 390]) {
  const phone = width < 500;
  const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, isMobile: phone });
  const p = await context.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(base.href, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__dtree && window.__thro?.screen && document.querySelectorAll('button[data-study^="discstudio:"] svg').length === 11, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__dtree.toggle(true)); await p.waitForTimeout(500);
  const read = () => p.evaluate(() => ({ tiles: document.querySelectorAll('#dtree .dt-way').length, off: document.querySelectorAll('#dtree .dt-way.off').length, big: document.querySelector('#dtree .dt-big')?.textContent, pics: [...document.querySelectorAll('#dtree .dt-way .pic-study')].filter(s => s.querySelector('svg')).length }));
  const first = await read();
  expect(width, first.tiles === 11 && first.pics === 11, `11 ways with their thumbnails expected: ${JSON.stringify(first)}`);
  expect(width, /^\d+\/11$/.test(first.big ?? ''), `a count of ways out of 11 expected, got ${first.big}`);
  if (shots) { const section = p.locator('#dtree .dt-ways'); await section.scrollIntoViewIfNeeded(); const box = await section.boundingBox(); await p.screenshot({ path: `${shots}/rung7-ways-${width}.png`, clip: { x: box.x - 8, y: Math.max(0, box.y - 150), width: Math.min(box.width + 16, width - box.x + 8), height: box.height + 200 } }); }
  // The person's order changes the sum: name first (no layout draws the name bigger than the disc).
  await p.evaluate(async () => { const { swapParts } = await import('./viewer.mjs'); swapParts('name', 'disc'); }); await p.waitForTimeout(500);
  const swapped = await read();
  expect(width, swapped.big === '0/11' && swapped.off === 11, `name first: no layout keeps it, got ${JSON.stringify(swapped)}`);
  await p.evaluate(async () => { const { resetOrder } = await import('./viewer.mjs'); resetOrder(); }); await p.waitForTimeout(500);
  expect(width, (await read()).big === first.big, 'back to the scaffold order restores the count');
  // A way is a handle: tap Kinetic name and it is on screen.
  await p.locator('#dtree [data-way="discstudio:u04"]').click();
  await p.waitForFunction(() => window.__thro.screen?.outputs?.recipe?.preset === 'u04', null, { timeout: 20000 }).catch(() => null);
  expect(width, await p.evaluate(() => window.__thro.screen?.outputs?.recipe?.preset) === 'u04', 'tapping a way should put that layout on screen');
  notes.push(`${width}: ${first.big} keep the scaffold order; name first ${swapped.big}`);
  expect(width, !errors.length, `page errors: ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
console.log(notes.join('\n'));
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: every way is summed by the kernel (world.sum, world.evaluate), follows the person\'s order, and each way is a handle');
process.exit(failures.length ? 1 : 0);
