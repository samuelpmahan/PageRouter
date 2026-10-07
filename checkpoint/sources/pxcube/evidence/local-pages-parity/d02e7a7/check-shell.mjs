import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function checkShell(page, mode, evidence, record) {
  const ids = ['build-bag', 'explore-shelf', 'hello', 'mock-smoke', 'upload-disc-to-shelf'];
  assert.deepEqual(await page.locator('button.card').evaluateAll(nodes => nodes.map(n => n.dataset.id).sort()), ids);
  const state = await page.evaluate(() => JSON.parse(document.getElementById('ntc-state').textContent));
  const visible = {};
  for (const id of ['artifact-id', 'source-id', 'work-summary', 'manifest-summary', 'build-summary']) visible[id] = await page.locator('#' + id).textContent();
  fs.writeFileSync(path.join(evidence, mode + '-shell.json'), JSON.stringify({ stateCounts: { work: state.work.length, types: Object.keys(state.types).length, results: state.results.length }, visible }, null, 2));
  await page.screenshot({ path: path.join(evidence, mode + '-overview.png') });
  await page.locator('#navigation [data-view="builds"]').click();
  await page.screenshot({ path: path.join(evidence, mode + '-builds.png') });
  await page.locator('#navigation [data-view="experiences"]').click();
  record(mode, 'all five cards render; actual NTC counts and build view captured separately from runtime checks');

  await page.locator('button.card[data-id="hello"]').click();
  await page.frameLocator('#thing').getByRole('heading', { name: 'hello from inside the THING' }).waitFor();
  assert.match(await page.frameLocator('#thing').locator('#sandbox').textContent(), /sandboxed: cannot see the shelf/);
  await page.locator('#back').click();
  record(mode, 'Hello loads inside its restricted frame');

  await page.locator('button.card[data-id="mock-smoke"]').click();
  const frame = () => page.frameLocator('#thing');
  await page.waitForFunction(() => !!document.querySelector('#thing')?.contentWindow?.pxCubeMocks);
  await frame().locator('#smoke').click();
  await frame().locator('#status').filter({ hasText: '3 checks passed' }).waitFor();
  assert.deepEqual(await page.locator('#thing').evaluate(f => f.contentWindow.pxCubeSmoke.checks), [true, true, true]);
  await page.locator('#back').click();
  record(mode, 'MockPxC visible isolation check passes all three checks');

  await page.locator('button.card[data-id="build-bag"]').click();
  await frame().locator('#status').filter({ hasText: 'Scaffold ready' }).waitFor();
  const current = () => page.locator('#thing').evaluate(f => f.contentWindow.pxCubeScaffold.current());
  await frame().locator('#draft-name').fill('Parity draft');
  await frame().getByRole('button', { name: 'Save draft', exact: true }).click();
  const saved = await current(); assert.match(JSON.stringify(saved), /Parity draft/);
  await page.locator('#thing').evaluate(f => { f.contentWindow.parityIdentity = f.contentWindow.pxCubeScaffold; });
  await page.locator('#navigation [data-view="work"]').click();
  await page.locator('[data-open="build-bag"]').click();
  assert.equal(await page.locator('#thing').evaluate(f => f.contentWindow.parityIdentity === f.contentWindow.pxCubeScaffold), true);
  assert.deepEqual(await current(), saved);
  await page.locator('#inspect-owner').click();
  assert.deepEqual(JSON.parse(await page.locator('#inspector-value').textContent()), saved);
  await page.keyboard.press('Escape');
  await frame().locator('#new-test').click();
  assert.equal((await current()).name, 'mock.build-bag.1');
  assert.doesNotMatch(JSON.stringify(await current()), /Parity draft/);
  await frame().locator('#interactive').click(); assert.deepEqual(await current(), saved);
  record(mode, 'BuildBag saves scratch state, retains exact owner identity across NTC views, exposes actual values, and isolates its numbered test');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#control-header').isVisible(), true);
  await page.screenshot({ path: path.join(evidence, mode + '-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#back').click();
  record(mode, 'control shell has no horizontal overflow at 390px');
}
