// Kernel v0.4: one test per concept that round-3 friction forced. Ledger seq 34+ names the entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';

const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const nums = { type: 'array', items: num };

function base() {
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'abs', in: { x: num }, out: { y: num } });
  return w;
}

// ------------------------------------------------------------------ relational conditions (all five entries)
test('conditions are relations: abs needs no helper contracts, and the decision names both operands', () => {
  const w = base();
  w.compose({ id: 'abs/rel', implements: 'abs', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'keep', call: 'id', when: { ge: ['$in.x', 0] }, bind: { x: '$in.x' } },
  ], returns: { y: { one: ['flip.y', 'keep.y'] } } });
  const a = w.run('abs', { x: -4 });
  assert.equal(a.outputs.y, 4);
  assert.deepEqual(a.trace.calls.map((c) => c.contract), ['neg']);
  assert.deepEqual(a.trace.decisions.map((d) => [d.label, d.value, d.ran ?? null, d.skipped ?? null]), [['flip', true, 'flip', null], ['keep', false, null, 'keep']]);
  assert.deepEqual(a.trace.decisions[0].from, { kind: 'test', op: 'lt', args: [{ kind: 'input', call: 1, port: 'x' }, { kind: 'literal', value: 0 }] });
  assert.equal(w.run('abs', { x: 3 }).outputs.y, 3);
  assert.equal(w.replay(a.receipt).exact, true);
});

test('conditions compose: not, and, or, eq over step outputs and literals; a test can be bound to a boolean port', () => {
  const w = createWorld();
  w.contract({ id: 'pair', in: { a: int, b: int }, out: { both: bool, either: bool, same: bool, notA: bool } });
  w.compose({ id: 'pair/rel', implements: 'pair', steps: [], returns: {
    both: { and: [{ gt: ['$in.a', 0] }, { gt: ['$in.b', 0] }] },
    either: { or: [{ gt: ['$in.a', 0] }, { gt: ['$in.b', 0] }] },
    same: { eq: ['$in.a', '$in.b'] },
    notA: { not: [{ eq: ['$in.a', 0] }] },
  } });
  assert.deepEqual(w.run('pair', { a: 2, b: 0 }).outputs, { both: false, either: true, same: false, notA: true });
  const r = w.run('pair', { a: 0, b: 0 });
  assert.deepEqual(r.outputs, { both: false, either: false, same: true, notA: false });
  assert.equal(r.trace.out.notA.from.kind, 'test');
  assert.equal(r.trace.out.notA.from.args[0].op, 'eq');
});

test('condition lint: operand types, arity, bare literals only inside tests', () => {
  const w = base();
  w.contract({ id: 'isPos', in: { x: num }, out: { yes: bool } });
  w.implement({ id: 'isPos/1', implements: 'isPos', run: ({ x }) => ({ yes: x.value > 0 }) });
  const lint = (returns, steps = []) => assert.throws(() => w.compose({ id: `abs/x${Math.random()}`, implements: 'abs', steps, returns }), (e) => e.code === 'ASSEMBLY_LINT');
  lint({ y: { first: ['f.y'] } }, [{ name: 'p', call: 'isPos', bind: { x: '$in.x' } }, { name: 'f', call: 'neg', when: { lt: ['p.yes', 0] }, bind: { x: '$in.x' } }]); // lt on a boolean
  lint({ y: { first: ['f.y'] } }, [{ name: 'f', call: 'neg', when: { not: ['$in.x'] }, bind: { x: '$in.x' } }]); // not on a number
  lint({ y: { first: ['f.y'] } }, [{ name: 'f', call: 'neg', when: { eq: ['$in.x'] }, bind: { x: '$in.x' } }]); // arity
  lint({ y: 3 }); // bare literal outside a test
  lint({ y: { first: ['f.y'] } }, [{ name: 'f', call: 'neg', when: { gt: ['$in.x', 0] }, bind: { x: 'nosuch.y' } }]);
});

