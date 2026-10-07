// E2E: mock-smoke experience, driven in Node through the DOM shim.
// The app boots against the shell's kernel API directly, the same
// window.parent.pxc the launcher exposes. This test plays the shell.
// The shim only stands in for rendering. Flows mirror the browser checks:
// open the interactive world, create isolated test runs, save in one world,
// and prove the others keep their seed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomShim } from './dom-shim.mjs';
import { siteFile, sitePath } from './e2e-site.mjs';
import { createPxcHost } from '../../pxc-kernel.mjs';
import * as pxc from '../../../vendor/neat/dist/pxc.js';
import { worlds, NAMESPACES } from '../../../mock-pxc/mock-pxc.mjs';

const { document, localStorage } = installDomShim({ baseDir: sitePath('experiences', 'mock-smoke') });
// The test is the shell: it exposes the same window.pxc.ownerFor the
// launcher gives frames, backed by a real kernel host.
const host = createPxcHost({ storage: localStorage, seeds: { worlds, namespaces: NAMESPACES }, pxc });
globalThis.parent = {
  pxc: Object.freeze({
    ownerFor(key, experienceId, seedIdentity) {
      if (experienceId) host.experienceForKey.set(key, experienceId);
      return host.kernelFor(key, seedIdentity);
    },
  }),
};
await import(siteFile('experiences', 'mock-smoke', 'app.mjs'));

const owner = globalThis.window.pxCubeMocks;
assert.ok(owner, 'app exposes its PxC owner on window.pxCubeMocks');
assert.equal(document.getElementById('status').textContent.includes('Stopped'), false);

const interactive = (await owner.list()).find(run => run.kind === 'interactive');
assert.ok(interactive, 'the app opens an interactive world on boot');

test('interactive world opens on the seeded shelf', async () => {
  const handle = owner.handle(interactive.name);
  const discs = await handle.resolve(`${handle.name}.px.discs`);
  assert.ok(Array.isArray(discs) && discs.length > 0, 'seed shelf has discs');
  assert.equal(await handle.resolve(`${handle.name}.sc.draft.name`), 'Untitled bag');
});

test('test runs isolate: save in one world, the other keeps its seed', async () => {
  const before = await owner.inspect();
  // Drive the app's own "new run" control twice, like a user would.
  document.getElementById('run-id').value = 'shelf';
  await document.getElementById('new-run').click();
  await document.getElementById('new-run').click();
  const runs = (await owner.list()).filter(run => run.kind === 'test').slice(-2);
  const [a, b] = runs.map(run => owner.handle(run.name));
  assert.notEqual(a.name, b.name);

  // Drive the app's own save control for the first world, like the UI does.
  const panel = document.querySelectorAll('article').find(row => row.dataset.mount === a.name);
  assert.ok(panel, 'app rendered a panel for the new test run');
  panel.querySelector('input').value = 'Fieldwork';
  await panel.querySelector('button').click();

  assert.equal(await a.resolve(`${a.name}.sc.draft.name`), 'Fieldwork');
  assert.equal(await b.resolve(`${b.name}.sc.draft.name`), 'Untitled bag');
  assert.match(document.getElementById('status').textContent, /Saved in /);

  // Every world that existed before still inspects exactly as it did.
  for (const [name, value] of Object.entries(before.runs)) {
    assert.deepEqual(await owner.handle(name).inspect(), value, `earlier world ${name} survived`);
  }
});

test('a fresh interactive open retains the saved worlds', async () => {
  const again = await owner.openInteractive('shelf');
  assert.equal(again.name, interactive.name);
  assert.ok((await owner.list()).some(run => run.kind === 'test'), 'test runs retained');
});
