// Reading-order handles on the card, in a real browser at 1280 and 390 (rung 6, Sam 22 Oct 23:27–23:31).
// Hidden until the on-card toggle; then over each measured part a grey fact (measured order) and a red handle (the person's order).
// Dragging a handle onto another part swaps them; the DTree's demonstration follows the person's order; the order survives a reload;
// the marks follow the card in Close-up and Whole frame. No prompts and no verdicts appear on the card.
// Usage: node thro-handles-browser.mjs http://localhost:8766/ [screenshot-dir]. Env: PLAYWRIGHT_MODULE, CHROMIUM_PATH.
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
  await p.waitForFunction(() => window.__handles && window.__thro?.screen && document.querySelector('.rh-toggle:not([hidden])'), null, { timeout: 30000 });
  const state = () => p.evaluate(() => window.__handles.state());
  expect(width, !(await state()).on && (await state()).parts.length === 0, 'handles should be hidden until the toggle is used');
  await p.locator('.rh-toggle').scrollIntoViewIfNeeded();
  await (phone ? p.locator('.rh-toggle').tap() : p.locator('.rh-toggle').click());
  await p.waitForTimeout(300);
  const preview = await p.locator('#graphic-preview').boundingBox();
  const closeup = await state();
  expect(width, closeup.parts.map(x => x.part).join() === 'disc,name,numbers,other', `four parts expected, got ${closeup.parts.map(x => x.part).join()}`);
  const inside = b => b.right > preview.x && b.left < preview.x + preview.width && b.bottom > preview.y && b.top < preview.y + preview.height;
  expect(width, closeup.parts.every(x => inside(x.box)), 'every part should sit over the preview');
  const disc = closeup.parts.find(x => x.part === 'disc'), name = closeup.parts.find(x => x.part === 'name');
  expect(width, disc.fact === 1 && name.fact === 2 && disc.mine === 1 && name.mine === 2, `B01 Servo reads disc 1, name 2, and the default order agrees: ${JSON.stringify(closeup.parts.map(x => [x.part, x.fact, x.mine]))}`);
  expect(width, disc.box.width > name.box.height, 'the disc box should be the disc photo (bigger than the name line)');
  expect(width, !(await p.locator('.rh-layer').textContent()).match(/✓|✗|adopt|should|must/i), 'no verdicts or prompts on the card');
  if (shots) await p.screenshot({ path: `${shots}/rung6-handles-closeup-${width}.png`, clip: { x: Math.max(0, preview.x - 8), y: Math.max(0, preview.y - 8), width: Math.min(width, preview.width + 16), height: preview.height + 16 } });

  // Drag the name's handle onto the disc: the person's order becomes name, disc, numbers, everything else.
  const from = await p.locator('[data-handle="name"]').boundingBox(), onto = disc.box;
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
  await p.mouse.move(onto.left + onto.width / 2, onto.top + onto.height / 2, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(300);
  const swapped = await state();
  expect(width, swapped.parts.find(x => x.part === 'name').mine === 1 && swapped.parts.find(x => x.part === 'disc').mine === 2, `after dragging, name should be 1 and disc 2: ${JSON.stringify(swapped.parts.map(x => [x.part, x.mine]))}`);
  expect(width, swapped.parts.find(x => x.part === 'disc').fact === 1, 'the measured fact does not move when the person reorders');
  // Parity (Capability Lab's third question): a script invoking the same capability gets the same order and the same demonstration.
  const parity = await p.evaluate(async () => {
    const { guarantees } = await import('./thro-world.mjs');
    const scripted = window.__thro.world.run('thro.reading.order', { order: null, swap: ['name', 'disc'] }).outputs.order;
    const stored = JSON.parse(localStorage.getItem('thro-reading-order'));
    const fromScript = guarantees(window.__thro.world, window.__thro.screen, { order: scripted }).find(g => g.cause === 'final').demonstration.thus;
    const fromHandle = guarantees(window.__thro.world, window.__thro.screen, { order: stored }).find(g => g.cause === 'final').demonstration.thus;
    return { same: JSON.stringify(scripted) === JSON.stringify(stored) && fromScript === fromHandle, scripted, stored };
  });
  expect(width, parity.same, `the handle and a script should give the same order and demonstration: ${JSON.stringify(parity)}`);
  await p.evaluate(() => window.__dtree.toggle(true)); await p.waitForTimeout(400);
  const proof = await p.locator('#dt-screen .dt-proof').textContent();
  expect(width, /Your order: name, disc, numbers, everything else/.test(proof) && /Not served in your order/.test(proof), 'the demonstration should follow the person\'s order');
  if (shots) { await p.locator('#dt-screen .dt-proof').scrollIntoViewIfNeeded(); await p.locator('#dt-screen .dt-g').screenshot({ path: `${shots}/rung6-proof-${width}.png` }); }
  // Their words for what it is for, edited where it is read.
  const purpose = p.locator('#dt-screen [data-purpose]');
  await purpose.click(); await p.keyboard.press('Control+A'); await p.keyboard.type('Ett kort för min Instagram.'); await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  expect(width, (await p.locator('#dt-screen [data-purpose]').textContent()) === 'Ett kort för min Instagram.', 'the purpose should be the person\'s own words after editing');
  await p.evaluate(() => window.__dtree.toggle(false));

  // Keyboard: ArrowDown on the name handle moves it one later (back to disc first).
  await p.locator('[data-handle="name"]').focus(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200);
  expect(width, (await state()).parts.find(x => x.part === 'name').mine === 2, 'ArrowDown should move the name one later');
  await p.locator('[data-handle="numbers"]').focus(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(200);
  const keyed = (await state()).parts.map(x => [x.part, x.mine]);

  // Whole frame: the marks follow the card (the disc box shrinks with the zoom).
  await p.locator('[data-preview-view="frame"]').click(); await p.waitForTimeout(1200);
  const frame = await state();
  expect(width, frame.parts.length === 4 && frame.parts.find(x => x.part === 'disc').box.width < disc.box.width * 0.8, `in Whole frame the disc box should be smaller than in Close-up (${Math.round(frame.parts.find(x => x.part === 'disc')?.box.width)} vs ${Math.round(disc.box.width)})`);
  if (shots) { const pv = await p.locator('#graphic-preview').boundingBox(); await p.screenshot({ path: `${shots}/rung6-handles-frame-${width}.png`, clip: { x: Math.max(0, pv.x - 8), y: Math.max(0, pv.y - 8), width: Math.min(width, pv.width + 16), height: pv.height + 16 } }); }

  // The order and the purpose are the person's: they survive a reload.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__handles?.state().parts.length === 4, null, { timeout: 30000 });
  const after = (await state()).parts.map(x => [x.part, x.mine]);
  expect(width, JSON.stringify(after) === JSON.stringify(keyed), `the order should survive a reload: ${JSON.stringify(after)} vs ${JSON.stringify(keyed)}`);
  notes.push(`${width}: close-up ${JSON.stringify(closeup.parts.map(x => [x.part, x.fact, x.mine]))}; after keys ${JSON.stringify(keyed)}`);
  expect(width, !errors.length, `page errors: ${errors.join(' | ')}`);
  await context.close();
}
await browser.close();
console.log(notes.join('\n'));
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: handles sit on the card, swap by drag and keys, drive the demonstration, follow the framing, and persist');
process.exit(failures.length ? 1 : 0);