test('one: overlapping branches are AMBIGUOUS_BRANCH where first would silently take the first; none is NO_BRANCH', () => {
  const w = base();
  const steps = [
    { name: 'flip', call: 'neg', when: { le: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'keep', call: 'id', when: { ge: ['$in.x', 0] }, bind: { x: '$in.x' } },
  ];
  w.compose({ id: 'abs/one', implements: 'abs', steps, returns: { y: { one: ['flip.y', 'keep.y'] } } });
  w.compose({ id: 'abs/first', implements: 'abs', steps, returns: { y: { first: ['flip.y', 'keep.y'] } } });
  assert.throws(() => w.run('abs', { x: 0 }, { fill: { abs: 'abs/one' } }), (e) => e.code === 'AMBIGUOUS_BRANCH');
  assert.equal(w.run('abs', { x: 0 }, { fill: { abs: 'abs/first' } }).outputs.y, 0);
  w.compose({ id: 'abs/neg-only', implements: 'abs', steps: [steps[0]], returns: { y: { first: ['flip.y'] } } });
  assert.equal(w.run('abs', { x: -2 }, { fill: { abs: 'abs/neg-only' } }).outputs.y, 2, 'first takes one alternative: release or fail');
  assert.throws(() => w.run('abs', { x: 2 }, { fill: { abs: 'abs/neg-only' } }), (e) => e.code === 'NO_BRANCH');
});

test('a skipped piece makes its gather, concat, at or test skipped, so first falls through instead of failing on a symbol', () => {
  const w = base();
  w.contract({ id: 'wrap', in: { x: num }, out: { v: nums } });
  w.compose({ id: 'wrap/c', implements: 'wrap', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
  ], returns: { v: { first: [{ gather: ['flip.y', '$in.x'] }, { concat: [{ gather: ['$in.x'] }] }] } } });
  assert.deepEqual(w.run('wrap', { x: -1 }).outputs.v, [1, -1]);
  assert.deepEqual(w.run('wrap', { x: 5 }).outputs.v, [5]);
});

test('nested conditions: a step under { and: [A, B] } may read a step under A; and short-circuits past a skipped operand', () => {
  const w = base();
  w.contract({ id: 'f', in: { x: num }, out: { y: num } });
  w.compose({ id: 'f/c', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    // reads flip.y in both its condition and its binding: allowed, because its when contains flip's when
    { name: 'big', call: 'neg', when: { and: [{ lt: ['$in.x', 0] }, { gt: ['flip.y', 10] }] }, bind: { x: 'flip.y' } },
  ], returns: { y: { first: ['big.y', 'flip.y', '$in.x'] } } });
  assert.equal(w.run('f', { x: -20 }).outputs.y, -20, 'flip then big');
  assert.equal(w.run('f', { x: -3 }).outputs.y, 3, 'flip only');
  const pos = w.run('f', { x: 3 });
  assert.equal(pos.outputs.y, 3);
  assert.deepEqual(pos.trace.decisions.map((d) => [d.label, d.value]), [['flip', false], ['big', false]], 'big is decided false by its first operand, not left unread');
  // v0.5: the same step without restating flip's guard is allowed; it inherits flip's condition (see kernel-v05)
  assert.doesNotThrow(() => w.compose({ id: 'f/inherits', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'big', call: 'neg', when: { gt: ['flip.y', 10] }, bind: { x: 'flip.y' } },
  ], returns: { y: { first: ['big.y', '$in.x'] } } }));
});

