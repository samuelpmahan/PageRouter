import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';
import { register } from '../contest/a-numeric/index.mjs';

const num = { type: 'number' };

function nested() {
  const w = createWorld();
  w.contract({ id: 'leaf', in: { x: num }, out: { y: num } });
  w.implement({ id: 'leaf/double', implements: 'leaf', run: ({ x }) => ({ y: x.value * 2 }) });
  w.implement({ id: 'leaf/square', implements: 'leaf', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.select('leaf', 'leaf/double');
  w.contract({ id: 'top', in: { x: num }, out: { y: num } });
  w.implement({ id: 'top/plus1', implements: 'top', uses: ['leaf'], run: ({ x }, ctx) => ({ y: ctx.call('leaf', { x }).y.value + 1 }) });
  return w;
}

test('cache: an entry is reused only when nested implementation choices still resolve the same', () => {
  const w = nested();
  assert.equal(w.run('top', { x: 3 }).outputs.y, 7);
  const sq = w.run('top', { x: 3 }, { fill: { leaf: 'leaf/square' } });
  assert.equal(sq.outputs.y, 10, 'nested fill must not be served from the double entry');
  assert.equal(sq.trace.cached, false);
  const again = w.run('top', { x: 3 });
  assert.equal(again.outputs.y, 7);
  assert.equal(again.trace.cached, true, 'the default entry is still valid for the default fill');
  assert.ok(w.stats().cacheRejectedByDeps >= 1);
});

test('cache: cache:false neither reads nor writes', () => {
  const w = nested();
  w.run('top', { x: 5 }, { cache: false });
  assert.equal(w.stats().cacheEntries, 0);
});

test('cache: randomness marks the subtree impure, so seeds are never served from another seed', () => {
  const w = createWorld();
  w.contract({ id: 'r', in: {}, out: { v: num } });
  w.implement({ id: 'r/1', implements: 'r', run: (_, ctx) => ({ v: ctx.random() }) });
  w.contract({ id: 'wrap', in: {}, out: { v: num } });
  w.implement({ id: 'wrap/1', implements: 'wrap', uses: ['r'], run: (_, ctx) => ({ v: ctx.call('r', {}).v }) });
  const a = w.run('wrap', {}, { seed: 1 }); const b = w.run('wrap', {}, { seed: 2 });
  assert.notEqual(a.outputs.v, b.outputs.v);
  assert.equal(a.trace.impure, true);
  assert.equal(a.receipt.impure, true);
  assert.equal(w.replay(a.receipt).exact, true);
});

test('cross-run Refs keep their origin as a run edge', () => {
  const w = nested();
  const first = w.run('leaf', { x: 4 });
  const second = w.run('top', { x: first.refs.y });
  assert.deepEqual(second.trace.in.x.from, { kind: 'run', run: first.receipt.runId, from: { kind: 'call', call: 1, port: 'y' } });
  assert.equal(second.trace.calls[0].in.x.from.kind, 'input', 'inside the new run the child sees its caller input');
});

test('gather keeps every piece\'s provenance; at and gather are inverses', () => {
  const w = createWorld();
  const vec = { type: 'array', items: num };
  w.contract({ id: 'split', in: { v: vec }, out: { a: num, b: num } });
  w.implement({ id: 'split/1', implements: 'split', run: ({ v }, ctx) => ({ a: ctx.at(v, 0), b: ctx.at(v, 1) }) });
  w.contract({ id: 'swap', in: { v: vec }, out: { v: vec } });
  w.compose({ id: 'swap/composed', implements: 'swap',
    steps: [{ name: 's', call: 'split', bind: { v: '$in.v' } }],
    returns: { v: { gather: ['s.b', 's.a'] } } });
  const r = w.run('swap', { v: [1, 2] });
  assert.deepEqual(r.outputs.v, [2, 1]);
  const from = r.trace.out.v.from;
  assert.equal(from.kind, 'gather');
  assert.deepEqual(from.pieces.map((p) => [p.path, p.from.port]), [[[0], 'b'], [[1], 'a']]);
});

test('slots: two seats fill one contract differently in one run, and the trace names the slot', () => {
  const w = nested();
  w.contract({ id: 'pair', in: { x: num }, out: { a: num, b: num } });
  w.implement({ id: 'pair/1', implements: 'pair', uses: ['leaf'], run: ({ x }, ctx) => ({
    a: ctx.call('leaf', { x }, { slot: 'A' }).y, b: ctx.call('leaf', { x }, { slot: 'B' }).y }) });
  const r = w.run('pair', { x: 3 }, { fill: { 'leaf#A': 'leaf/double', 'leaf#B': 'leaf/square' } });
  assert.deepEqual(r.outputs, { a: 6, b: 9 });
  assert.deepEqual(r.trace.calls.map((c) => [c.slot, c.impl]), [['A', 'leaf/double'], ['B', 'leaf/square']]);
  const swapped = w.run('pair', { x: 3 }, { fill: { 'leaf#A': 'leaf/square', 'leaf#B': 'leaf/double' } });
  assert.deepEqual(swapped.outputs, { a: 9, b: 6 }, 'cache must not serve the first seating');
  assert.throws(() => w.run('pair', { x: 1 }, { fill: { 'nope#A': 'leaf/double' } }), (e) => e.code === 'BAD_FILL');
});

test('check kind: verdicts are typed, collected on the receipt and coloured in the trace', () => {
  const w = createWorld();
  assert.throws(() => w.contract({ id: 'c0', kind: 'check', in: {}, out: { ok: { type: 'boolean' } } }), (e) => e.code === 'BAD_CONTRACT');
  w.contract({ id: 'positive', kind: 'check', in: { x: num }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } } });
  w.implement({ id: 'positive/1', implements: 'positive', run: ({ x }) => ({ accepted: x.value > 0, reason: x.value > 0 ? 'x > 0' : `x = ${x.value} is not > 0` }) });
  const r = w.run('positive', { x: -2 });
  assert.equal(r.trace.kind, 'check');
  assert.deepEqual(r.receipt.verdicts, [{ call: 1, contract: 'positive', impl: 'positive/1', accepted: false, reason: 'x = -2 is not > 0' }]);
});

