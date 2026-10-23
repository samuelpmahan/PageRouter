// Rung 4 in a real browser, at 1280 and 390: every change on a Single card shows what it did in the world.
// Sequence: accent A, accent B, back to accent A, another disc, layout U04. After each: the DTree's newest change and the toast.
// Usage: node thro-propagation-browser.mjs http://localhost:8766/ [screenshot-dir]
// Env: PLAYWRIGHT_MODULE, CHROMIUM_PATH. Exits 1 on any failure.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/'), shots = process.argv[3];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [], report = [];
const expect = (width, ok, message) => { if (!ok) failures.push(`${width}: ${message}`); };

for (const width of [1280, 390]) {
  const phone = width < 500;
  const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, isMobile: phone });
  const p = await context.newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  const tap = loc => (phone ? loc.tap() : loc.click());
  await p.goto(base.href, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__dtree && window.__dtree.changes().length && document.querySelector('#graphic-preview svg'), null, { timeout: 30000 });
  const tickOf = 'const [c] = window.__dtree.changes(); return c ? c.n * 1000 + c.times : 0;'; // the list is capped at 6, so count by the newest entry
  const runs = () => p.evaluate(new Function(tickOf));
  async function step(name, act) {
    const before = await runs();
    await act();
    await p.waitForFunction(n => { const [c] = window.__dtree.changes(); return (c ? c.n * 1000 + c.times : 0) > n; }, before, { timeout: 20000 })
      .catch(async e => { throw Error(`${width} ${name}: no new screen run. ${JSON.stringify(await p.evaluate(() => ({ status: document.getElementById('status')?.textContent, comp: document.getElementById('composition')?.value, mode: document.querySelector('[data-mode][aria-pressed="true"]')?.dataset.mode, screen: window.__thro.screen?.error ?? window.__thro.screen?.receipt?.contract ?? null, changes: window.__dtree.changes().map(c => c.what) })))}`); });
    await p.waitForTimeout(400);
    const [latest] = await p.evaluate(() => window.__dtree.changes()), toast = await p.evaluate(() => window.__dtree.toast());
    report.push({ width, step: name, ...latest, toast });
    return { latest, toast };
  }
  const palette = p.locator('.swatch-choice:not(.swatch-match)');
  const a = await step('accent A', () => tap(palette.nth(1)));
  expect(width, /^accent: /.test(a.latest.what), `accent A should say what changed, said "${a.latest.what}"`);
  expect(width, a.latest.recomputed.join() === 'card recipe,the photo check', `accent A should recompute only the card recipe and the photo check on it, recomputed ${a.latest.recomputed.join(', ')}`);
  expect(width, a.latest.reused.includes("the site's decisions"), 'accent A should reuse the site\'s decisions');
  expect(width, a.latest.pixel === 'drawn', `accent A pixels should be drawn, were ${a.latest.pixel}`);
  expect(width, a.toast?.includes('Recomputed: card recipe'), `the toast should show what accent A did, showed ${a.toast}`);
  const seen = await p.evaluate(() => { const t = document.querySelector('.dtree-toast').getBoundingClientRect(); return t.top >= 0 && t.bottom <= innerHeight && t.right <= innerWidth + 1; });
  expect(width, seen, 'the toast should be on screen where the person tapped');
  await step('accent B', () => tap(palette.nth(3)));
  const back = await step('back to accent A', () => tap(palette.nth(1)));
  expect(width, back.latest.recomputed.length === 0 && back.latest.whole, 'going back to accent A should reuse the whole run');
  expect(width, back.latest.pixel === 'reused', `going back to accent A should reuse its pixels, they were ${back.latest.pixel}`);
  expect(width, back.latest.sameAs === a.latest.n, `going back should name change ${a.latest.n} as the same card, named ${back.latest.sameAs}`);
  if (shots) {
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${shots}/rung4-toast-${width}.png` }); // what the person sees right after tapping
  }
  const discs = p.locator('[data-disc]:not([aria-pressed="true"])');
  const d = await step('another disc', () => tap(discs.first()));
  expect(width, d.latest.what.includes('disc: '), `a disc change should name the disc, said "${d.latest.what}"`);
  expect(width, d.latest.recomputed.includes('card recipe'), 'a disc change should recompute the card recipe');
  expect(width, /photo: the MVP Servo, Neutron photo \(servo\.jpg.* → the Discraft Buzzz SS, Z FLX photo \(buzzz-ss\.jpg/.test(d.latest.what), `a disc change should name both photos, said "${d.latest.what}"`);
  const l = await step('layout U04', () => tap(p.locator('[data-study="discstudio:u04"]')));
  expect(width, l.latest.what.startsWith("layout: Hero rail → Kinetic name (and with it: "), `a layout change should name the layouts and what came with U04, said "${l.latest.what}"`);
  // Bag: a lineup is one card recipe per disc. An accent change is said once for every card.
  await tap(p.locator('[data-mode="bag"]')); await p.waitForTimeout(2500);
  for (let i = 0; i < await p.locator('[data-disc]').count(); i++) if (await p.locator('[data-disc]').nth(i).getAttribute('aria-pressed') !== 'true') { await tap(p.locator('[data-disc]').nth(i)); await p.waitForTimeout(1500); }
  const bag = await step('Bag: accent', () => tap(p.locator('.swatch-choice:not(.swatch-match)').nth(4)));
  expect(width, /^accent \(cards [\d, ]+\): /.test(bag.latest.what), `a lineup accent change should be said once for its cards, said "${bag.latest.what}"`);
  expect(width, bag.latest.recomputed.some(n => n.startsWith('card recipe')) && bag.latest.recomputed.includes('lineup recipe'), `a lineup accent change should recompute the card recipes and the lineup recipe, recomputed ${bag.latest.recomputed.join(', ')}`);
  if (shots) {
    await p.evaluate(() => window.__dtree.toggle(true)); await p.waitForTimeout(500);
    await p.screenshot({ path: `${shots}/rung4-dtree-${width}.png` });
    await p.locator('#dt-screen').scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
    await p.locator('#dt-screen').screenshot({ path: `${shots}/rung4-guarantees-${width}.png` });
  }
  expect(width, !errors.length, `page errors: ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
for (const r of report) console.log(`${r.width} ${r.step.padEnd(17)} #${r.n} ${r.what} | recomputed: ${r.recomputed.join(', ') || '—'} | reused: ${r.reused.join(', ') || '—'}${r.whole ? ` (run ${r.whole})` : ''} | pixels ${r.pixel}${r.sameAs ? ` | same as #${r.sameAs}` : ''}`);
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: every change shows what it did, at 1280 and 390');
process.exit(failures.length ? 1 : 0);
