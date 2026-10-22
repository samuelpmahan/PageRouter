// thro app regressions in a real browser, at desktop (1280) and phone (390, touch) widths.
// Each check states what a person would notice if it broke. Exits 1 on any failure.
// Usage: node thro-app-regressions-browser.mjs http://localhost:8766/   (a built thro dist, or a preview URL)
// Env: PLAYWRIGHT_MODULE (path to playwright), CHROMIUM_PATH (browser executable), ONLY (comma list of check names).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/');
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];

async function page(width) {
  const phone = width < 500;
  const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone, isMobile: phone, acceptDownloads: true });
  const p = await context.newPage(), errors = [];
  p.on('pageerror', error => errors.push(String(error)));
  return { p, context, errors, tap: selector => phone ? p.locator(selector).first().tap() : p.locator(selector).first().click() };
}
const ready = p => p.waitForFunction(() => /Ready|Saved/.test(document.getElementById('status')?.textContent ?? '') && document.querySelector('#graphic-preview svg'), null, { timeout: 30000 });
const settle = p => p.waitForTimeout(1200);
async function check(name, run) {
  if (only && !only.has(name)) return;
  for (const width of [1280, 390]) {
    const s = await page(width);
    try {
      const failures = await run(s, width);
      if (s.errors.length) failures.push(`page errors: ${s.errors.join(' | ')}`);
      results.push({ name, width, ok: !failures.length, failures });
    } catch (error) {
      results.push({ name, width, ok: false, failures: [String(error).split('\n')[0]] });
    } finally { await s.context.close(); }
  }
}
const expect = (failures, condition, message) => { if (!condition) failures.push(message); };

// Single is one engine: every card layout comes from the same card renderer, and a fresh start lands on B01.
await check('single-one-engine', async ({ p, tap }) => {
  const f = [];
  await p.goto(base.href, { waitUntil: 'networkidle' }); await ready(p);
  const studies = await p.locator('[data-study]').evaluateAll(els => els.map(e => e.dataset.study));
  expect(f, studies.length === 11 && studies.every(s => s.startsWith('discstudio:')), `Single should offer the 11 cards from one renderer; got ${studies.length}`);
  expect(f, await p.inputValue('#composition') === 'discstudio:b01', 'a fresh Single should start on B01');
  await tap('[data-mode="battle"]'); await settle(p);
  expect(f, !(await p.inputValue('#composition')).startsWith('discstudio'), 'Battle should not inherit a Single card layout');
  await tap('[data-mode="single"]'); await settle(p);
  expect(f, await p.inputValue('#composition') === 'discstudio:b01', 'returning to Single should restore its card');
  return f;
});

// The first tap after editing downloads (busy state never swallows it), and focus stays where the person is.
await check('first-tap-download', async ({ p, tap }) => {
  const f = [];
  await p.goto(base.href, { waitUntil: 'networkidle' }); await ready(p);
  await p.selectOption('#native-side', (await p.inputValue('#native-side')) === 'left' ? 'right' : 'left');
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), tap('#download-png')]);
  expect(f, /^thro-.*-1920x1080-[0-9a-f]{8}\.png$/.test(download.suggestedFilename()), `download name looks wrong: ${download.suggestedFilename()}`);
  expect(f, await p.evaluate(() => document.activeElement?.id) === 'download-png', 'focus should stay on the download button');
  return f;
});

// Keep saves the exact version once; keeping it again says so instead of duplicating.
await check('keep-once', async ({ p, tap }) => {
  const f = [];
  await p.goto(base.href, { waitUntil: 'networkidle' }); await ready(p);
  const before = await p.locator('.capture-choice').count();
  await tap('#keep-graphic'); await settle(p);
  expect(f, (await p.locator('.downloaded strong').textContent())?.includes('Kept'), 'Keep should confirm at the button');
  await tap('#keep-graphic'); await settle(p);
  expect(f, (await p.locator('.downloaded strong').textContent())?.includes('Already kept'), 'a second Keep should say Already kept');
  expect(f, await p.locator('.capture-choice').count() === before + 1, 'Keep twice should leave exactly one new kept graphic');
  await p.reload({ waitUntil: 'networkidle' }); await ready(p);
  expect(f, await p.locator('.capture-choice').count() === before + 1, 'the kept graphic should survive a reload');
  return f;
});

