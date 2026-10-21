import test from 'node:test';
import assert from 'node:assert/strict';
import { openLockedArchive } from './locked-storage.mjs';

const key = 'thro.v1:workspace:archive';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function memory(initial = 'original') {
  const values = new Map(initial === null ? [] : [[key, initial]]), writes = [];
  return { values, writes, getItem: name => values.get(name) ?? null,
    setItem(name, value) { writes.push({ name, value }); values.set(name, value); } };
}
// Independent adapters share this asynchronous exclusive scheduler, as tabs
// share an origin's LockManager. No storage operation implements a fake CAS.
function exclusiveLocks() {
  const tails = new Map(), calls = [], observers = [];
  let gate = null;
  return {
    calls,
    hold() { gate = deferred(); return () => { gate.resolve(); gate = null; }; },
    requested(count = 1) {
      if (calls.length >= count) return Promise.resolve();
      const signal = deferred(); observers.push({ count, signal }); return signal.promise;
    },
    async request(name, options, action) {
      assert.equal(options.mode, 'exclusive');
      const previous = tails.get(name) ?? Promise.resolve(), ticket = deferred(), pause = gate?.promise;
      tails.set(name, ticket.promise); calls.push(name);
      for (const observer of observers) if (calls.length >= observer.count) observer.signal.resolve();
      try { await previous; if (pause) await pause; return await action({ name, mode: 'exclusive' }); }
      finally { ticket.resolve(); }
    },
  };
}
const hasCode = code => error => error instanceof Error && error.code === code;

test('opens and commits raw archive bytes through an exclusive lock', async () => {
  const storage = memory(), locks = exclusiveLocks(), archive = await openLockedArchive(storage, key, { locks });
  assert.equal(archive.getItem('ignored'), 'original');
  assert.equal(archive.committedRaw, 'original');
  archive.setItem('', 'next');
  assert.equal(archive.pendingRaw, 'next');
  assert.equal(storage.getItem(key), 'original');
  await archive.flush();
  assert.equal(storage.getItem(key), 'next');
  assert.equal(archive.committedRaw, 'next');
  assert.equal(archive.pendingRaw, 'next');
  assert.equal(locks.calls.length, 1);
});

test('compares held packed bytes while exposing unpacked raw data', async () => {
  const storage = memory('packed:original'), locks = exclusiveLocks();
  const archive = await openLockedArchive(storage, key, { locks,
    pack: async raw => `packed:${raw}`, unpack: async packed => packed.slice(7) });
  assert.equal(archive.getItem(''), 'original');
  archive.setItem('', 'next'); await archive.flush();
  assert.equal(storage.getItem(key), 'packed:next');
  assert.equal(archive.committedRaw, 'next');
});

test('sequential stale writer preserves newer bytes and its pending raw draft', async () => {
  const storage = memory(), locks = exclusiveLocks();
  const a = await openLockedArchive(storage, key, { locks }), stale = await openLockedArchive(storage, key, { locks });
  a.setItem('', 'four discs'); await a.flush();
  stale.setItem('', 'three discs with recrop');
  await assert.rejects(stale.flush(), hasCode('THRO_STORAGE_CONFLICT'));
  assert.equal(storage.getItem(key), 'four discs'); assert.equal(storage.writes.length, 1);
  assert.equal(stale.committedRaw, 'original'); assert.equal(stale.pendingRaw, 'three discs with recrop');
});

test('simultaneous independent writers publish one winner and reject one stale draft', async () => {
  const storage = memory(), locks = exclusiveLocks(), release = locks.hold();
  const a = await openLockedArchive(storage, key, { locks }), b = await openLockedArchive(storage, key, { locks });
  a.setItem('', 'A'); b.setItem('', 'B');
  const attempts = Promise.allSettled([a.flush(), b.flush()]);
  await locks.requested(2);
  assert.equal(locks.calls[0], locks.calls[1], 'independent adapters must share the same key-specific lock');
  release();
  const results = await attempts;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const loser = results.find(r => r.status === 'rejected');
  assert.equal(loser.reason.code, 'THRO_STORAGE_CONFLICT');
  assert.equal(storage.writes.length, 1);
  const winner = results[0].status === 'fulfilled' ? a : b, rejected = winner === a ? b : a;
  assert.equal(storage.getItem(key), winner.pendingRaw);
  assert.equal(rejected.committedRaw, 'original');
  assert.notEqual(rejected.pendingRaw, winner.pendingRaw);
});

test('changed candidate during compression cannot commit obsolete bytes', async () => {
  const storage = memory(), locks = exclusiveLocks(), entered = deferred(), release = deferred();
  const archive = await openLockedArchive(storage, key, { locks, pack: async raw => {
    entered.resolve(); await release.promise; return raw;
  } });
  archive.setItem('', 'obsolete'); const attempt = archive.flush(); await entered.promise;
  archive.setItem('', 'new draft'); release.resolve();
  await assert.rejects(attempt, hasCode('THRO_STORAGE_CHANGED'));
  assert.equal(storage.writes.length, 0); assert.equal(archive.committedRaw, 'original');
  assert.equal(archive.pendingRaw, 'new draft');
});

test('changed candidate while waiting for lock cannot commit obsolete bytes', async () => {
  const storage = memory(), locks = exclusiveLocks(), release = locks.hold();
  const archive = await openLockedArchive(storage, key, { locks });
  archive.setItem('', 'obsolete'); const attempt = archive.flush(); await locks.requested();
  archive.setItem('', 'new draft'); release();
  await assert.rejects(attempt, hasCode('THRO_STORAGE_CHANGED'));
  assert.equal(storage.writes.length, 0); assert.equal(archive.pendingRaw, 'new draft');
});

