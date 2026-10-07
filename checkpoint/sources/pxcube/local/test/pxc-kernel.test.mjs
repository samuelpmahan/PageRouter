import test from 'node:test';
import assert from 'node:assert/strict';
import { createPxcKernel } from '../pxc-kernel.mjs';
import * as pxc from '../../vendor/neat/dist/pxc.js';
import { worlds, NAMESPACES } from '../../mock-pxc/mock-pxc.mjs';

const memory = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};
const kernel = (storage = memory(), key = 'pxcube.test.v1:kernel') =>
  createPxcKernel({ storage, key, seedIdentity: 'test-seed', seeds: { worlds, namespaces: NAMESPACES }, pxc });

test('iteration allocation, guarded resolution and seed isolation', () => {
  const host = kernel();
  const a = host.createTestRun('shelf');
  const b = host.createTestRun('shelf');
  assert.equal(a.name, 'mock.shelf.1');
  assert.equal(b.name, 'mock.shelf.2');
  a.writeScratch('sc.draft', { name: 'Practice bag', slots: [] });
  assert.equal(a.resolve(`${a.name}.sc.draft.name`), 'Practice bag');
  assert.equal(b.resolve(`${b.name}.sc.draft.name`), 'Untitled bag');
  assert.equal(worlds.shelf.sc.draft.name, 'Untitled bag');
  const leaked = a.resolve(`${a.name}.px.discs`);
  leaked[0].mold = 'changed';
  assert.equal((a.resolve(`${a.name}.px.discs`))[0].mold, 'Buzzz');
  assert.throws(() => a.resolve(`${b.name}.sc.draft.name`), /outside/)
  assert.throws(() => a.writeScratch(`${a.name}.sc.draft`, {}), /without a mount/)
  assert.equal((a.inspect()).changes[0].address, 'sc.draft');
});

test('reads go through PxC: dotted fixtures, telemetry, MissingPartError', () => {
  const host = kernel();
  const a = host.createTestRun('shelf');
  assert.deepEqual(a.resolve(`${a.name}.px.discs.buzzz`), { mold: 'Buzzz', maker: 'Discraft', speed: 5, glide: 4, turn: -1, fade: 1 });
  assert.equal(a.resolve(`${a.name}.fn.flight.average`), 9.5);
  assert.equal(a.resolve(`${a.name}.px.discs.0.mold`), 'Buzzz');
  const read = a.read(`${a.name}.px.discs.buzzz`);
  assert.deepEqual(read.value, { mold: 'Buzzz', maker: 'Discraft', speed: 5, glide: 4, turn: -1, fade: 1 });
  assert.equal(read.receipt.address, 'px.discs.buzzz');
  assert.ok((a.addresses()).includes('px.discs.buzzz'));
  assert.throws(() => a.resolve(`${a.name}.px.nope`), pxc.MissingPartError)
  assert.throws(() => a.resolve(`${a.name}.sc.draft.name.first`), pxc.MissingPartError)
});

test('peek reads a board value without recording telemetry', () => {
  const host = kernel();
  const a = host.createTestRun('shelf');
  const first = a.read(`${a.name}.px.discs.buzzz`);
  assert.deepEqual(a.peek(`${a.name}.px.discs.buzzz`), { mold: 'Buzzz', maker: 'Discraft', speed: 5, glide: 4, turn: -1, fade: 1 });
  const second = a.read(`${a.name}.px.discs.buzzz`);
  assert.equal(second.receipt.sequence, first.receipt.sequence + 1);
});