test('tick kind: drive links each tick to the last by a run edge; any single tick replays alone in a fresh world', () => {
  const make = () => {
    const w = createWorld();
    w.contract({ id: 'count', kind: 'tick', in: { state: { type: 'integer' } }, out: { state: { type: 'integer' } } });
    w.implement({ id: 'count/mod16', implements: 'count', run: ({ state }) => ({ state: (state.value + 1) % 16 }) });
    return w;
  };
  const w = make();
  const d = w.drive('count', { state: 14 }, { ticks: 5 });
  assert.deepEqual(d.receipts.map((r) => w.part(r.outputs.state)), [15, 0, 1, 2, 3]);
  assert.deepEqual(d.receipts.map((r) => r.tick), [0, 1, 2, 3, 4]);
  assert.equal(d.receipts[3].trace.in.state.from.kind, 'run');
  assert.equal(d.receipts[3].trace.in.state.from.run, d.receipts[2].runId);
  assert.equal(make().replay(d.receipts[3]).exact, true, 'tick 3 replays without ticks 0-2, in a different world');
  const until = make().drive('count', { state: 0 }, { until: (out) => out.state === 3 });
  assert.equal(until.ticks, 3);
});

test('errors: any throw leaves the partial trace and a failed receipt', () => {
  const w = createWorld();
  w.contract({ id: 'boom', in: { x: num }, out: { y: num } });
  w.implement({ id: 'boom/1', implements: 'boom', run: () => { throw new Error('plain error'); } });
  let caught;
  try { w.run('boom', { x: 1 }); } catch (e) { caught = e; }
  assert.equal(caught.trace.error.code, 'IMPL_ERROR');
  assert.equal(caught.receipt.status, 'failed');
  assert.equal(w.runs().at(-1).status, 'failed');
  try { w.run('boom', { x: 'no' }); } catch (e) { caught = e; }
  assert.equal(caught.trace.error.code, 'INPUT_SCHEMA', 'schema failures also get a node');
});

test('replay does not append to run history, and oneOf forwards into an identical oneOf', () => {
  const w = createWorld(); register(w);
  const r = w.run('stat.zScores', { values: [1, 2, 3] });
  const before = w.runs().length;
  assert.equal(w.replay(r.receipt).exact, true);
  assert.equal(w.runs().length, before);
  const maybe = { oneOf: [num, { type: 'null' }] };
  w.contract({ id: 'm', in: { v: maybe }, out: { v: maybe } });
  w.implement({ id: 'm/1', implements: 'm', run: ({ v }) => ({ v }) });
  w.contract({ id: 'mm', in: { v: maybe }, out: { v: maybe } });
  assert.doesNotThrow(() => w.compose({ id: 'mm/1', implements: 'mm', steps: [{ name: 'a', call: 'm', bind: { v: '$in.v' } }], returns: { v: 'a.v' } }));
});
