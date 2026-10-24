// Timing (seq 63): every call a run makes is timed by the kernel itself, so no Calculation needs hand-written spans. The rules
// come from the ChainSpot PxC expert's answer of 23 Oct 2026 (relay file 02) and Sam's "PxC is designed to auto instrument every
// Calculation":
//   - the clock is injected (createWorld({ clock })), so every timing path is testable and replayable;
//   - time never enters identity: it lives in a side record (run(...).timing, world.timing(runId)), never in the receipt or trace,
//     and nothing the kernel decides (cache, choice, outputs) reads it;
//   - each call records ms and selfMs (its span minus its children), and a ledger whose remainders are signed and named by where
//     they sit, so the books close exactly;
//   - any call whose own, un-itemised time is 5% or more of the run is flagged as opaque;
//   - each implementation's code is hashed once, at registration, never per run;
//   - runAsync / ctx.callAsync for steps that wait, with the parent passed explicitly across the await; run keeps ASYNC_RUN.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';
import { canonical } from '../src/canonical.mjs';

const num = { type: 'number' };
// A clock the test controls: implementations "work" by advancing it, the kernel only reads it.
function manualClock() { const c = { t: 0 }; c.now = () => c.t; return c; }

// outer: 1 of its own, then a (10), then 2 of its own, then b (20), then 3 of its own.
function abWorld(clock, extra = {}) {
  const w = createWorld({ name: 'ab', clock: clock.now, ...extra });
  w.contract({ id: 'a', in: { x: num }, out: { y: num } });
  w.contract({ id: 'b', in: { x: num }, out: { y: num } });
  w.contract({ id: 'outer', in: { x: num }, out: { y: num } });
  w.implement({ id: 'a/js', implements: 'a', run: ({ x }) => { clock.t += 10; return { y: x.value + 1 }; } });
  w.implement({ id: 'b/js', implements: 'b', run: ({ x }) => { clock.t += 20; return { y: x.value * 2 }; } });
  w.implement({ id: 'outer/js', implements: 'outer', uses: ['a', 'b'], run: ({ x }, ctx) => {
    clock.t += 1; const a = ctx.call('a', { x }); clock.t += 2; const b = ctx.call('b', { x: a.y }); clock.t += 3; return { y: b.y };
  } });
  return w;
}
const callOf = (timing, contract) => timing.calls.find((c) => c.contract === contract);
const sumRows = (rows) => rows.reduce((s, r) => s + r.ms, 0);

test('1. every call is timed on the injected clock: ms, selfMs and a ledger that closes exactly', () => {
  const clock = manualClock();
  const w = abWorld(clock);
  const { outputs, timing } = w.run('outer', { x: 3 });
  assert.deepEqual(outputs, { y: 8 });
  assert.equal(timing.ms, 36);
  const outer = callOf(timing, 'outer'), a = callOf(timing, 'a'), b = callOf(timing, 'b');
  assert.deepEqual([outer.ms, outer.selfMs, a.ms, a.selfMs, b.ms, b.selfMs], [36, 6, 10, 10, 20, 20]);
  assert.deepEqual([outer.start, a.start, b.start], [0, 1, 13]);
  assert.deepEqual(outer.rows.map((r) => [r.name, r.ms, Boolean(r.remainder)]), [
    ['from the start of “outer” to “a”', 1, true],
    ['a', 10, false],
    ['between “a” and “b”', 2, true],
    ['b', 20, false],
    ['after “b”, until “outer” returns', 3, true],
  ]);
  assert.deepEqual(a.rows, [{ name: 'inside “a”, not itemised', ms: 10, remainder: true }]);
  for (const c of timing.calls) assert.equal(sumRows(c.rows) - c.overlap, c.ms, `${c.contract} closes`);
  assert.deepEqual(timing.outside, { name: 'around the top call “outer”', ms: 0 });
  assert.equal(timing.closes, true);
  assert.equal(w.timing(timing.runId), timing, 'the side record is kept by run id');
});