test('ctx.test and ctx.when: an imperative relation records its operands, and named branches say what ran and what was skipped', () => {
  const w = base();
  w.implement({ id: 'abs/imp', implements: 'abs', uses: ['neg'], run: ({ x }, ctx) => (
    ctx.when({ lt: [x, 0] }, 'negative?', { true: 'negate', false: 'keep' }) ? { y: ctx.call('neg', { x }).y } : { y: x }) });
  const r = w.run('abs', { x: 7 }, { fill: { abs: 'abs/imp' } });
  assert.deepEqual(r.trace.decisions, [{ label: 'negative?', value: false, from: { kind: 'test', op: 'lt', args: [{ kind: 'input', call: 1, port: 'x' }, { kind: 'literal', value: 0 }] }, ran: 'keep', skipped: 'negate' }]);
  w.contract({ id: 'cmp', in: { a: num, b: num }, out: { gt: bool } });
  w.implement({ id: 'cmp/1', implements: 'cmp', run: ({ a, b }, ctx) => ({ gt: ctx.test({ gt: [a, b] }) }) });
  const c = w.run('cmp', { a: 2, b: 1 });
  assert.equal(c.outputs.gt, true);
  assert.equal(c.trace.out.gt.from.kind, 'test');
  w.implement({ id: 'cmp/bad', implements: 'cmp', run: ({ a }, ctx) => ({ gt: ctx.test({ lt: [a, 'x'] }) }) });
  assert.throws(() => w.run('cmp', { a: 2, b: 1 }, { fill: { cmp: 'cmp/bad' } }), (e) => e.code === 'BAD_TEST');
});

// ------------------------------------------------------------------ path-qualified slots (B, D, E, F)
function nibbles() {
  const w = createWorld();
  w.contract({ id: 'leaf', in: { x: num }, out: { y: num } });
  w.implement({ id: 'leaf/inc', implements: 'leaf', run: ({ x }) => ({ y: x.value + 1 }) });
  w.implement({ id: 'leaf/ten', implements: 'leaf', run: ({ x }) => ({ y: x.value + 10 }) });
  w.select('leaf', 'leaf/inc');
  w.contract({ id: 'half', in: { x: num }, out: { y: num } });
  w.compose({ id: 'half/c', implements: 'half', steps: [
    { name: 'a', call: 'leaf', slot: 'b0', bind: { x: '$in.x' } },
    { name: 'b', call: 'leaf', slot: 'b1', bind: { x: 'a.y' } },
  ], returns: { y: 'b.y' } });
  w.contract({ id: 'whole', in: { x: num }, out: { lo: num, hi: num } });
  w.compose({ id: 'whole/c', implements: 'whole', steps: [
    { name: 'lo', call: 'half', slot: 'lo', bind: { x: '$in.x' } },
    { name: 'hi', call: 'half', slot: 'hi', bind: { x: '$in.x' } },
  ], returns: { lo: 'lo.y', hi: 'hi.y' } });
  return w;
}
const leafImpls = (t) => { const out = []; (function walk(n) { if (n.contract === 'leaf') out.push(`${n.slot}:${n.impl}`); n.calls.forEach(walk); })(t); return out; };

test('path slots: one key reaches exactly one call site; a flat slot key still reaches every b1', () => {
  const w = nibbles();
  const flat = w.run('whole', { x: 0 }, { fill: { 'leaf#b1': 'leaf/ten' }, cache: false });
  assert.deepEqual(flat.outputs, { lo: 11, hi: 11 });
  const path = w.run('whole', { x: 0 }, { fill: { 'half#hi/leaf#b1': 'leaf/ten' }, cache: false });
  assert.deepEqual(path.outputs, { lo: 2, hi: 11 });
  assert.deepEqual(leafImpls(path.trace), ['b0:leaf/inc', 'b1:leaf/inc', 'b0:leaf/inc', 'b1:leaf/ten']);
  const both = w.run('whole', { x: 0 }, { fill: { 'leaf#b1': 'leaf/ten', 'half#lo/leaf#b1': 'leaf/inc' }, cache: false });
  assert.deepEqual(both.outputs, { lo: 2, hi: 11 }, 'the longer path beats the flat key');
});

