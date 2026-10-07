import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { root } from '../run.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const latest = JSON.parse(fs.readFileSync(path.join(root, '.pxcube/latest.json'), 'utf8'));
const site = path.join(root, latest.site);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'local/test/fixtures/create-graphics-pre-sizing.json'), 'utf8'));
const server = http.createServer((request, response) => { try { const pathname = new URL(request.url, 'http://localhost').pathname; if (!pathname.startsWith('/PxCube/')) throw Error('prefix'); const file = path.resolve(site, decodeURIComponent(pathname.slice('/PxCube/'.length)) || 'index.html'); if (!file.startsWith(site + path.sep)) throw Error('outside artifact'); const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }; response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file)); } catch { response.writeHead(404).end(); } });
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); server.listen(0, '127.0.0.1'); });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20000);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: fixture.storageKey, value: fixture.storageValue });
  const base = `http://127.0.0.1:${server.address().port}/PxCube/`;
  await page.goto(base);
  const open = async () => { await page.locator('[data-tab="exp"]').click(); await page.locator('button.card[data-id="create-graphics"]').click(); const frame = page.frameLocator('#thing'); await frame.locator('#status').filter({ hasText: /Ready|Scaffold/ }).waitFor(); await frame.locator('#purpose-spotlight').click(); await frame.locator('.create-workspace').waitFor(); return frame; };
  const frame = await open();
  const migrated = await page.locator('#thing').evaluate(element => element.contentWindow.pxCubeExperience.inspect());
  assert.equal(migrated.captures.length, 1, 'migration retained exactly one capture'); assert.equal(migrated.captures[0].value.title, 'Migration check', 'authored title survived migration');
  const oldCapture = migrated.captures[0].value; assert.doesNotMatch(await frame.locator('#status').textContent(), /Restored Calculation output differs/);
  const currentRender = await page.locator('#thing').evaluate(async element => { const model = element.contentWindow.pxCubeDemo.model; const rendered = await model.render(model.context.selectedDisc, model.context.design); return rendered.graphic; });
  assert.equal(currentRender.width, 1920, 'current renderer produced a 1920px canvas after migration'); assert.equal(currentRender.height, 1080); assert.equal(currentRender.bounds.width, 640, 'new render uses the current preferred composition width'); assert.ok(currentRender.bounds.height > 0 && currentRender.bounds.height <= 270, 'new render fits the current preferred composition envelope');
  await page.reload(); const frameAfterReload = await open(); const restored = await page.locator('#thing').evaluate(element => element.contentWindow.pxCubeExperience.inspect());
  assert.equal(restored.captures.length, 1); assert.deepEqual(restored.captures[0].value, oldCapture, 'capture remains byte-for-byte stable after migration'); assert.equal(await frameAfterReload.locator('#graphic-title').inputValue(), 'Migration check'); assert.doesNotMatch(await frameAfterReload.locator('#status').textContent(), /Restored Calculation output differs/);
  console.log(`PASS CreateGraphics migration fixture opens on ${latest.runId}, preserves title/selection/capture, and renders current 640x270 geometry`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