test('2. time never enters identity: two clocks, the same receipt, the same trace, the same cache', () => {
  const slow = { t: 0 }; slow.now = () => (slow.t += 1000);
  const fast = { t: 0 }; fast.now = () => (fast.t += 0.001);
  const runs = [slow, fast].map((clock) => {
    const w = abWorld({ get t() { return 0; }, set t(_) {}, now: clock.now });
    const first = w.run('outer', { x: 3 }), second = w.run('outer', { x: 3 });
    return { w, first, second };
  });
  assert.notEqual(runs[0].first.timing.ms, runs[1].first.timing.ms, 'the clocks really differ');
  assert.equal(canonical(runs[0].first.receipt), canonical(runs[1].first.receipt), 'receipts are byte-identical');
  assert.equal(canonical(runs[0].second.receipt), canonical(runs[1].second.receipt), 'cached receipts are byte-identical');
  for (const { w, first, second } of runs) {
    assert.equal('timing' in first.receipt, false, 'no timing inside the receipt');
    assert.equal(JSON.stringify(first.trace).includes('"ms"'), false, 'no timing inside the trace');
    assert.equal(second.trace.cached, true, 'the second run is served from the cache whatever the clock says');
    assert.equal(callOf(second.timing, 'outer').cached, true, 'the side record marks the cache hit');
    assert.equal(w.replay(first.receipt).exact, true);
  }
  assert.deepEqual(runs[0].w.stats(), runs[1].w.stats(), 'the cache did the same work under both clocks');
});

test('3. remainders are signed: a clock that steps back shows a negative remainder, and the books still close', () => {
  const clock = manualClock();
  const w = abWorld(clock);
  w.implement({ id: 'outer/backstep', implements: 'outer', uses: ['a', 'b'], run: ({ x }, ctx) => {
    const a = ctx.call('a', { x }); clock.t -= 4; const b = ctx.call('b', { x: a.y }); return { y: b.y };
  } });
  const { timing } = w.run('outer', { x: 1 }, { fill: { outer: 'outer/backstep' } });
  const outer = callOf(timing, 'outer');
  const between = outer.rows.find((r) => r.name === 'between “a” and “b”');
  assert.equal(between.ms, -4, 'kept signed, not max(0, …)');
  assert.equal(outer.selfMs, -4);
  assert.equal(sumRows(outer.rows), outer.ms);
  assert.equal(timing.closes, true);
});

test('4. a call whose own, un-itemised time is 5% or more of the run is flagged as opaque; 4% is not', () => {
  const clock = manualClock();
  const w = createWorld({ name: 'hot', clock: clock.now });
  w.contract({ id: 'big', in: {}, out: { y: num } });
  w.contract({ id: 'tiny', in: {}, out: { y: num } });
  w.contract({ id: 'top', in: {}, out: { y: num } });
  w.implement({ id: 'big/js', implements: 'big', run: () => { clock.t += 95; return { y: 1 }; } });
  w.implement({ id: 'tiny/js', implements: 'tiny', run: () => { clock.t += 4; return { y: 2 }; } });
  w.implement({ id: 'top/js', implements: 'top', uses: ['big', 'tiny'], run: (_, ctx) => { clock.t += 1; ctx.call('big', {}); ctx.call('tiny', {}); return { y: 3 }; } });
  const { timing } = w.run('top', {});
  assert.equal(timing.ms, 100);
  assert.deepEqual(timing.opaque.map((o) => [o.contract, o.impl, o.selfMs, o.share]), [['big', 'big/js', 95, 0.95]]);
  assert.match(timing.opaque[0].why, /not itemised/);
});

test('5. each implementation is hashed once, at registration: no Function.prototype.toString during a run', () => {
  const clock = manualClock();
  const w = abWorld(clock);
  const [a, b] = ['a/js', 'b/js'].map((id) => w.implementations().find((i) => i.id === id));
  assert.match(a.code, /^[0-9a-f]{16}$/);
  assert.notEqual(a.code, b.code, 'different bodies, different hashes');
  w.implement({ id: 'a/same-body', implements: 'a', run: ({ x }) => { clock.t += 10; return { y: x.value + 1 }; } });
  assert.equal(w.implementations().find((i) => i.id === 'a/same-body').code, a.code, 'the same body, the same hash');
  const original = Function.prototype.toString; let calls = 0;
  Function.prototype.toString = function (...args) { calls += 1; return original.apply(this, args); };
  try { w.run('outer', { x: 3 }, { fill: { a: 'a/js' } }); w.run('outer', { x: 4 }, { fill: { a: 'a/js' } }); } finally { Function.prototype.toString = original; }
  assert.equal(calls, 0, 'running hashes nothing');
  const composed = w.compose({ id: 'outer/composed', implements: 'outer', steps: [{ name: 'a', call: 'a', bind: { x: '$in.x' } }], returns: { y: 'a.y' } });
  assert.match(composed.code, /^[0-9a-f]{16}$/, 'a composition is hashed by its assembly');
});