test('confirmed failed write preserves prior bytes and permits an explicit retry', async () => {
  const storage = memory(), locks = exclusiveLocks(), write = storage.setItem;
  storage.setItem = () => { throw Error('quota'); };
  const archive = await openLockedArchive(storage, key, { locks });
  archive.setItem('', 'retryable');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem(key), 'original'); assert.equal(archive.committedRaw, 'original');
  assert.equal(archive.pendingRaw, 'retryable');
  storage.setItem = write; await archive.flush();
  assert.equal(archive.committedRaw, 'retryable'); assert.equal(storage.getItem(key), 'retryable');
});

test('missing lock support allows reads and staging but fails closed on flush', async () => {
  const storage = memory(), archive = await openLockedArchive(storage, key, { locks: null });
  assert.equal(archive.getItem(''), 'original'); archive.setItem('', 'unsaved');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNAVAILABLE'));
  assert.equal(storage.writes.length, 0); assert.equal(archive.pendingRaw, 'unsaved');
});

test('namespace isolation refuses legacy keys before reading and preserves other archives', async () => {
  const storage = memory(), locks = exclusiveLocks();
  storage.values.set('pxcube.demo.v1:archive', 'demo');
  storage.values.set('discstudio.pxc.shelf.v1', 'pinned');
  storage.values.set('thro.v1:other:archive', 'other player');
  let reads = 0;
  await assert.rejects(openLockedArchive({ getItem() { reads++; }, setItem() {} }, 'discstudio.pxc.shelf.v1', { locks }), hasCode('THRO_STORAGE_UNAVAILABLE'));
  assert.equal(reads, 0);
  const archive = await openLockedArchive(storage, key, { locks }); archive.setItem('', 'next'); await archive.flush();
  assert.equal(storage.getItem('pxcube.demo.v1:archive'), 'demo');
  assert.equal(storage.getItem('discstudio.pxc.shelf.v1'), 'pinned');
  assert.equal(storage.getItem('thro.v1:other:archive'), 'other player');
});

test('write-then-throw is uncertain and latched without rolling back stored bytes', async () => {
  const storage = memory(), locks = exclusiveLocks(); let writes = 0;
  storage.setItem = (name, value) => { writes++; storage.values.set(name, value); throw Error('write outcome error'); };
  const archive = await openLockedArchive(storage, key, { locks }); archive.setItem('', 'possibly saved');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNCERTAIN'));
  assert.equal(storage.getItem(key), 'possibly saved'); assert.equal(archive.committedRaw, 'original');
  archive.setItem('', 'retained subsequent draft');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNCERTAIN'));
  assert.equal(writes, 1); assert.equal(archive.pendingRaw, 'retained subsequent draft');
});

test('readback mismatch preserves intervening bytes and latches uncertain outcome', async () => {
  const storage = memory(), locks = exclusiveLocks(); let writes = 0;
  storage.setItem = name => { writes++; storage.values.set(name, 'intervening writer'); };
  const archive = await openLockedArchive(storage, key, { locks }); archive.setItem('', 'candidate');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNCERTAIN'));
  assert.equal(storage.getItem(key), 'intervening writer'); assert.equal(archive.pendingRaw, 'candidate');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNCERTAIN')); assert.equal(writes, 1);
});

test('failed readback after write cannot become a false committed success', async () => {
  const storage = memory(), locks = exclusiveLocks(); let wrote = false;
  const archive = await openLockedArchive({
    getItem(name) { if (wrote) throw Error('read unavailable'); return storage.getItem(name); },
    setItem(name, value) { storage.setItem(name, value); wrote = true; },
  }, key, { locks });
  archive.setItem('', 'candidate');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNCERTAIN'));
  assert.equal(storage.getItem(key), 'candidate'); assert.equal(archive.committedRaw, 'original');
  assert.equal(archive.pendingRaw, 'candidate');
});

test('lock request failure never writes and retains the candidate', async () => {
  const storage = memory(), archive = await openLockedArchive(storage, key, {
    locks: { async request() { throw Error('lock service unavailable'); } },
  });
  archive.setItem('', 'candidate');
  await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNAVAILABLE'));
  assert.equal(storage.writes.length, 0); assert.equal(archive.pendingRaw, 'candidate');
});

test('concurrent duplicate flushes of one adapter produce one write', async () => {
  const storage = memory(), locks = exclusiveLocks(), archive = await openLockedArchive(storage, key, { locks });
  archive.setItem('', 'candidate'); await Promise.all([archive.flush(), archive.flush()]);
  assert.equal(storage.writes.length, 1); assert.equal(archive.committedRaw, 'candidate');
});

test('fresh empty archive is readable and compression errors preserve staged bytes', async () => {
  const storage = memory(null), locks = exclusiveLocks();
  const archive = await openLockedArchive(storage, key, { locks, pack: async () => { throw Error('encoding failed'); } });
  assert.equal(archive.committedRaw, null); assert.equal(archive.getItem(''), null);
  archive.setItem('', 'candidate'); await assert.rejects(archive.flush(), hasCode('THRO_STORAGE_UNAVAILABLE'));
  assert.equal(storage.writes.length, 0); assert.equal(archive.pendingRaw, 'candidate');
});