test('writeScratch replaces the whole sc value on the board', () => {
  const host = kernel();
  const a = host.createTestRun('shelf');
  a.writeScratch('sc.draft', { name: 'Slim', slots: ['Buzzz'] });
  assert.equal(a.resolve(`${a.name}.sc.draft.name`), 'Slim');
  assert.deepEqual(a.resolve(`${a.name}.sc.draft.slots`), ['Buzzz']);
  a.writeScratch('sc.draft', { name: 'Slimmer' });
  assert.equal(a.resolve(`${a.name}.sc.draft.name`), 'Slimmer');
  assert.throws(() => a.resolve(`${a.name}.sc.draft.slots`), pxc.MissingPartError)
  const changes = (a.inspect()).changes;
  assert.equal(changes.length, 2);
  assert.equal(changes[1].before.name, 'Slim');
  assert.throws(() => a.writeScratch('sc.draft', undefined), /must be JSON/)
});

test('interactive identity resumes without reseeding; revision and reload retention', () => {
  const storage = memory();
  const host = kernel(storage);
  const interactive = host.openInteractive('shelf');
  assert.equal(interactive.name, 'mock.shelf');
  interactive.writeScratch('sc.draft', { name: 'My working bag', slots: ['Buzzz'] });
  const before = host.inspect();
  assert.deepEqual((host.openInteractive('shelf')).inspect(), interactive.inspect());
  assert.deepEqual(host.inspect(), before);
  const resumed = kernel(storage, 'pxcube.test.v1:kernel');
  assert.deepEqual(resumed.inspect(), before);
  assert.equal((resumed.openInteractive('shelf')).resolve('mock.shelf.sc.draft.name'), 'My working bag');
  assert.equal((resumed.createTestRun('shelf')).name, 'mock.shelf.1');
  const unchanged = resumed.inspect();
  assert.throws(() => resumed.openInteractive('shelf', 'studio'), /different kind or world/)
  assert.deepEqual(resumed.inspect(), unchanged);
});

test('competing kernel instance cannot silently discard; quota failure is loud', () => {
  const storage = memory();
  const a = kernel(storage), stale = kernel(storage);
  a.createTestRun('test');
  assert.throws(() => stale.createTestRun('other'), /Another owner/)
  const before = a.inspect();
  storage.setItem = () => { throw Error('quota exhausted'); };
  assert.throws(() => a.createTestRun('test'), /quota/)
  assert.deepEqual(a.inspect(), before);
});

test('kernel reads state written by the old mock shape (retained browser data loads)', () => {
  const storage = memory();
  const legacy = {
    schemaVersion: 1, revision: 4,
    runs: {
      'mock.shelf': {
        name: 'mock.shelf', id: 'shelf', kind: 'interactive', world: 'shelf',
        seedIdentity: 'legacy', seed: structuredClone(worlds.shelf),
        value: { ...structuredClone(worlds.shelf), sc: { draft: { name: 'Legacy bag', slots: [] } } },
        changes: [{ step: 1, address: 'sc.draft', before: { name: 'Untitled bag', slots: [] }, after: { name: 'Legacy bag', slots: [] } }],
      },
    },
    results: [],
  };
  storage.setItem('pxcube.test.v1:kernel', JSON.stringify(legacy));
  const host = kernel(storage);
  const handle = host.handle('mock.shelf');
  assert.equal(handle.resolve('mock.shelf.sc.draft.name'), 'Legacy bag');
  assert.equal((handle.inspect()).changes.length, 1);
  handle.writeScratch('sc.draft', { name: 'Migrated bag', slots: [] });
  assert.equal(handle.resolve('mock.shelf.sc.draft.name'), 'Migrated bag');
  const persisted = JSON.parse(storage.getItem('pxcube.test.v1:kernel'));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.runs['mock.shelf'].value.sc.draft.name, 'Migrated bag');
});

test('recordResult and list keep the audit shape', () => {
  const host = kernel();
  host.createTestRun('shelf');
  host.recordResult({ testFile: 'a.mjs', testName: 'writes', ok: true });
  const inspected = host.inspect();
  assert.equal(inspected.results.length, 1);
  assert.equal(inspected.results[0].testName, 'writes');
  const listed = host.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'mock.shelf.1');
  assert.throws(() => host.handle('mock.nope'), /Unknown mount/);
});