test('6. runAsync: ctx.callAsync keeps its parent across the await, and a plain ctx.call after an await still lands under it', async () => {
  const clock = manualClock();
  const w = abWorld(clock);
  w.contract({ id: 'wait', in: { x: num }, out: { y: num } });
  w.implement({ id: 'wait/js', implements: 'wait', pure: true, run: async ({ x }) => { await Promise.resolve(); clock.t += 7; return { y: x.value + 1 }; } });
  w.contract({ id: 'flow', in: { x: num }, out: { y: num } });
  w.implement({ id: 'flow/js', implements: 'flow', uses: ['wait', 'a'], run: async ({ x }, ctx) => {
    const first = await ctx.callAsync('wait', { x });
    const second = await ctx.callAsync('wait', { x: first.y });
    const third = ctx.call('a', { x: second.y });
    return { y: third.y };
  } });
  const { outputs, trace, timing, receipt } = await w.runAsync('flow', { x: 5 });
  assert.deepEqual(outputs, { y: 8 });
  assert.deepEqual(trace.calls.map((c) => c.contract), ['wait', 'wait', 'a'], 'all three are children of flow');
  assert.equal(receipt.status, 'ok');
  const flow = callOf(timing, 'flow');
  assert.equal(flow.ms, 7 + 7 + 10, 'the span includes the time spent waiting');
  assert.equal(sumRows(flow.rows) - flow.overlap, flow.ms);
  assert.equal(w.node(receipt.runId, trace.calls[2].id).contract, 'a');
});

test('7. parallel waits: the overlap is shown, not hidden, and the books close', async () => {
  const clock = manualClock();
  const w = createWorld({ name: 'par', clock: clock.now });
  w.contract({ id: 'fetch', in: { x: num }, out: { y: num } });
  // Each fetch is in flight across the other's await: both start at 0; the clock reaches 10, then 15.
  w.implement({ id: 'fetch/js', implements: 'fetch', run: async ({ x }) => { await new Promise((r) => setTimeout(r, x.value)); clock.t = Math.max(clock.t, x.value); return { y: x.value }; } });
  w.contract({ id: 'both', in: {}, out: { y: num } });
  w.implement({ id: 'both/js', implements: 'both', uses: ['fetch'], run: async (_, ctx) => {
    const [p, q] = await Promise.all([ctx.callAsync('fetch', { x: 10 }), ctx.callAsync('fetch', { x: 15 })]);
    return { y: p.y.value + q.y.value };
  } });
  const { outputs, timing } = await w.runAsync('both', {});
  assert.deepEqual(outputs, { y: 25 });
  const both = callOf(timing, 'both');
  const kids = timing.calls.filter((c) => c.contract === 'fetch');
  assert.deepEqual(kids.map((k) => [k.start, k.ms]), [[0, 10], [0, 15]]);
  assert.equal(both.concurrent, true);
  assert.equal(both.overlap, 10, 'the 10 ms both fetches shared is counted once');
  assert.equal(both.selfMs, 0, 'nothing of its own: the union of its children is its whole span');
  assert.equal(sumRows(both.rows) - both.overlap, both.ms);
});

test('8. two runAsync at once, then a sync run: ids never collide', async () => {
  const clock = manualClock();
  const w = createWorld({ name: 'two', clock: clock.now });
  w.contract({ id: 'slow', in: { x: num }, out: { y: num } });
  w.implement({ id: 'slow/js', implements: 'slow', run: async ({ x }) => { await new Promise((r) => setTimeout(r, 5)); return { y: x.value * 10 }; } });
  w.contract({ id: 'quick', in: { x: num }, out: { y: num } });
  w.implement({ id: 'quick/js', implements: 'quick', run: ({ x }) => ({ y: x.value }) });
  const pending = [w.runAsync('slow', { x: 1 }), w.runAsync('slow', { x: 2 })];
  const mid = w.run('quick', { x: 9 }); // starts while both async runs are still waiting
  const [p, q] = await Promise.all(pending);
  const ids = [p.receipt.runId, q.receipt.runId, mid.receipt.runId];
  assert.equal(new Set(ids).size, 3, `distinct run ids ${ids}`);
  assert.deepEqual([p.outputs.y, q.outputs.y, mid.outputs.y], [10, 20, 9]);
  assert.deepEqual(w.runs().map((r) => r.runId).sort(), [...ids].sort());
  for (const r of [p, q, mid]) {
    assert.equal(w.timing(r.receipt.runId).runId, r.receipt.runId);
    assert.equal(w.node(r.receipt.runId, r.trace.id).contract, r.receipt.contract);
  }
  assert.equal(w.stats().runs, 3);
});

