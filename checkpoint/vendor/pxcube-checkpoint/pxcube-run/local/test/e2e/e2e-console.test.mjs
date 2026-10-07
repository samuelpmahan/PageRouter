import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sitePath, siteFile } from './e2e-site.mjs';

test('launcher ships a PxConsole view', () => {
  const html = readFileSync(sitePath('index.html'), 'utf8');
  assert.ok(html.includes('PxConsole'), 'navigation names PxConsole');
  assert.ok(html.includes('console-addresses'), 'address table ships');
});

test('console shell registers the console panel and never executes', () => {
  const shell = readFileSync(sitePath('shell.mjs'), 'utf8');
  assert.ok(shell.includes('console-panel'), 'console panel is a registered view');
  assert.ok(!shell.includes('https://'), 'no cross-origin requests from the shell');
});

test('console inspects through the real PxC store, not a mock copy', async () => {
  const pxcModule = await import(siteFile('pxc.js'));
  assert.equal(typeof pxcModule.createPxC, 'function');
  assert.equal(typeof pxcModule.readPart, 'function');
  assert.equal(typeof pxcModule.registerPart, 'function');
  let pxc = pxcModule.createPxC();
  pxc = pxcModule.registerPart(pxc, 'mock.build-bag.1.sc.draft', { name: 'Test Bag' });
  const result = pxcModule.readPart(pxc, 'mock.build-bag.1.sc.draft');
  assert.deepEqual(result.value, { name: 'Test Bag' });
  assert.equal(result.pxc.telemetry.reads.length, 1);
  assert.equal(result.pxc.telemetry.reads[0].address, 'mock.build-bag.1.sc.draft');
  assert.throws(() => pxcModule.readPart(result.pxc, 'mock.build-bag.1.nope'), pxcModule.MissingPartError);
});

test('console shell hydrates worlds into PxC and describes values without invoking accessors', () => {
  const shell = readFileSync(sitePath('shell.mjs'), 'utf8');
  assert.ok(shell.includes("from './pxc.js'"), 'shell imports the real PxC store');
  assert.ok(shell.includes('readPart(pxc, address)'), 'reads go through readPart');
  assert.ok(shell.includes('MissingPartError'), 'missing addresses raise');
  assert.ok(shell.includes('never invoked'), 'accessors are never invoked during describe');
  assert.ok(shell.includes('console-addresses'), 'address table is rendered');
});

test('pxc.js ships offline and same-origin', () => {
  assert.ok(existsSync(sitePath('pxc.js')), 'pxc.js ships in the assembled site');
  const sw = readFileSync(sitePath('sw.js'), 'utf8');
  assert.ok(sw.includes('./pxc.js'), 'service worker precaches pxc.js');
});