test('path slots: typos and ties are BAD_FILL; a path through a bare contract matches any slot of it', () => {
  const w = nibbles();
  assert.throws(() => w.run('whole', { x: 0 }, { fill: { 'half#hj/leaf#b1': 'leaf/ten' } }), (e) => e.code === 'BAD_FILL' && /half#hj/.test(e.message));
  assert.throws(() => w.run('whole', { x: 0 }, { fill: { 'nosuch/leaf#b1': 'leaf/ten' } }), (e) => e.code === 'BAD_FILL');
  assert.throws(() => w.run('whole', { x: 0 }, { fill: { 'whole/leaf#b1': 'leaf/ten', 'half/leaf#b1': 'leaf/inc' } }), (e) => e.code === 'BAD_FILL' && /both match/.test(e.message));
  assert.deepEqual(w.run('whole', { x: 0 }, { fill: { 'half/leaf#b0': 'leaf/ten' } }).outputs, { lo: 11, hi: 11 });
});

test('path slots and the cache: an entry made without path fills is never served under one, and a path-aware entry is', () => {
  const w = nibbles();
  assert.deepEqual(w.run('whole', { x: 0 }).outputs, { lo: 2, hi: 2 });
  const p1 = w.run('whole', { x: 0 }, { fill: { 'half#hi/leaf#b1': 'leaf/ten' } });
  assert.deepEqual(p1.outputs, { lo: 2, hi: 11 });
  assert.equal(p1.trace.cached, false);
  const p2 = w.run('whole', { x: 0 }, { fill: { 'half#hi/leaf#b1': 'leaf/ten' } });
  assert.equal(p2.trace.cached, true, 'the path-aware entry is reused under the same path fill');
  assert.deepEqual(p2.outputs, { lo: 2, hi: 11 });
  const p3 = w.run('whole', { x: 0 }, { fill: { 'half#lo/leaf#b1': 'leaf/ten' } });
  assert.deepEqual(p3.outputs, { lo: 11, hi: 2 }, 'another path fill is not served the hi entry');
  const flat = w.run('whole', { x: 0 });
  assert.deepEqual(flat.outputs, { lo: 2, hi: 2 }, 'a run without path fills is not served an entry whose leaf#b1 resolved two ways');
});

test('path slots and the cache: an entry whose flat choices resolved two ways is never served to a flat run', () => {
  const w = nibbles();
  const p = w.run('whole', { x: 0 }, { fill: { 'half#lo/leaf#b1': 'leaf/ten' } });
  assert.deepEqual(p.outputs, { lo: 11, hi: 2 });
  // The only entry for whole saw leaf#b1 resolve to ten (lo) and inc (hi). Last-wins bookkeeping would record inc and
  // serve { lo: 11 } to the flat run below; the conflict marker refuses it.
  const flat = w.run('whole', { x: 0 });
  assert.equal(flat.trace.cached, false);
  assert.deepEqual(flat.outputs, { lo: 2, hi: 2 });
});

// ------------------------------------------------------------------ ctx.drive collect, zero ticks, startTick, stop (B, C, D, F, E)
function counter() {
  const w = createWorld();
  w.contract({ id: 'step', kind: 'tick', in: { state: int }, out: { state: int, out: int } });
  w.implement({ id: 'step/1', implements: 'step', run: ({ state }, ctx) => ({ state: state.value + 1, out: state.value * 10 + ctx.tick() }) });
  w.contract({ id: 'loop', in: { s: int, n: int }, out: { s: int, outs: { type: 'array', items: int }, ticks: int } });
  w.implement({ id: 'loop/1', implements: 'loop', uses: ['step'], run: ({ s, n }, ctx) => {
    const d = ctx.drive('step', { state: s }, { ticks: n.value, collect: ['out'], startTick: 5 });
    return { s: d.state, outs: d.collected.out, ticks: d.ticks };
  } });
  return w;
}

test('ctx.drive collect: every tick\'s output in one Ref, each element pointing at its tick\'s call; startTick shifts the clock', () => {
  const w = counter();
  const r = w.run('loop', { s: 0, n: 3 });
  assert.deepEqual(r.outputs, { s: 3, outs: [5, 16, 27], ticks: 3 });
  assert.deepEqual(r.trace.calls.map((c) => c.tick), [5, 6, 7]);
  const pieces = r.trace.out.outs.from.pieces;
  assert.deepEqual(pieces.map((p) => [p.path[0], p.from.call]), [[0, 2], [1, 3], [2, 4]]);
  assert.deepEqual(r.trace.drives, [{ contract: 'step', slot: null, startTick: 5, ticks: 3, stopped: 'ticks', calls: [2, 3, 4] }]);
  assert.equal(w.replay(r.receipt).exact, true);
});

test('ctx.drive: zero ticks returns the input state; until records why it stopped', () => {
  const w = counter();
  const z = w.run('loop', { s: 4, n: 0 });
  assert.deepEqual(z.outputs, { s: 4, outs: [], ticks: 0 });
  w.contract({ id: 'upto', in: { s: int }, out: { s: int } });
  w.implement({ id: 'upto/1', implements: 'upto', uses: ['step'], run: ({ s }, ctx) => ({ s: ctx.drive('step', { state: s }, { until: (o) => o.state >= 3, maxTicks: 10 }).state }) });
  const u = w.run('upto', { s: 0 });
  assert.equal(u.outputs.s, 3);
  assert.equal(u.trace.drives[0].stopped, 'until');
  w.implement({ id: 'upto/cap', implements: 'upto', uses: ['step'], run: ({ s }, ctx) => ({ s: ctx.drive('step', { state: s }, { until: () => false, maxTicks: 2 }).state }) });
  assert.equal(w.run('upto', { s: 0 }, { fill: { upto: 'upto/cap' } }).trace.drives[0].stopped, 'maxTicks');
});

test('world.drive startTick: a resumed drive continues the clock instead of restarting it', () => {
  const w = counter();
  const first = w.drive('step', { state: 0 }, { ticks: 2 });
  const rest = w.drive('step', { state: first.state }, { ticks: 2, startTick: 2 });
  assert.deepEqual(rest.receipts.map((r) => [r.tick, w.part(r.outputs.out)]), [[2, 22], [3, 33]]);
  assert.equal(rest.receipts[0].trace.in.state.from.kind, 'run');
});

// ------------------------------------------------------------------ cache hits carry decisions (F 25)
test('a cache hit carries the decisions its node made', () => {
  const w = base();
  w.implement({ id: 'abs/imp', implements: 'abs', uses: ['neg'], run: ({ x }, ctx) => (ctx.when({ lt: [x, 0] }, 'neg?') ? { y: ctx.call('neg', { x }).y } : { y: x }) });
  const a = w.run('abs', { x: -1 });
  const b = w.run('abs', { x: -1 });
  assert.equal(b.trace.cached, true);
  assert.deepEqual(b.trace.decisions, a.trace.decisions);
});

// ------------------------------------------------------------------ small fixes
test('world.node is indexed: lookups on a large trace are constant time, missing calls are null', () => {
  const w = createWorld();
  w.contract({ id: 'fib', in: { n: int }, out: { v: int } });
  w.implement({ id: 'fib/1', implements: 'fib', uses: ['fib'], run: ({ n }, ctx) => ({ v: n.value < 2 ? n.value : ctx.call('fib', { n: n.value - 1 }).v.value + ctx.call('fib', { n: n.value - 2 }).v.value }) });
  const r = w.run('fib', { n: 18 }, { cache: false });
  const total = r.receipt.calls;
  const t0 = performance.now();
  for (let i = 1; i <= total; i += 1) assert.ok(w.node(r.receipt.runId, i));
  assert.ok(performance.now() - t0 < 500, `${total} lookups`);
  assert.equal(w.node(r.receipt.runId, total + 1), null);
  assert.equal(w.node(99, 1), null);
});

test('implement({ examples: undefined }) is the same as no examples; x- annotations ride on schemas; ids may not contain / or #', () => {
  const w = createWorld();
  w.contract({ id: 'm', in: { model: { type: 'object', 'x-role': 'model' } }, out: { y: num } });
  w.implement({ id: 'm/1', implements: 'm', examples: undefined, run: () => ({ y: 1 }) });
  assert.deepEqual(w.prove('m'), []);
  assert.equal(w.contracts().find((c) => c.id === 'm').in.model['x-role'], 'model');
  assert.throws(() => w.contract({ id: 'n', in: { a: { type: 'number', role: 'model' } }, out: {} }), (e) => e.code === 'BAD_SCHEMA');
  assert.throws(() => w.contract({ id: 'a/b', in: {}, out: {} }), (e) => e.code === 'BAD_CONTRACT');
});
