import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationIndex } from './core.mjs';

const input = (patch = {}) => ({
  runtime: 'fixture', action: 'execute', source: { commit: 'abc123', revision: 7 },
  startedAt: 'producer-clock:10', finishedAt: 'producer-clock:12', status: 'succeeded',
  operations: [{ id: 'local-1', value: 2 }], edges: [], evidence: { receipt: { ok: true } }, ...patch,
});

test('record assigns unique occurrence IDs and local sequence while preserving producer clocks and source', () => {
  let observedAt = 100;
  const index = createOperationIndex({ now: () => observedAt++, idFactory: () => 'same-id', maxRuns: 4 });
  const first = index.record(input());
  const second = index.record(input({ source: { commit: 'def456', revision: 8 } }));
  assert.equal(first.id, 'same-id');
  assert.equal(second.id, 'same-id~2');
  assert.deepEqual([first.sequence, second.sequence], [1, 2]);
  assert.deepEqual([first.observedAt, second.observedAt], [100, 101]);
  assert.equal(first.startedAt, 'producer-clock:10');
  assert.deepEqual(first.source, { commit: 'abc123', revision: 7 });
  assert.equal(index.snapshot().formatVersion, 1);
  assert.deepEqual(JSON.parse(index.exportJSON()).runs.map((run) => run.id), ['same-id', 'same-id~2']);
});

test('record, list, snapshots and subscribers are isolated clones; observer failures are isolated', () => {
  let nextId = 0;
  const index = createOperationIndex({ idFactory: () => `run-${++nextId}` });
  let received;
  index.subscribe((snapshot) => { snapshot.runs[0].evidence.receipt.ok = false; throw new Error('observer failed'); });
  index.subscribe((snapshot) => { received = snapshot; });
  const row = index.record(input());
  row.evidence.receipt.ok = false;
  received.runs[0].operations[0].value = 99;
  const returned = index.list();
  returned[0].operations[0].value = 0;
  assert.equal(index.snapshot().runs[0].evidence.receipt.ok, true);
  assert.equal(index.list()[0].operations[0].value, 2);
});

test('retention and storage failures remain visible; clear is observable and does not rewind sequence', () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  let n = 0;
  const index = createOperationIndex({ storage, storageKey: 'test', maxRuns: 2, idFactory: () => `r${++n}` });
  index.record(input()); index.record(input()); index.record(input());
  assert.equal(index.list().length, 2);
  assert.equal(index.snapshot().droppedCount, 1);
  assert.equal(index.snapshot().limits.maxRuns, 2);
  const reloaded = createOperationIndex({ storage, storageKey: 'test', maxRuns: 2, idFactory: () => 'after' });
  assert.deepEqual(reloaded.list().map((run) => run.sequence), [2, 3]);
  reloaded.clear();
  assert.equal(reloaded.snapshot().droppedCount, 3);
  assert.equal(reloaded.record(input()).sequence, 4);

  const broken = createOperationIndex({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } }, idFactory: () => 'x' });
  broken.record(input());
  assert.match(broken.snapshot().storage.error, /quota/);
});

test('rejects non-JSON and malformed input instead of recording partial data', () => {
  const index = createOperationIndex({ idFactory: () => 'x' });
  assert.throws(() => index.record(input({ evidence: { bad: Infinity } })), /finite numbers/);
  assert.throws(() => index.record({ runtime: 'x' }), /missing action/);
  assert.equal(index.list().length, 0);
});

test('preserves a JSON own property named __proto__ without changing the snapshot prototype', () => {
  const evidence = JSON.parse('{"__proto__":{"safe":true},"receipt":{}}');
  const index = createOperationIndex({ idFactory: () => 'proto' });
  index.record(input({ evidence }));
  const copy = index.snapshot().runs[0].evidence;
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal(Object.hasOwn(copy, '__proto__'), true);
  assert.deepEqual(copy.__proto__, { safe: true });
});
