// The card revision review page (rung 9), in a real browser at 1280 and 390.
// It must draw every Single layout for every prepared disc under both values of the site's revision decision, prove by PNG bytes
// which layouts are identical (expected: all but B01 and U04), show revision 1 breaking Sam's scaffold where revision 2 keeps it,
// record a decision in this browser only, and be reachable from the DTree. Usage: node thro-revision-review-browser.mjs URL [shots].
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/'), shots = process.argv[3];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [], notes = [];
const expect = (width, ok, message) => { if (!ok) failures.push(`${width}: ${message}`); };
for (const width of [1280, 390]) {
  const phone = width < 500;
  const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, isMobile: phone });
  const p = await context.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e))); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  // Reachable from the DTree's card revision decision.
  await p.goto(base.href + '?dtree', { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.querySelector('#dtree:not([hidden]) a[href="./revision-review.html"]'), null, { timeout: 30000 }).catch(() => null);
  expect(width, await p.locator('#dtree a[href="./revision-review.html"]').count() === 1, 'the DTree should link to the review from the card revision decision');
  const before = await p.evaluate(() => Object.keys(localStorage).sort());
  const started = Date.now();
  await p.goto(new URL('revision-review.html', base).href);
  await p.waitForFunction(() => window.__review?.done, null, { timeout: 240000 });
  const review = await p.evaluate(() => window.__review);
  expect(width, !review.error, `drawing failed: ${review.error}`);
  expect(width, review.results?.length === 33, `33 disc × layout pairs expected, got ${review.results?.length}`);
  expect(width, JSON.stringify([...review.changed].sort()) === JSON.stringify(['b01', 'u04']), `only B01 and U04 should change, got ${review.changed}`);
  for (const r of review.results.filter(x => !x.same)) {
    expect(width, r.drew[0] === 1 && r.drew[1] === 2, `${r.layout} ${r.disc}: the renderer should report revisions 1 and 2, reported ${r.drew}`);
    expect(width, r.scaffold[0] === false && r.scaffold[1] === true, `${r.layout} ${r.disc}: revision 1 breaks the scaffold, revision 2 keeps it (got ${r.scaffold})`);
  }
  const sections = await p.evaluate(() => [...document.querySelectorAll('section.layout')].map(s => ({ id: s.id, collapsed: s.classList.contains('collapsed'), imgs: s.querySelectorAll('img').length })));
  expect(width, sections.length === 11 && sections.slice(0, 2).every(s => !s.collapsed && s.imgs === 6) && sections.slice(2).every(s => s.collapsed && s.imgs === 3), `changed layouts first with pairs, identical ones after with one card each: ${JSON.stringify(sections)}`);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  expect(width, wide, 'no sideways scrolling');
  if (shots) await p.screenshot({ path: `${shots}/rung9-review-${width}.png` });
  // The decision is recorded in this browser only; nothing else in storage changes.
  await p.locator('[data-choice="accept"]').click();
  const after = await p.evaluate(() => ({ keys: Object.keys(localStorage).sort(), value: JSON.parse(localStorage.getItem('thro-revision-review')), pressed: document.querySelector('[data-choice="accept"]').getAttribute('aria-pressed') }));
  expect(width, after.value?.choice === 'accept' && after.pressed === 'true', 'the choice should be recorded and shown');
  expect(width, JSON.stringify(after.keys.filter(k => k !== 'thro-revision-review')) === JSON.stringify(before.filter(k => k !== 'thro-revision-review')), `nothing else in storage should change: ${JSON.stringify(before)} → ${JSON.stringify(after.keys)}`);
  notes.push(`${width}: ${review.results.length} pairs in ${Math.round((Date.now() - started) / 1000)} s; changed ${review.changed.join(', ')}; ${review.results.filter(r => r.same).length} identical by PNG bytes`);
  expect(width, !errors.length, `page errors: ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
console.log(notes.join('\n'));
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: every layout drawn under both revisions; only B01 and U04 change; the decision stays in this browser');
process.exit(failures.length ? 1 : 0);