test('9. run keeps ASYNC_RUN, and ctx.callAsync inside a synchronous run is refused by name', async () => {
  const clock = manualClock();
  const w = createWorld({ name: 'sync', clock: clock.now });
  w.contract({ id: 'later', in: {}, out: { y: num } });
  w.implement({ id: 'later/js', implements: 'later', run: async () => ({ y: 1 }) });
  w.contract({ id: 'asks', in: {}, out: { y: num } });
  w.implement({ id: 'asks/js', implements: 'asks', uses: ['later'], run: (_, ctx) => { ctx.callAsync('later', {}); return { y: 0 }; } });
  assert.throws(() => w.run('later', {}), { code: 'ASYNC_RUN' });
  assert.throws(() => w.run('asks', {}), { code: 'ASYNC_IN_SYNC_RUN' });
  const failed = w.runs().at(-1);
  assert.equal(failed.status, 'failed');
  assert.ok(w.timing(failed.runId), 'a failed run still has its side record');
  assert.deepEqual((await w.runAsync('later', {})).outputs, { y: 1 }, 'the same implementation runs under runAsync');
});

test('10. an async call is impure unless its implementation says pure: true out loud', async () => {
  const clock = manualClock();
  const w = createWorld({ name: 'pure', clock: clock.now });
  w.contract({ id: 'f', in: { x: num }, out: { y: num } });
  w.implement({ id: 'f/unsaid', implements: 'f', run: async ({ x }) => ({ y: x.value }) });
  w.implement({ id: 'f/said', implements: 'f', pure: true, run: async ({ x }) => ({ y: x.value }) });
  const unsaid = [await w.runAsync('f', { x: 1 }, { fill: { f: 'f/unsaid' } }), await w.runAsync('f', { x: 1 }, { fill: { f: 'f/unsaid' } })];
  assert.equal(unsaid[0].receipt.impure, true);
  assert.equal(unsaid[1].trace.cached, false, 'not cached: its result may depend on when it settled');
  const said = [await w.runAsync('f', { x: 1 }, { fill: { f: 'f/said' } }), await w.runAsync('f', { x: 1 }, { fill: { f: 'f/said' } })];
  assert.equal(said[0].receipt.impure, false);
  assert.equal(said[1].trace.cached, true, 'declared pure, so the second run is a cache hit');
  const syncPure = createWorld({ name: 'syncpure', clock: clock.now });
  syncPure.contract({ id: 'g', in: { x: num }, out: { y: num } });
  syncPure.implement({ id: 'g/js', implements: 'g', run: ({ x }) => ({ y: x.value }) });
  assert.equal((await syncPure.runAsync('g', { x: 1 })).receipt.impure, false, 'a synchronous implementation under runAsync stays pure');
  assert.equal((await syncPure.runAsync('g', { x: 1 })).trace.cached, true);
});

test('11. the observer sees the side record next to the receipt', () => {
  const clock = manualClock();
  const w = abWorld(clock);
  const seen = [];
  globalThis.__pxcObserve = (o) => seen.push(o);
  try { w.run('outer', { x: 2 }); } finally { delete globalThis.__pxcObserve; }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].timing.runId, seen[0].receipt.runId);
  assert.equal(seen[0].timing.ms, 36);
});

test('12. the default clock is the platform clock, and a sync run under runAsync gives the same receipt shape', async () => {
  const w = createWorld({ name: 'default' });
  w.contract({ id: 'k', in: { x: num }, out: { y: num } });
  w.implement({ id: 'k/js', implements: 'k', run: ({ x }) => ({ y: x.value + 1 }) });
  const s = w.run('k', { x: 1 }, { cache: false }), a = await w.runAsync('k', { x: 1 }, { cache: false });
  assert.ok(Number.isFinite(s.timing.ms) && s.timing.ms >= 0);
  const strip = (r) => canonical({ ...r, runId: 0 });
  assert.equal(strip(a.receipt), strip(s.receipt), 'the same receipt apart from its run id');
});
