import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { root } from '../run.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const latest = JSON.parse(fs.readFileSync(path.join(root, '.pxcube/latest.json')));
const site = path.join(root, latest.site);
const evidence = path.join(root, 'evidence/upload-photo');
fs.mkdirSync(evidence, { recursive: true });

const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(site, pathname.slice(1) || 'index.html');
    if (!file.startsWith(site + path.sep)) throw Error('path');
    const mime = {
      '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg', '.js': 'text/javascript',
      '.json': 'application/json', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml',
    };
    const bytes = fs.readFileSync(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('button.card[data-id="upload-disc-to-shelf"]').click();

  const sandbox = page.frameLocator('#thing');
  await sandbox.locator('#surfaces iframe:not([hidden])').waitFor();
  const surface = sandbox.frameLocator('#surfaces iframe:not([hidden])');
  await surface.locator('#mold-search').waitFor();

  assert.equal(await page.locator('#navigation').isVisible(), false);
  assert.equal(await page.locator('#ntc-strip').isVisible(), false);
  assert.equal(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded'), 'false');

  await surface.locator('#mold-search').fill('buzzz');
  await surface.locator('#mold-options [role="option"]').first().click();
  await surface.locator('#photo').setInputFiles(path.join(root, 'local/studio-demo/assets/tee-shot-original.jpg'));

  const dialog = surface.locator('#photo-crop');
  await dialog.waitFor({ state: 'visible' });
  const dialogBox = await dialog.boundingBox();
  assert.ok(dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 844, JSON.stringify(dialogBox));
  assert.equal(await surface.locator('.crop-fine').getAttribute('open'), null);
  assert.equal(await surface.locator('#crop-auto').isVisible(), true);
  assert.equal(await surface.locator('#crop-apply').isVisible(), true);
  assert.match(await surface.locator('#photo-crop-help').textContent(), /Auto-fit found|centered the photo/);

  // The launcher review affordance is mounted over this iframe. Its host must
  // stay out of hit-testing while its collapsed trigger remains interactive.
  const checklist = page.locator('tick-part-checklist');
  assert.equal(await checklist.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  assert.equal(await checklist.evaluate(node => getComputedStyle(node.shadowRoot.querySelector('#open')).pointerEvents), 'auto');
  const checklistTriggerBox = await checklist.evaluate(node => node.shadowRoot.querySelector('#open').getBoundingClientRect().toJSON());
  assert.ok(checklistTriggerBox.y < 100, JSON.stringify(checklistTriggerBox));

  const stage = surface.locator('#crop-stage');
  assert.equal(await stage.evaluate(node => getComputedStyle(node).borderRadius), '14px');
  assert.equal(await stage.evaluate(node => getComputedStyle(node, '::before').display), 'none');
  assert.equal(await stage.evaluate(node => getComputedStyle(node, '::after').display), 'none');
  const beforeScroll = await surface.locator('html').evaluate(node => node.scrollTop);
  const beforeZoom = Number.parseInt(await surface.locator('#crop-zoom-value').textContent(), 10);
  await stage.dispatchEvent('wheel', { deltaY: -100 });
  assert.equal(await surface.locator('html').evaluate(node => node.scrollTop), beforeScroll);
  assert.equal(Number.parseInt(await surface.locator('#crop-zoom-value').textContent(), 10), beforeZoom + 10);
  await surface.locator('[data-zoom-delta="-5"]').click();
  assert.equal(Number.parseInt(await surface.locator('#crop-zoom-value').textContent(), 10), beforeZoom + 5);
  await surface.locator('[data-zoom-delta="3"]').click();
  assert.ok(Number.parseInt(await surface.locator('#crop-zoom-value').textContent(), 10) > 0);
  assert.equal(await surface.locator('[data-zoom-delta]').count(), 8);
  const stageBox = await stage.boundingBox();
  const centerBefore = await surface.locator('#crop-center-x').inputValue();
  const centerYBefore = await surface.locator('#crop-center-y').inputValue();
  // Auto-fit may put the disc off-centre in a letterboxed photo. Start inside
  // the visible aperture rather than assuming the physical disc is centred.
  const centerX = Number(centerBefore), centerY = Number(centerYBefore);
  const candidates = [
    { x: stageBox.width * centerX, y: stageBox.height * centerY },
    { x: stageBox.width * centerX, y: stageBox.height / 2 },
  ];
  for (const point of candidates) {
    await page.mouse.move(stageBox.x + point.x, stageBox.y + point.y);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + point.x + 25, stageBox.y + point.y + 15);
    await page.mouse.up();
    if (await surface.locator('#crop-center-x').inputValue() !== centerBefore) break;
  }
  assert.notEqual(await surface.locator('#crop-center-x').inputValue(), centerBefore);
  assert.notEqual(await surface.locator('#crop-center-y').inputValue(), centerYBefore);
  await page.screenshot({ path: path.join(evidence, 'mobile-auto-crop.png') });

  await surface.locator('#crop-apply').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await surface.locator('#depiction-choice').inputValue(), 'photo');
  assert.equal(await surface.locator('#preview .photo-art').count(), 1);
  assert.equal(await surface.locator('#preview .photo-art').evaluate(node => getComputedStyle(node).padding), '0px');
  await surface.locator('.experimental').evaluate(node => { node.open = true; });
  for (const id of ['Color1', 'Color2', 'paint-mode', 'color-painting', 'rim-size', 'stamp-x', 'stamp-y', 'shuffle', 'paint-seed', 'customize-label', 'paint-label']) {
    assert.equal(await surface.locator(`#${id}`).isVisible(), false, `${id} should be hidden in photo mode`);
  }
  assert.equal(await surface.locator('#underglow').isVisible(), true);
  await surface.locator('#depiction-choice').selectOption('painted');
  for (const id of ['Color1', 'Color2', 'paint-mode', 'color-painting', 'rim-size', 'stamp-x', 'stamp-y', 'shuffle', 'paint-seed', 'customize-label']) {
    assert.equal(await surface.locator(`#${id}`).isVisible(), true, `${id} should be available in painting mode`);
  }

  await surface.locator('#depiction-choice').selectOption('photo');
  assert.equal(await surface.locator('#preview .photo-art').count(), 1);
  await surface.locator('#preview figure').evaluate(node => { window.finishIdentity = node; });
  await surface.locator('#underglow').fill('0.7');
  assert.equal(await surface.locator('#preview figure').evaluate(node => window.finishIdentity === node), true);
  assert.equal(await surface.locator('#preview figure').evaluate(node => node.style.getPropertyValue('--exp-glow-blur')), '24px');
  assert.equal(await surface.locator('#preview figure').evaluate(node => node.style.getPropertyValue('--exp-rim')), '0px');

  // Selecting the same camera/file twice must still emit a change after either
  // completing or cancelling the previous transient crop session.
  const sample = path.join(root, 'local/studio-demo/assets/tee-shot-original.jpg');
  await surface.locator('#photo').setInputFiles(sample);
  await dialog.waitFor({ state: 'visible' });
  await surface.locator('#crop-cancel').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await surface.locator('#photo').inputValue(), '');
  await surface.locator('#photo').setInputFiles(sample);
  await dialog.waitFor({ state: 'visible' });
  await surface.locator('#crop-cancel').click();
  await dialog.waitFor({ state: 'hidden' });

  await page.locator('#control-drawer-toggle').click();
  await page.locator('#back').click();
  assert.equal(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#navigation').isVisible(), true);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ runId: latest.runId, errors, passed: true }, null, 2) + '\n');
  console.log('PASS photo crop is automatic-first, one-viewport, scroll-safe and transient');
  console.log('PASS finish experiments update in place; photo rim stays absent while underglow works');
  console.log('PASS workspace chrome collapses for the sandbox and restores on exit');
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'browser-failure.json'), JSON.stringify({ runId: latest.runId, errors, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
