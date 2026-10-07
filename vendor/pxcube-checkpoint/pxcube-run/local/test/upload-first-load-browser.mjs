import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { root } from '../run.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const latest = JSON.parse(fs.readFileSync(path.join(root, '.pxcube/latest.json')));
const site = path.join(root, latest.site);
const server = http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(site, pathname.slice(1) || 'index.html');
    if (!file.startsWith(site + path.sep)) throw Error('path');
    const bytes = fs.readFileSync(file);
    const mime = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.mjs':'text/javascript', '.svg':'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store' });
    response.end(bytes);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless:true, ...(process.env.CHROME_BIN ? { executablePath:process.env.CHROME_BIN } : {}) });
const runs = [];
try {
  const base = `http://127.0.0.1:${server.address().port}/experiences/upload-disc-to-shelf/index.html`;
  for (let index = 0; index < 5; index++) {
    const context = await browser.newContext({ viewport:{ width:390, height:844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const started = performance.now();
    await page.goto(base, { waitUntil:'domcontentloaded' });
    const sandbox = page.frameLocator('#surfaces iframe:not([hidden])');
    const input = sandbox.locator('#mold-search');
    await input.waitFor({ state:'visible' });
    assert.equal(await input.isEnabled(), true);
    const firstUsableMs = performance.now() - started;
    assert.deepEqual(errors, []);
    runs.push(Math.round(firstUsableMs));
    await context.close();
  }
  const ordered = [...runs].sort((a,b) => a-b);
  const result = { runsMs:runs, medianMs:ordered[2], slowestMs:ordered.at(-1), runId:latest.runId };
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
