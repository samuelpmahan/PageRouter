import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { root, build } from '../run.mjs';
import { workspace, cli } from './scaffold-helpers.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const repo = workspace(), evidence = path.join(root, 'evidence/build-bag-scaffold');
const checks = [], errors = [], requests = [];
let browser, host;
fs.mkdirSync(evidence, { recursive: true });
try {
  assert.equal(fs.existsSync(path.join(repo, 'experiences/build-bag')), false);
  const generated = cli(repo, 'scaffold', '--from-tidy', 'pxcube-build-bag');
  assert.equal(generated.status, 0, generated.stderr);
  const { site, report } = await build(repo);
  assert.equal(report.results[0].ok, true, report.results[0].error);
  host = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const relative = url.pathname.replace(/^\/PxCube\//, '/').replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(site, relative);
      if (!file.startsWith(site + path.sep)) throw Error('outside artifact');
      const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      const bytes = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { host.once('error', reject); host.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${host.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  for (const prefix of ['/', '/PxCube/']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await page.addInitScript(() => localStorage.setItem('discstudio.pxc.shelf.v1', 'existing user shelf'));
    await page.goto(origin + prefix);
    await page.locator('[data-tab="exp"]').click();
    await page.locator('button.card[data-id="build-bag"]').click();
    const frame = page.frameLocator('#thing');
    await frame.locator('#status').filter({ hasText: 'Scaffold ready' }).waitFor();
    assert.equal(await frame.locator('h1').textContent(), 'BuildBag');
    assert.match(await frame.locator('#inputs').textContent(), /Buzzz/);
    assert.equal(await frame.locator('#mount-name').textContent(), 'mock.build-bag');
    const inspect = () => page.locator('#thing').evaluate(el => el.contentWindow.pxCubeScaffold.inspect());
    const initial = await inspect();
    assert.equal(Object.hasOwn(initial.runs['mock.build-bag'].value.px, 'bags'), false);
    await frame.locator('#draft-name').fill('My fairway bag');
    await frame.getByRole('button', { name: 'Save draft' }).click();
    await frame.locator('#status').filter({ hasText: 'Draft saved' }).waitFor();
    const saved = (await inspect()).runs['mock.build-bag'];
    assert.equal(saved.value.sc.draft.name, 'My fairway bag');
    assert.equal(saved.changes[0].address, 'sc.draft');
    await frame.locator('#new-test').click();
    await frame.locator('#mount-name').filter({ hasText: 'mock.build-bag.1' }).waitFor();
    assert.equal(await frame.locator('#draft-name').inputValue(), 'Untitled bag');
    await frame.locator('#draft-name').fill('Only test one');
    await frame.getByRole('button', { name: 'Save draft' }).click();
    await frame.locator('#status').filter({ hasText: 'Draft saved' }).waitFor();
    await frame.locator('#new-test').click();
    await frame.locator('#mount-name').filter({ hasText: 'mock.build-bag.2' }).waitFor();
    assert.equal(await frame.locator('#draft-name').inputValue(), 'Untitled bag');
    await frame.locator('#interactive').click();
    await page.waitForFunction(() => document.querySelector('#thing')?.contentDocument?.getElementById('draft-name')?.value === 'My fairway bag');
    const retained = await inspect();
    assert.deepEqual(retained.runs['mock.build-bag'], saved);
    assert.equal(retained.runs['mock.build-bag.1'].value.sc.draft.name, 'Only test one');
    await assert.rejects(page.locator('#thing').evaluate(el => el.contentWindow.pxCubeScaffold.resolve('mock.build-bag.1.sc.draft')), /outside/);
    if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click(); await page.locator('#back').click(); await page.locator('button.card[data-id="build-bag"]').click();
    assert.deepEqual(await inspect(), retained);
    await page.reload(); await page.locator('[data-tab="exp"]').click(); await page.locator('button.card[data-id="build-bag"]').click();
    await frame.locator('#status').filter({ hasText: 'Scaffold ready' }).waitFor();
    assert.deepEqual(await inspect(), retained);
    assert.equal(await frame.locator('#draft-name').inputValue(), 'My fairway bag');
    assert.equal(await page.evaluate(() => localStorage.getItem('discstudio.pxc.shelf.v1')), 'existing user shelf');
    assert.match(await frame.locator('#outputs').textContent(), /Not produced/);
    const receipt = await (await page.request.get(origin + prefix + 'experiences/build-bag/pxcube-receipt.json')).json();
    assert.equal(receipt.manifestSource.type, 'pxcube-build-bag');
    assert.equal(receipt.build.exitCode, 0);
    if (prefix === '/') {
      await page.screenshot({ path: path.join(evidence, 'build-bag.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator('#thing').evaluate(el => el.contentDocument.documentElement.scrollWidth <= el.contentDocument.documentElement.clientWidth), true);
    }
    checks.push({ prefix, checks: ['CLI generated an absent app', 'launcher discovers the generated scaffold', 'inputs and address labels read the mounted seed', 'draft writes actual scratch history', 'fresh numbered tests preserve interactive and sibling values', 'resolver refuses sibling access', 'Back and reload retain values', 'existing Studio archive untouched', 'planned bag output absent', 'receipt names tidy manifest input'] });
    await context.close();
  }
  // Storage now lives in the shell: the kernel's commit throws there and the
  // failure crosses the frame boundary to the Experience's status.
  const denied = await browser.newPage();
  await denied.addInitScript(() => { Storage.prototype.setItem = () => { throw Error('quota exhausted'); }; });
  await denied.goto(origin + '/');
  await denied.locator('[data-tab="exp"]').click();
  await denied.locator('button.card[data-id="build-bag"]').click();
  const deniedFrame = denied.frameLocator('#thing');
  await deniedFrame.locator('#status').filter({ hasText: 'Stopped: quota exhausted' }).waitFor();
  assert.equal(await deniedFrame.locator('#new-test').isDisabled(), true);
  checks.push({ mode: 'storage-failure', checks: ['failed retention is visible and controls stop'] });
  assert.deepEqual(errors, []);
  assert.ok(requests.every(r => r.url.startsWith(origin + '/') && r.method === 'GET'));
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ runId: report.runId, checks, errors, outsideRequests: [], unit: 'node --test local/test/*.test.mjs' }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: checks.reduce((n, row) => n + row.checks.length, 0), errors }));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'browser-failure.json'), JSON.stringify({ checks, errors, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  if (browser) await browser.close();
  if (host) await new Promise(resolve => host.close(resolve));
  fs.rmSync(repo, { recursive: true, force: true });
}
