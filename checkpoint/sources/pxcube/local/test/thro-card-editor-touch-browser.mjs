// The card editor as Sam uses it (23 Oct): the handles are on the card and the card changes under the finger.
// Real touch on a phone (CDP touch events, not a mouse) at 390 × 844, plus Sam's window (1540 × 784) and 1280 × 900 with a mouse.
// Tapping the Side badge on the card flips the disc to the other side; tapping Colour moves the accent; dragging the card moves it;
// each strip control and its on-card badge are one action (pointing at one lights the other). Usage: node … URL [shots].
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/'), shots = process.argv[3];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [], notes = [];
const expect = (label, ok, message) => { if (!ok) failures.push(`${label}: ${message}`); };
const sizes = [{ label: 'phone 390 (touch)', width: 390, height: 844, touch: true }, { label: "Sam's window 1540×784", width: 1540, height: 784 }, { label: '1280×900', width: 1280, height: 900 }];
for (const size of sizes) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: !!size.touch, isMobile: !!size.touch, deviceScaleFactor: size.touch ? 3 : 1 });
  const p = await context.newPage(), errors = [], L = size.label;
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(base.href, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__thro?.screen && document.querySelector('.card-editor .ce-badge'), null, { timeout: 30000 });
  const cdp = size.touch ? await context.newCDPSession(p) : null;
  const tapAt = async (x, y) => { if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } else await p.mouse.click(x, y); };
  const dragFrom = async (x0, y0, x1, y1) => {
    if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] }); for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 12, y: y0 + (y1 - y0) * i / 12 }] }); await p.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 12 }); await p.mouse.up(); }
  };
  const appearance = () => p.evaluate(() => ({ side: window.__thro.screen?.outputs?.recipe?.appearance?.discSide, highlight: window.__thro.screen?.outputs?.recipe?.appearance?.highlightTarget, nudge: window.__thro.screen?.outputs?.recipe?.nudge ?? null }));
  const settled = async before => { await p.waitForFunction(b => JSON.stringify({ side: window.__thro.screen?.outputs?.recipe?.appearance?.discSide, highlight: window.__thro.screen?.outputs?.recipe?.appearance?.highlightTarget, nudge: window.__thro.screen?.outputs?.recipe?.nudge ?? null }) !== b, JSON.stringify(before), { timeout: 20000 }).catch(() => null); await p.waitForTimeout(400); };
  const badge = async text => { const b = p.locator('.card-editor .ce-badge', { hasText: text }).first(); await b.scrollIntoViewIfNeeded(); return b.boundingBox(); };

  // On the card, where they act.
  const labels = await p.locator('.card-editor .ce-badge').allTextContents();
  expect(L, labels.includes('⇄ Side') && labels.includes('# Colour') && labels.includes('Plate'), `Side, Colour and Plate should be on the card, found ${JSON.stringify(labels)}`);
  const preview = await p.locator('#graphic-preview').boundingBox();
  for (const text of ['⇄ Side', '# Colour']) { const b = await badge(text); const pv = await p.locator('#graphic-preview').boundingBox(); expect(L, b && b.x >= pv.x - 1 && b.x + b.width <= pv.x + pv.width + 1 && b.y >= pv.y - 1 && b.y + b.height <= pv.y + pv.height + 1, `${text} should sit on the preview`); }
  if (shots) await p.locator('#graphic-preview').screenshot({ path: `${shots}/oncard-${size.width}.png` });

  // Tap Side on the card: the disc goes to the other side.
  let before = await appearance(); let b = await badge('⇄ Side');
  await tapAt(b.x + b.width / 2, b.y + b.height / 2); await settled(before);
  let after = await appearance();
  expect(L, after.side && after.side !== before.side, `tapping Side on the card should flip the disc side (${before.side} → ${after.side})`);
  // Tap Colour on the card: the accent moves between digits and tiles.
  before = after; b = await badge('# Colour');
  await tapAt(b.x + b.width / 2, b.y + b.height / 2); await settled(before);
  after = await appearance();
  expect(L, after.highlight && after.highlight !== before.highlight, `tapping Colour on the card should move the accent (${before.highlight} → ${after.highlight})`);
  // Drag the card itself: it moves (the renderer gets a nudge), and the page does not scroll on a phone.
  before = after; const card = await p.locator('.card-editor .ce-card').boundingBox(); const y0 = await p.evaluate(() => scrollY);
  const sx = card.x + card.width * 0.25, sy = card.y + card.height * 0.5;
  await dragFrom(sx, sy, sx + Math.min(120, card.width), sy - 40); await settled(before);
  after = await appearance(); const scrolled = (await p.evaluate(() => scrollY)) - y0;
  expect(L, after.nudge && (after.nudge.x !== (before.nudge?.x ?? 0) || after.nudge.y !== (before.nudge?.y ?? 0)), `dragging the card should move it (nudge ${JSON.stringify(before.nudge)} → ${JSON.stringify(after.nudge)})`);
  expect(L, Math.abs(scrolled) < 2, `dragging the card should not scroll the page (scrolled ${scrolled})`);
  // One action, two handles: pointing at the strip control lights its badge (mouse only; touch has no hover).
  if (!size.touch) {
    await p.locator('.ce-strip .ce-act').first().hover(); await p.waitForTimeout(150);
    expect(L, await p.locator('.card-editor .ce-badge.lit').count() === 1, 'pointing at a strip control should light its badge on the card');
  }
  if (shots) await p.locator('#graphic-preview').screenshot({ path: `${shots}/oncard-after-${size.width}.png` });
  notes.push(`${L}: badges ${labels.join(', ')}; side ${before.side ?? '?'}, accent ${after.highlight}, nudge ${JSON.stringify(after.nudge)}, scrolled ${scrolled}`);
  expect(L, !errors.length, `page errors: ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
console.log(notes.join('\n'));
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: Side, Colour and Plate are on the card; tapping and dragging change the card at once, on a phone with real touch and at Sam\'s window');
process.exit(failures.length ? 1 : 0);
