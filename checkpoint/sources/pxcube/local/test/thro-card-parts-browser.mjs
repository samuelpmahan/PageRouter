// Handles on the parts of the card (card-parts.mjs; Sam, 24 Oct: "Have you even made a version of Constraint Lab as good as the
// first one yet?"). On B01, B04 and B05, at Sam's window and on a phone with real touch, on both sides: each handle sits on its part,
// dragging it pins that part, the card is redrawn re-formed, the recipe says default / pinned / derived, and "follow the rules" lets go.
// Also a gauge: B04 and B05 are now drawn by thro-card-core-r2.js; with nothing pinned their pixels must equal card-renderer-core.js's.
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
  if (!touch) {
    // The gauge: same disc, both sides, both cores, byte for byte.
    const diff = await p.evaluate(async () => {
      const v = '?v=28ac2b39fab85255', at = f => new URL(`./vendor/discstudio-cards/${f}${v}`, location.href).href;
      const [core, r2, adapter, molds, fonts] = await Promise.all([import(at('card-renderer-core.js')), import(at('thro-card-core-r2.js')), import(at('thro-adapter.mjs')), import(at('mold-library.js')), import(at('browser-card-renderer.js'))]);
      await fonts.ensureCardFonts();
      const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const out = [];
      for (const preset of ['b04', 'b05']) for (const discSide of ['right', 'left']) {
        const px = [];
        for (const draw of [core.drawCard, r2.drawCard]) {
          const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const ctx = c.getContext('2d');
          const card = adapter.cardFromThroDisc({ id: 'sample-servo', mold: 'mvp--servo', name: 'Servo', manufacturer: 'MVP', plastic: 'Neutron' }, { photoSrc: 'assets/discs/sample-servo.webp', flights: [6.5, 5, -1, 2] });
          await draw(ctx, card, 'horizontal', preset, { loadImage, getMoldDetails: molds.getMoldDetails, strictPhoto: true, createCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) }, { discSide, accentColor: '#c8f23d', highlightTarget: 'tiles' });
          px.push(ctx.getImageData(0, 0, 1920, 1080).data);
        }
        let n = 0; for (let i = 0; i < px[0].length; i++) if (px[0][i] !== px[1][i]) n++;
        out.push(`${preset}/${discSide}: ${n}`);
      }
      return out;
    });
    if (diff.some(d => !d.endsWith(': 0'))) fail(`gauge: B04/B05 pixels differ between the two cores: ${diff.join(', ')}`);
    else notes.push(`gauge: B04 and B05, both sides, identical bytes from both cores (${diff.join(', ')})`);
  }
  const HANDLES = { b01: 'disc-centre,disc-rim,plate-edge,tile,name', b04: 'peak,disc-rim,plate-edge,tile,name', b05: 'disc-centre,disc-rim,coin-rim,plate-edge,tile,name' };
  const MOVES = {
    b01: { 'plate-edge': [80, 0], 'disc-rim': [-40, 0], tile: [40, 0], name: [0, -25], 'disc-centre': [-30, 20] },
    b04: { 'plate-edge': [60, 0], peak: [-50, -30], 'disc-rim': [30, 0], tile: [30, 0], name: [0, -20] },
    b05: { 'plate-edge': [80, 0], 'coin-rim': [0, -20], 'disc-rim': [-30, 0], tile: [20, 0], name: [0, -20], 'disc-centre': [30, 20] },
  };
  for (const layout of ['b01', 'b04', 'b05']) {
  if (layout !== 'b01') {
    await p.locator(`[data-study="discstudio:${layout}"]`).first().click({ force: true });
    await p.waitForFunction(l => [...document.querySelectorAll('.card-parts .cp-h')].map(e => e.dataset.part).join() === l, HANDLES[layout], { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
  }
  await p.waitForSelector('.card-parts .cp-h', { timeout: 30000 }).catch(() => fail(`${tag}: no handles on the ${layout} card`));
  const parts = await p.$$eval('.card-parts .cp-h', els => els.map(e => e.dataset.part));
  if (parts.join() !== HANDLES[layout]) fail(`${tag} ${layout}: handles ${parts.join()}`);
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
  const pins = { 'plate-edge': 'Plate width', 'disc-rim': 'Disc size', tile: 'Number tile', name: 'Largest name size', 'disc-centre': layout === 'b05' ? 'Disc drop' : 'Disc lift', peak: 'Arc rise', 'coin-rim': 'Zoom circle' };
  for (const [part, [dx, dy]] of Object.entries(MOVES[layout])) {
    await drag(part, dx, dy);
    const r = await recipe(), re = new RegExp(`${pins[part]}[^0-9-]*[-0-9.]+(?: px)? PINNED`);
    if (!re.test(r)) fail(`${tag} ${layout}: after dragging ${part} the recipe does not show ${pins[part]} pinned: ${r.slice(0, 240)}`);
  }
  if (!/Plate height \d+ px DERIVED/i.test(await recipe())) fail(`${tag} ${layout}: plate height not shown as derived`);
  // The other side: the handles follow the flip.
  await p.locator('.card-editor .ce-badge', { hasText: 'Side' }).first().click({ force: true });
  await p.waitForFunction(() => window.__thro.timing.at(-1)?.label?.includes('Side'), null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const [rim, centre] = [await handle('disc-rim'), await handle(layout === 'b04' ? 'peak' : 'disc-centre')];
  if (!(rim.x < centre.x)) fail(`${tag} ${layout}: after the flip the rim handle is not on the disc's outer (left) side`);
  // Follow the rules again.
  await p.locator('.cp-reset').click(); await p.waitForTimeout(2500);
  if (/PINNED/.test(await recipe())) fail(`${tag} ${layout}: "Let every part follow the rules" left a part pinned`);
  // Back to the disc on the right for the next layout.
  await p.locator('.card-editor .ce-badge', { hasText: 'Side' }).first().click({ force: true }); await p.waitForTimeout(1500);
  notes.push(`${tag} ${layout}: ${parts.length} handles, each pins its part and redraws; flips with the disc; follow-the-rules unpins`);
  }
  if (errs.length) fail(`${tag}: page errors ${errs.slice(0, 2).join(' | ')}`);
  await ctx.close();
}
await b.close();
for (const n of notes) console.log(n);
if (failures.length) { for (const f of failures) console.log('FAIL', f); process.exit(1); }
console.log('PASS: on B01, B04 and B05 every handle sits on its part, pins it, and the card re-forms, at Sam\'s window and on a phone, both sides');
