import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { root } from '../run.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const latest = JSON.parse(fs.readFileSync(path.join(root, '.pxcube/latest.json')));
const site = path.join(root, latest.site);
const evidence = path.join(root, 'evidence/create-graphics');
fs.mkdirSync(evidence, { recursive: true });
const errors = [], checks = [];
const server = http.createServer((request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/PxCube/')) throw Error('prefix');
    const file = path.resolve(site, decodeURIComponent(pathname.slice('/PxCube/'.length)) || 'index.html');
    if (!file.startsWith(site + path.sep)) throw Error('outside artifact');
    const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}/PxCube/`;
  await page.goto(base);
  await page.locator('[data-tab="exp"]').click();
  await page.locator('button.card[data-id="create-graphics"]').click();
  const frame = page.frameLocator('#thing');
  await frame.locator('#status').filter({ hasText: 'Ready' }).waitFor();
  // The shared mount may legitimately resume the other CreateGraphics purpose.
  // Select the surface under test explicitly instead of depending on retained state.
  await frame.locator('#purpose-spotlight').click();
  await frame.locator('.create-workspace').waitFor();

  assert.equal(await frame.locator('.study-card').count(), 0, 'comparison stays closed until requested');
  assert.equal(await frame.locator('#preview svg').getAttribute('width'), '1920');
  assert.equal(await frame.locator('.create-workspace').count(), 1);
  assert.equal(await frame.locator('.step-kicker').count(), 3);
  const thumbBox = await frame.locator('.material-art .art').boundingBox();
  assert.ok(thumbBox && thumbBox.width <= 110 && thumbBox.height <= 110, `material thumbnail escaped its panel: ${JSON.stringify(thumbBox)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await frame.locator('[data-create-step="choose"]').getAttribute('aria-selected'), 'true');
  assert.equal(await frame.locator('[data-create-panel].is-active').count(), 1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await frame.locator('#compare-cards').click();
  await frame.locator('#card-study[open]').waitFor();
  assert.equal(await frame.locator('#study-cards .study-card').count(), 9);
  assert.equal(await frame.locator('#study-cards .study-card img').count(), 9);
  const tileGeometry = await frame.locator('#study-cards .study-card').evaluateAll(cards => cards.map(card => {
    const tile = card.getBoundingClientRect();
    const image = card.querySelector('img').getBoundingClientRect();
    const text = [...card.querySelectorAll('.study-name,.study-note,.study-choice')].map(node => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    });
    return { tile: { top: tile.top, bottom: tile.bottom, left: tile.left, right: tile.right }, image: { top: image.top, bottom: image.bottom, left: image.left, right: image.right }, text };
  }));
  for (const { tile, image, text } of tileGeometry) {
    assert.ok(image.left >= tile.left && image.right <= tile.right && image.top >= tile.top && image.bottom <= tile.bottom);
    for (const box of text) assert.ok(box.left >= tile.left && box.right <= tile.right && box.top >= tile.top && box.bottom <= tile.bottom);
    for (const box of text.filter((_, i) => i === 0 || i === 1)) assert.ok(box.bottom <= image.top || box.top >= image.bottom, 'study text intersects image');
  }
  const svgBounds = await frame.locator('#study-cards .study-card img').evaluateAll(images => images.map(image => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const source = decodeURIComponent(image.src.split(',').slice(1).join(','));
    svg.innerHTML = source.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height);
    svg.style.cssText = 'position:fixed;left:-10000px;top:-10000px'; document.body.append(svg);
    const box = [...svg.children].reduce((union, node) => { const b = node.getBBox(); if (!union) return { x:b.x, y:b.y, right:b.x+b.width, bottom:b.y+b.height }; return { x:Math.min(union.x,b.x), y:Math.min(union.y,b.y), right:Math.max(union.right,b.x+b.width), bottom:Math.max(union.bottom,b.y+b.height) }; }, null);
    svg.remove(); return { width, height, box };
  }));
  for (const { width, height, box } of svgBounds) {
    assert.ok(width > 0 && height > 0 && box, 'study SVG has no renderable bounds');
    assert.ok(box.x >= -2 && box.y >= -2 && box.right <= width + 2 && box.bottom <= height + 2, `study SVG escapes viewBox: ${JSON.stringify({ width, height, box })}`);
  }
  assert.equal(await frame.locator('#card-study').evaluate(dialog => getComputedStyle(dialog).overflow), 'hidden');
  assert.equal(await frame.locator('#study-cards').evaluate(grid => getComputedStyle(grid).overflow), 'visible');
  const selected = frame.locator('#study-cards .study-card[aria-pressed="true"]');
  assert.equal(await selected.count(), 1);
  const compositionBounds = await page.locator('#thing').evaluate(async element => {
    const cards = await element.contentWindow.pxCubeDemo.model.studyCards();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;';
    document.body.append(holder);
    try {
      return cards.map(({ study, graphic }) => {
        holder.innerHTML = graphic.svg;
        const svg = holder.firstElementChild;
        const svgBox = svg.getBoundingClientRect();
        const overflow = [...svg.querySelectorAll('[data-node]')].map(node => {
          const box = node.getBoundingClientRect();
          return { id: node.dataset.node, left: box.left - svgBox.left, top: box.top - svgBox.top, right: box.right - svgBox.left, bottom: box.bottom - svgBox.top };
        }).filter(box => box.left < -1 || box.top < -1 || box.right > svgBox.width + 1 || box.bottom > svgBox.height + 1);
        return { id: study.id, width: graphic.width, height: graphic.height, overflow };
      });
    } finally { holder.remove(); }
  });
  assert.deepEqual(compositionBounds.filter(item => item.overflow.length), [], `authored composition bounds overflow: ${JSON.stringify(compositionBounds)}`);
  await page.screenshot({ path: path.join(evidence, 'comparison-nine.png') });
  checks.push('nine authentic rendered compositions are directly comparable in one viewport');

  await frame.locator('#study-cards .study-card').filter({ hasText: 'Crest' }).click();
  assert.equal(await frame.locator('#card-study').isVisible(), true, 'choosing a study keeps the comparison modal open');
  assert.match(await frame.locator('#study-detail-copy').textContent(), /Crest/);
  await frame.locator('#card-study[open]').waitFor();
  assert.equal(await frame.locator('#study-cards .study-card[aria-pressed="true"]').count(), 1);
  assert.match(await frame.locator('#study-cards .study-card[aria-pressed="true"] .study-choice').textContent(), /Selected/);
  const liveBounds = await page.locator('#thing').evaluate(async element => {
    const model = element.contentWindow.pxCubeDemo.model;
    const base = model.context;
    const studies = ['broadcast-rail','split-ticket','score-slip','floating-orbit','caption-ribbon','upright-tag','crest','edge-crop','number-plate'];
    const anchors = ['top-left','top-right','bottom-left','bottom-center','bottom-right'];
    const failures=[];
    for(const study of studies)for(const placement of anchors){
      const rendered=await model.render(base.selectedDisc,{...base.design,study,placement,compositionSize:'balanced',compositionScaleNudge:0,compositionOffsetX:0,compositionOffsetY:0});
      const {x,y,width,height}=rendered.graphic.bounds;
      const epsilon=1e-6;
      if(x < 60-epsilon || y < 60-epsilon || x+width > 1860+epsilon || y+height > 1020+epsilon) failures.push({study,placement,x,y,width,height});
    }
    return failures;
  });
  assert.deepEqual(liveBounds, [], `live composed geometry escapes the canvas safe bounds: ${JSON.stringify(liveBounds)}`);
  const nudgeBounds = await page.locator('#thing').evaluate(async element => {
    const model=element.contentWindow.pxCubeDemo.model,base=model.context,design={...base.design,study:'crest',placement:'bottom-center',compositionSize:'balanced',compositionScaleNudge:0};
    const neutral=await model.render(base.selectedDisc,{...design,compositionOffsetX:0,compositionOffsetY:0});
    const nudged=await model.render(base.selectedDisc,{...design,compositionOffsetX:20,compositionOffsetY:-20});
    return {neutral:neutral.graphic.bounds,nudged:nudged.graphic.bounds};
  });
  assert.equal(Math.round(nudgeBounds.nudged.x-nudgeBounds.neutral.x),20,'X nudge moves the complete composition by 20 export pixels');
  assert.equal(Math.round(nudgeBounds.nudged.y-nudgeBounds.neutral.y),-20,'Y nudge moves the complete composition by -20 export pixels');
  await frame.locator('#use-study').click();
  await frame.locator('#card-study').waitFor({ state: 'hidden' });
  await frame.locator('#preview svg').waitFor();
  await frame.locator('#graphic-title').waitFor();
  assert.equal(await frame.locator('.create-workspace').count(), 1);
  assert.equal(await frame.locator('#preview svg').getAttribute('width'), '1920');
  assert.match(await frame.locator('.choice-summary').textContent(), /Crest/);
  assert.equal(await frame.locator('#composition-size').inputValue(), 'balanced');
  assert.equal(await frame.locator('#composition-size').isVisible(), true);
  assert.equal(await frame.locator('#composition-scale-nudge').isVisible(), true);
  assert.match(await frame.locator('.create-preview > .caption').textContent(), /1920 × 1080/);
  assert.match(await frame.locator('.create-preview > .caption').textContent(), /illustrative|not to scale/i);
  const footprints = await page.locator('#thing').evaluate(async element => {
    const model = element.contentWindow.pxCubeDemo.model;
    const ids = ['broadcast-rail','split-ticket','score-slip','floating-orbit','caption-ribbon','upright-tag','crest','edge-crop','number-plate'];
    const out = [];
    for (const id of ids) {
      const balanced = await model.render(model.context.selectedDisc, { ...model.context.design, study:id, compositionScaleNudge:0, compositionOffsetX:0, compositionOffsetY:0 });
      const max = await model.render(model.context.selectedDisc, { ...model.context.design, study:id, compositionSize:'full-width', compositionScaleNudge:10, compositionOffsetX:0, compositionOffsetY:0 });
      out.push({ id, balanced: balanced.graphic.bounds, max: max.graphic.bounds });
    }
    return out;
  });
  for (const item of footprints) {
    assert.ok(item.balanced.width <= 640 && item.balanced.height <= 270, `balanced footprint too large: ${JSON.stringify(item)}`);
    assert.ok(item.max.width <= 768 && item.max.height <= 324, `max footprint too large: ${JSON.stringify(item)}`);
  }
  await frame.locator('#placement').selectOption('bottom-center');
  await frame.locator('#composition-scale-nudge').selectOption('-5');
  await frame.locator('#composition-offset-x').selectOption('20');
  await frame.locator('#composition-offset-y').selectOption('-20');
  await frame.locator('#preview svg').waitFor();
  assert.match(await frame.locator('#preview svg').innerHTML(), /scale\(0?\d/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await frame.locator('.mobile-step-nav').count(), 1);
  assert.equal(await frame.locator('[data-create-step="verify"]').getAttribute('aria-selected'), 'true');
  assert.equal(await frame.locator('[data-create-panel].is-active').count(), 1);
  for (const step of ['choose', 'verify', 'finish', 'choose']) {
    await frame.locator(`[data-create-step="${step}"]`).click();
    assert.equal(await frame.locator(`[data-create-step="${step}"]`).getAttribute('aria-selected'), 'true');
    assert.equal(await frame.locator('[data-create-panel].is-active').count(), 1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await frame.locator('#graphic-title').fill('On the course');
  await frame.locator('#graphic-title').dispatchEvent('change');
  await frame.locator('#preview').filter({ hasText: 'On the course' }).waitFor();
  await frame.locator('#keep-graphic').click();
  await frame.locator('#status').filter({ hasText: 'Kept' }).waitFor();
  const inspected = await page.locator('#thing').evaluate(element => element.contentWindow.pxCubeExperience.inspect());
  assert.equal(inspected.captures.length, 1);
  assert.equal(inspected.captures[0].value.title, 'Discraft · Buzzz');
  await page.screenshot({ path: path.join(evidence, 'editor-kept.png') });
  checks.push('selected composition returns to a focused editor with live verification and explicit Keep');

  if (await page.locator('#control-drawer-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#control-drawer-toggle').click();
  await page.locator('#back').click();
  await page.locator('button.card[data-id="export-graphics"]').click();
  await frame.locator('#status').filter({ hasText: 'Ready' }).waitFor();
  assert.equal(await frame.locator('.export-workspace').count(), 1);
  await frame.locator('#import-kept').click();
  await frame.locator('#status').filter({ hasText: '1 new captured graphic' }).waitFor();
  assert.equal(await frame.locator('.export-list button').count(), 1);
  assert.equal(await frame.locator('#preview svg').getAttribute('width'), '1920');
  assert.match(await frame.locator('.export-facts').first().textContent(), /Capture SHA-256/);
  assert.match(await frame.locator('#filename-preview').textContent(), /1920x1080/);
  assert.match(await frame.locator('#format').inputValue(), /png/);
  assert.equal(await frame.locator('#download').isEnabled(), true);
  await page.screenshot({ path: path.join(evidence, 'export-focused.png') });
  checks.push('ExportGraphics keeps one capture, its facts, navigation, and explicit download choice in one viewport');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.equal(await frame.locator('#download').isVisible(), true);
  assert.equal(await frame.locator('.export-list').evaluate(node => getComputedStyle(node).overflow), 'visible');
  await page.screenshot({ path: path.join(evidence, 'export-mobile.png') });
  checks.push('mobile ExportGraphics keeps the selected preview and download boundary reachable without a nested scroll trap');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ runId: latest.runId, checks, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'browser-failure.json'), JSON.stringify({ checks, errors, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