// Bag lineup: each disc is its own card, no points, remembers its layout across a trip to Battle.
await check('bag-lineup', async ({ p, tap }) => {
  const f = [];
  await p.goto(base.href, { waitUntil: 'networkidle' }); await ready(p);
  await tap('[data-mode="bag"]'); await settle(p);
  const n = await p.locator('[data-disc]').count();
  for (let i = 0; i < n; i++) if (await p.locator('[data-disc]').nth(i).getAttribute('aria-pressed') !== 'true') { await tap(`[data-disc]:nth-of-type(${i + 1})`).catch(() => p.locator('[data-disc]').nth(i).click()); await settle(p); }
  await p.waitForTimeout(2500);
  const studies = await p.locator('[data-study]').evaluateAll(els => els.map(e => e.dataset.study));
  expect(f, studies.length === 5 && studies.every(s => s.startsWith('discstudio-lineup:')), `Bag should offer the 5 lineup layouts; got ${studies.join(',')}`);
  expect(f, await p.locator('[data-points]').count() === 0, 'Bag should show no points fields');
  await tap('[data-study="discstudio-lineup:u02"]'); await p.waitForTimeout(2500);
  await tap('[data-mode="battle"]'); await settle(p); await tap('[data-mode="bag"]'); await p.waitForTimeout(2500);
  expect(f, await p.inputValue('#composition') === 'discstudio-lineup:u02', 'Bag should come back on the lineup layout chosen before Battle');
  await tap('#keep-graphic'); await settle(p);
  await p.reload({ waitUntil: 'networkidle' }); await ready(p);
  expect(f, await p.locator('.capture-choice').count() >= 1, 'a kept lineup should survive a reload');
  return f;
});

// Card editor: only the drag outline and size knob sit on the card; dragging changes the card.
await check('card-editor', async ({ p }) => {
  const f = [];
  await p.goto(base.href, { waitUntil: 'networkidle' }); await ready(p);
  if (!(await p.locator('.ce-card').count())) { f.push('the card editor should be on the Single preview'); return f; }
  const onCard = await p.locator('#graphic-preview .card-editor button, #graphic-preview .card-editor [role="button"]').evaluateAll(els => els.filter(e => !e.classList.contains('ce-knob') && !e.classList.contains('ce-hint') && e.textContent.trim()).map(e => e.textContent.trim()));
  expect(f, !onCard.length, `controls should not cover the card: ${onCard.join(', ')}`);
  await p.locator('#graphic-preview').scrollIntoViewIfNeeded();
  const pixels = () => p.evaluate(() => document.querySelector('#graphic-preview image')?.getAttribute('href')?.length);
  const before = await pixels(), box = await p.locator('.ce-card').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(3000);
  expect(f, (await pixels()) !== before, 'dragging the card should change the card');
  return f;
});

// Battle lab: one model, formats as classes; the same strokes read as a round and as skins.
await check('battle-formats', async ({ p }) => {
  const f = [];
  await p.goto(new URL('battle-lab.html', base).href, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.body.dataset.done === 'true', null, { timeout: 60000 });
  const act = async fn => { await p.evaluate(() => { document.body.dataset.done = ''; }); await fn(); await p.waitForFunction(() => document.body.dataset.done === 'true', null, { timeout: 60000 }); };
  await act(() => p.click('#reset'));
  if (await p.locator('[data-name]').count() < 5) await act(() => p.click('#add'));
  if (await p.inputValue('#format') !== 'stroke') await act(() => p.selectOption('#format', 'stroke'));
  while (!(await p.locator('#prev').isDisabled())) await act(() => p.click('#prev'));
  const strokes = [[3, 2, 4, 3, 3], [3, 3, 3, 5, 2], [4, 3, 2, 3, 3], [3, 4, 3, 3, 4]], par = [3, 3, 4, 3];
  for (const [hole, row] of strokes.entries()) {
    await p.fill('#par', String(par[hole])); await act(() => p.dispatchEvent('#par', 'change'));
    for (const [i, s] of row.entries()) { await p.fill(`[data-strokes="${i}"]`, String(s)); await act(() => p.dispatchEvent(`[data-strokes="${i}"]`, 'change')); }
    if (hole < 3) await act(() => p.click('#next'));
  }
  const read = () => p.evaluate(() => window.__battle());
  const round = await read();
  expect(f, round.standings.map(r => r.show).join(' ') === '−1 −1 −1 E +1', `round to par should be −1 −1 −1 E +1; got ${round.standings.map(r => r.show).join(' ')}`);
  expect(f, round.standings.filter(r => r.pos === 'T1').length === 3, 'three players tied on −1 should all be T1');
  await act(() => p.selectOption('#format', 'skins'));
  const skins = await read();
  expect(f, skins.carry === 1 && skins.standings.filter(r => r.total === 1).length === 3, `skins should give three players one skin each with one carrying; got carry ${skins.carry}`);
  expect(f, await p.evaluate(() => document.body.dataset.rule) === 'true', 'the battle graphic should pass the hierarchy rule');
  await act(() => p.click('#reset'));
  return f;
});

await browser.close();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} @${r.width}${r.ok ? '' : '\n     ' + r.failures.join('\n     ')}`);
const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} pass`);
process.exitCode = failed ? 1 : 0;
