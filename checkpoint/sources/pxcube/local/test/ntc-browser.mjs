import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, build, serve } from '../run.mjs';
import { workspace, cli } from './scaffold-helpers.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const evidence = path.join(root, process.env.PXCUBE_EVIDENCE_DIR ?? 'evidence/ntc-console'); fs.mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const errors = [], checks = [];
let fixtureRepo, fixtureServer;
const pass = text => { checks.push(text); console.log('PASS', text); };
try {
  let baseUrl = process.env.PXCUBE_BASE_URL ?? 'http://127.0.0.1:4321/';
  if (process.env.NTC_FIXTURE === '1') {
    fixtureRepo = workspace();
    const generated = cli(fixtureRepo, 'scaffold', '--from-tidy', 'pxcube-build-bag');
    assert.equal(generated.status, 0, generated.stderr);
    const built = await build(fixtureRepo); assert.ok(built.report.results.every(result => result.ok));
    fixtureServer = serve(fixtureRepo, { port: 0 });
    await new Promise((resolve, reject) => { fixtureServer.once('listening', resolve); fixtureServer.once('error', reject); });
    baseUrl = `http://127.0.0.1:${fixtureServer.address().port}/`;
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.locator('#build-summary').filter({ hasText: 'packaged' }).waitFor();
  const artifact = await page.evaluate(() => JSON.parse(document.getElementById('ntc-state').textContent));
  assert.ok(artifact.work.some(item => item.id === 'PXCUBE-build-bag'));
  assert.ok(artifact.results.every(result => result.ok));
  assert.equal(artifact.results.length, artifact.packagedIds.length);
  assert.ok(Object.keys(artifact.types).length > 0);
  const board = await page.request.get(new URL('neat.html', baseUrl).href);
  assert.equal(board.status(), 200); assert.match(await board.text(), /PXCUBE-build-bag/);
  const report = await page.request.get(new URL('pxcube-run.json', baseUrl).href);
  assert.equal(report.status(), 200); assert.equal((await report.json()).runId, artifact.runId);
  for (const result of artifact.results) {
    assert.equal(result.receipt, `experiences/${result.id}/receipt.json`);
    const receipt = await page.request.get(new URL(result.receipt, baseUrl).href);
    assert.equal(receipt.status(), 200);
    assert.equal((await receipt.json()).build.exitCode, 0);
  }
  assert.equal(await page.locator('details.manifest h4').filter({ hasText: 'wiring manifest, crisp receipt' }).count(), artifact.packagedIds.length);
  pass('the assembled artifact supplies its work board, run record, tidy types, and every receipt link');
  assert.equal(await page.locator('#mount-count').textContent(), '0');
  assert.deepEqual(await page.evaluate(() => window.pxCubeControl.inspect().frames), []);
  await page.screenshot({ path: path.join(evidence, 'overview.png') });
  pass('packaged resources and unopened runtime contexts are distinct');
  await page.locator('button.card[data-id="build-bag"]').click();
  const frame = page.frameLocator('#thing');
  await frame.locator('#status').filter({ hasText: /Scaffold ready|Ready ·/ }).waitFor();
  const demo = await page.locator('#thing').evaluate(el => Boolean(el.contentWindow.pxCubeDemo));
  const settle = async () => { if (demo) await page.locator('#thing').evaluate(el => el.contentWindow.pxCubeDemo.settled()); };
  assert.equal(await page.evaluate(() => window.pxCubeControl.inspect().controlsCollapsed), true);
  assert.equal(await page.locator('#navigation').isVisible(), false);
  assert.equal(await page.locator('#ntc-strip').isVisible(), false);
  assert.deepEqual(await page.locator('#thing').evaluate(el => {
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }), { x: 0, y: 0, width: 1440, height: 1000 });
  const drawerToggle = page.locator('#control-drawer-toggle');
  assert.equal(await drawerToggle.getAttribute('aria-expanded'), 'false');
  await drawerToggle.click();
  const header = await page.locator('#control-header').boundingBox(), strip = await page.locator('#ntc-strip').boundingBox(), viewer = await page.locator('#viewer').boundingBox();
  assert.ok(header.y >= 0 && strip.y >= header.y + header.height && viewer.y >= strip.y + strip.height);
  assert.equal(await page.locator('#navigation').isVisible(), true);
  await page.locator('#thing').evaluate(el => { el.contentWindow.identityWitness = el.contentWindow.pxCubeExperience ?? el.contentWindow.pxCubeScaffold; });
  await frame.locator('#draft-name').fill('NTC retained draft'); await frame.getByRole('button', { name: 'Save draft' }).click(); await settle();
  await frame.locator('#status').filter({ hasText: 'Draft saved' }).waitFor();
  const owning = () => page.locator('#thing').evaluate(el => el.contentWindow.pxCubeExperience ? el.contentWindow.pxCubeExperience.inspect() : el.contentWindow.pxCubeScaffold.current());
  const saved = await owning();
  pass('the NTC controls collapse into a discoverable drawer and restore without replacing the active Experience');
  await page.locator('#navigation [data-view="work"]').click();
  const work = page.locator('[data-work="PXCUBE-build-bag"]');
  await work.getByRole('button', { name: 'Work item', exact: true }).click();
  assert.deepEqual(JSON.parse(await page.locator('#inspector-value').textContent()), artifact.work.find(item => item.id === 'PXCUBE-build-bag'));
  await page.keyboard.press('Escape');
  await work.getByRole('button', { name: 'Manifest', exact: true }).click();
  assert.equal(JSON.parse(await page.locator('#inspector-value').textContent()).manifest.manifestSource.type, 'pxcube-build-bag');
  await page.locator('#close-inspector').click();
  pass('neat work links to its actual retained item and tidy manifest');
  await page.locator('#navigation [data-view="manifests"]').click();
  assert.equal(await page.locator('#tab-manifests').isVisible(), true);
  assert.equal(await page.locator('#tab-manifests details.manifest').count(), artifact.manifests.length);
  await page.locator('#navigation [data-view="builds"]').click();
  await page.locator('[data-build="build-bag"]').getByRole('button', { name: 'Build', exact: true }).click();
  const result = JSON.parse(await page.locator('#inspector-value').textContent());
  assert.deepEqual(result, artifact.results.find(result => result.id === 'build-bag'));
  assert.equal(result.build.command, 'node build.mjs');
  await page.keyboard.press('Escape');
  pass('tidy and crisp views inspect the manifest and measured package outcome');
  await page.locator('#navigation [data-view="mounts"]').click();
  await page.locator('#mount-rows').filter({ hasText: 'mock.build-bag' }).waitFor();
  assert.equal(await page.locator('#mount-count').textContent(), '1');
  await page.locator('#mount-rows').getByRole('button', { name: 'Owner', exact: true }).click();
  assert.deepEqual(JSON.parse(await page.locator('#inspector-value').textContent()), saved);
  await page.keyboard.press('Escape');
  await page.locator('[data-open="build-bag"]').click();
  assert.equal(await page.locator('#thing').evaluate(el => el.contentWindow.identityWitness === (el.contentWindow.pxCubeExperience ?? el.contentWindow.pxCubeScaffold)), true);
  assert.deepEqual(await owning(), saved);
  assert.match(await page.locator('[data-open="build-bag"] small').textContent(), /in view/);
  await frame.locator('#new-test').click(); await settle();
  if (await page.locator('#control-drawer-toggle').getAttribute('aria-expanded') === 'false') {
    await page.locator('#control-drawer-toggle').click();
  }
  await page.locator('#navigation [data-view="mounts"]').click();
  await page.locator('#mount-count').filter({ hasText: '2' }).waitFor();
  assert.equal(await page.locator('#mount-rows tr').count(), 2);
  await page.locator('#mount-rows').filter({ hasText: 'mock.build-bag.1' }).waitFor();
  pass('mounts come from the live owner; switching control views preserves exact frame identity and drafts');
  await page.screenshot({ path: path.join(evidence, 'mounts.png') });
  await page.locator('[data-open="build-bag"]').click();
  if (demo) { await frame.locator('#session').selectOption('mock.build-bag'); await settle(); }
  else await frame.locator('#interactive').click();
  await page.screenshot({ path: path.join(evidence, 'experience.png') });
  if (await page.locator('#control-drawer-toggle').getAttribute('aria-expanded') === 'false') {
    await page.locator('#control-drawer-toggle').click();
  }
  await page.locator('#inspect-owner').click();
  const ownerState = JSON.parse(await page.locator('#inspector-value').textContent());
  assert.deepEqual(ownerState.runs['mock.build-bag'], saved);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#control-header').isVisible(), true);
  assert.equal(await page.locator('#ntc-strip').isVisible(), true);
  await page.screenshot({ path: path.join(evidence, 'mobile.png') });
  pass('the control shell and owner inspector remain usable on a narrow viewport');
  await page.setViewportSize({ width: 1102, height: 1068 });
  if(await page.locator('#control-drawer-toggle').getAttribute('aria-expanded')==='false')await page.locator('#control-drawer-toggle').click(); await page.locator('#back').click(); await page.screenshot({ path: path.join(evidence, 'reference-width.png') });
  await page.route('**/pxcube-run.json', route => route.fulfill({ json: { runId: 'a-newer-build' } }));
  await page.locator('#refresh-build').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.pxCubeControl.inspect().artifact), artifact.runId);
  await page.locator('[data-open="build-bag"]').click();
  assert.deepEqual(await owning(), saved);
  pass('a newer build is offered without changing the loaded artifact or discarding its owning context');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ runId: artifact.runId, checks, errors }, null, 2) + '\n');
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'browser-failure.json'), JSON.stringify({ checks, errors, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
  if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
  if (fixtureRepo) fs.rmSync(fixtureRepo, { recursive: true, force: true });
}
