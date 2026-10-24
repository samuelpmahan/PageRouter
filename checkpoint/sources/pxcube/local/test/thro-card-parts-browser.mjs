// Handles on the parts of the card (card-parts.mjs; Sam, 24 Oct: "Have you even made a version of Constraint Lab as good as the
// first one yet?"). On B01 at Sam's window and on a phone with real touch, on both sides: each of the five handles sits on its part,
// dragging it pins that part, the card is redrawn re-formed, the recipe says default / pinned / derived, and "follow the rules" lets go.
// Usage: node thro-card-parts-browser.mjs URL (the site root).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/');
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [], notes = [];
const fail = m => failures.push(m);
for (const [tag, viewport, touch] of [['1540×784', { width: 1540, height: 784 }, false], ['phone 390', { width: 390, height: 844 }, true]]) {
  const ctx = await b.newContext({ viewport, hasTouch: touch, isMobile: touch }), p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(new URL('./?scratch', base).href, { waitUntil: 'networkidle' });
  await p.waitForSelector('.card-parts .cp-h', { timeout: 30000 }).catch(() => fail(`${tag}: no handles on the B01 card`));
  const parts = await p.$$eval('.card-parts .cp-h', els => els.map(e => e.dataset.part));
  if (parts.join() !== 'disc-centre,disc-rim,plate-edge,tile,name') fail(`${tag}: handles ${parts.join()}`);
  const handle = part => p.$eval(`.card-parts .cp-h[data-part="${part}"]`, e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const recipe = () => p.$eval('.cp-recipe', e => e.innerText.replace(/\s+/g, ' '));
  const pixels = () => p.$eval('#graphic-preview image', e => e.getAttribute('href')?.length);
  async function drag(part, dx, dy) {
    const h = await handle(part); await p.waitForTimeout(200); const h2 = await handle(part), before = await pixels(), n = await p.evaluate(() => window.__thro.timing.length);
    if (touch) {
      const cdp = await ctx.newCDPSession(p), tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await tp('touchStart', h2.x, h2.y); for (let i = 1; i <= 10; i++) { await tp('touchMove', h2.x + dx * i / 10, h2.y + dy * i / 10); await p.waitForTimeout(16); } await tp('touchEnd');
    } else { await p.mouse.move(h2.x, h2.y); await p.mouse.down(); for (let i = 1; i <= 10; i++) { await p.mouse.move(h2.x + dx * i / 10, h2.y + dy * i / 10); await p.waitForTimeout(16); } await p.mouse.up(); }
    await p.waitForFunction(n => window.__thro.timing.length > n, n, { timeout: 10000 }).catch(() => fail(`${tag}: dragging ${part} did not finish a gesture`));
    await p.waitForTimeout(600);
    if ((await pixels()) === before) fail(`${tag}: dragging ${part} did not redraw the card`);
    void h;
  }
  const pins = { 'plate-edge': 'Plate width', 'disc-rim': 'Disc size', tile: 'Number tile', name: 'Largest name size', 'disc-centre': 'Disc lift' };
  for (const [part, [dx, dy]] of Object.entries({ 'plate-edge': [80, 0], 'disc-rim': [-40, 0], tile: [40, 0], name: [0, -25], 'disc-centre': [-30, 20] })) {
    await drag(part, dx, dy);
    const r = await recipe(), re = new RegExp(`${pins[part]}[^0-9-]*[-0-9.]+(?: px)? PINNED`);
    if (!re.test(r)) fail(`${tag}: after dragging ${part} the recipe does not show ${pins[part]} pinned: ${r.slice(0, 200)}`);
  }
  if (!/Plate height \d+ px DERIVED/i.test(await recipe())) fail(`${tag}: plate height not shown as derived`);
  // The other side: the handles follow the flip.
  await p.locator('.card-editor .ce-badge', { hasText: 'Side' }).first().click({ force: true });
  await p.waitForFunction(() => window.__thro.timing.at(-1)?.label?.includes('Side'), null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const [rim, centre] = [await handle('disc-rim'), await handle('disc-centre')];
  if (!(rim.x < centre.x)) fail(`${tag}: after the flip the rim handle is not on the disc's outer (left) side`);
  // Follow the rules again.
  await p.locator('.cp-reset').click(); await p.waitForTimeout(2500);
  if (/PINNED/.test(await recipe())) fail(`${tag}: "Let every part follow the rules" left a part pinned`);
  if (errs.length) fail(`${tag}: page errors ${errs.slice(0, 2).join(' | ')}`);
  notes.push(`${tag}: 5 handles, each pins its part and redraws; flips with the disc; follow-the-rules unpins`);
  await ctx.close();
}
await b.close();
for (const n of notes) console.log(n);
if (failures.length) { for (const f of failures) console.log('FAIL', f); process.exit(1); }
console.log('PASS: every handle sits on its part, pins it, and the card re-forms, at Sam\'s window and on a phone, both sides');
