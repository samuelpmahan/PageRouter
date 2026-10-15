// Kernel v0.5: one test per concept that round-4 friction forced. Ledger seq 44+ names the entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';

const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const str = { type: 'string' };

function base() {
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } });
  w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'f', in: { x: num }, out: { y: num } });
  return w;
}

// ------------------------------------------------------------------ inherited skips (C top request, E N14, C N16)
test('a step that reads a skipped step is skipped too, with the same cause; the guard is written once', () => {
  const w = base();
  w.compose({ id: 'f/c', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'sqr', call: 'sq', bind: { x: 'flip.y' } },                 // no when: inherits flip's
    { name: 'again', call: 'neg', bind: { x: 'sqr.y' } },              // inherits through sqr
  ], returns: { y: { first: ['again.y', '$in.x'] } } });
  const neg = w.run('f', { x: -3 });
  assert.equal(neg.outputs.y, -9);
  assert.deepEqual(neg.trace.calls.map((c) => c.contract), ['neg', 'sq', 'neg']);
  const pos = w.run('f', { x: 3 });
  assert.equal(pos.outputs.y, 3);
  assert.equal(pos.trace.calls.length, 0);
  const cause = pos.trace.decisions[0].from;
  assert.deepEqual(pos.trace.decisions.map((d) => [d.label, d.value, d.skipped]), [['flip', false, 'flip'], ['sqr', false, 'sqr'], ['again', false, 'again']]);
  assert.ok(pos.trace.decisions.every((d) => JSON.stringify(d.from) === JSON.stringify(cause)), 'every inherited skip names the original cause');
  assert.equal(w.replay(pos.receipt).exact, true);
});

test('inherited conditions still guard the boundary: returning an inherited output outside first or one fails assembly', () => {
  const w = base();
  assert.throws(() => w.compose({ id: 'f/bad', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'sqr', call: 'sq', bind: { x: 'flip.y' } },
  ], returns: { y: 'sqr.y' } }), (e) => e.code === 'ASSEMBLY_LINT' && /conditional step sqr/.test(e.message));
});

// ------------------------------------------------------------------ else (all five: complements typed by hand)
test('else: the complement is derived, never typed; its provenance names the steps and what decided them', () => {
  const w = base();
  w.compose({ id: 'f/else', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'keep', call: 'id', when: { else: ['flip'] }, bind: { x: '$in.x' } },
  ], returns: { y: { one: ['flip.y', 'keep.y'] } } });
  assert.equal(w.run('f', { x: -2 }).outputs.y, 2);
  const r = w.run('f', { x: 5 });
  assert.equal(r.outputs.y, 5);
  const keep = r.trace.decisions.find((d) => d.label === 'keep');
  assert.equal(keep.value, true);
  assert.equal(keep.from.op, 'else');
  assert.deepEqual(keep.from.steps, ['flip']);
  assert.deepEqual(keep.from.args[0], r.trace.decisions[0].from, 'else points at the condition that skipped flip');
});

test('else over several steps is a multi-way otherwise; else of an unconditional step fails assembly', () => {
  const w = base();
  w.contract({ id: 'kind', in: { k: str, x: num }, out: { y: num } });
  w.compose({ id: 'kind/c', implements: 'kind', steps: [
    { name: 'a', call: 'neg', when: { eq: ['$in.k', { literal: 'neg' }] }, bind: { x: '$in.x' } },
    { name: 'b', call: 'sq', when: { eq: ['$in.k', { literal: 'sq' }] }, bind: { x: '$in.x' } },
    { name: 'other', call: 'id', when: { else: ['a', 'b'] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['a.y', 'b.y', 'other.y'] } } });
  assert.deepEqual(['neg', 'sq', 'zzz'].map((k) => w.run('kind', { k, x: 3 }).outputs.y), [-3, 9, 3]);
  assert.throws(() => w.compose({ id: 'f/x', implements: 'f', steps: [
    { name: 'n', call: 'neg', bind: { x: '$in.x' } },
    { name: 'o', call: 'id', when: { else: ['n'] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['o.y', 'n.y'] } } }), (e) => e.code === 'ASSEMBLY_LINT' && /not conditional/.test(e.message));
});

test('one: provable overlap fails at assembly (an unconditional alternative, or one condition implying another)', () => {
  const w = base();
  const flip = { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } };
  assert.throws(() => w.compose({ id: 'f/o1', implements: 'f', steps: [flip, { name: 'k', call: 'id', bind: { x: '$in.x' } }], returns: { y: { one: ['flip.y', 'k.y'] } } }),
    (e) => e.code === 'ASSEMBLY_LINT' && /unconditional/.test(e.message));
  assert.throws(() => w.compose({ id: 'f/o2', implements: 'f', steps: [flip, { name: 'g', call: 'sq', when: { and: [{ lt: ['$in.x', 0] }, { gt: ['$in.x', -10] }] }, bind: { x: '$in.x' } }], returns: { y: { one: ['flip.y', 'g.y'] } } }),
    (e) => e.code === 'ASSEMBLY_LINT' && /implies/.test(e.message));
});

// ------------------------------------------------------------------ specificity (E top request N13, C N10, F 35)
function seated() {
  const w = createWorld();
  w.contract({ id: 'pick', in: { x: int }, out: { y: int } });
  w.implement({ id: 'pick/a', implements: 'pick', run: ({ x }) => ({ y: x.value + 1 }) });
  w.implement({ id: 'pick/b', implements: 'pick', run: ({ x }) => ({ y: x.value + 100 }) });
  w.contract({ id: 'game', in: { x: int }, out: { me: int, model: int } });
  w.implement({ id: 'game/1', implements: 'game', uses: ['pick#me', 'pick#model'], run: ({ x }, ctx) => ({ me: ctx.call('pick', { x }, { slot: 'me' }).y, model: ctx.call('pick', { x }, { slot: 'model' }).y }) });
  w.select('pick', 'pick/a');
  w.select('pick', 'pick/a', 'model'); // the opponent model is pinned
  return w;
}

test('specificity: a slot select beats a contract fill, so prove and plain fills no longer trample a pinned seat', () => {
  const w = seated();
  assert.deepEqual(w.run('game', { x: 0 }, { fill: { pick: 'pick/b' } }).outputs, { me: 100, model: 1 }, 'the pinned model keeps pick/a');
  assert.deepEqual(w.run('game', { x: 0 }, { fill: { 'pick#*': 'pick/b' } }).outputs, { me: 100, model: 100 }, 'pick#* reaches every slot on purpose');
  assert.deepEqual(w.run('game', { x: 0 }, { fill: { 'pick#*': 'pick/b', 'pick#model': 'pick/a' } }).outputs, { me: 100, model: 1 }, 'an exact slot fill beats #*');
  const r = w.run('game', { x: 0 }, { fill: { pick: 'pick/b' } });
  assert.deepEqual(r.receipt.fillConsulted, ['pick']);
});

// ------------------------------------------------------------------ path fills must land (C N19, D F-22, E N19, F 21/35)
test('a path fill that reaches no call is BAD_FILL; across a drive it only has to land once', () => {
  const w = seated();
  w.contract({ id: 'outer', in: { x: int }, out: { y: int } });
  w.implement({ id: 'outer/1', implements: 'outer', uses: ['pick#me'], run: ({ x }, ctx) => ({ y: ctx.call('pick', { x }, { slot: 'me' }).y }) });
  assert.throws(() => w.run('outer', { x: 0 }, { fill: { 'game/pick#me': 'pick/b' } }), (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message));
  assert.equal(w.run('game', { x: 0 }, { fill: { 'game/pick#me': 'pick/b' } }).outputs.me, 100);
  w.contract({ id: 'turn', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'turn/1', implements: 'turn', uses: ['game', 'outer'], run: ({ state }, ctx) => ({ state: ctx.when({ eq: [ctx.tick(), 2] }, 'game tick?') ? ctx.call('game', { x: state }).me : ctx.call('outer', { x: state }).y }) });
  assert.doesNotThrow(() => w.drive('turn', { state: 0 }, { ticks: 3, fill: { 'game/pick#me': 'pick/b' } }), 'lands on tick 2 only');
  assert.throws(() => w.drive('turn', { state: 0 }, { ticks: 2, fill: { 'game/pick#me': 'pick/b' } }), (e) => e.code === 'BAD_FILL');
});

// ------------------------------------------------------------------ literal values in provenance (D F-24, E N15, F 33)
test('a string literal operand keeps its value in a test\'s provenance', () => {
  const w = base();
  w.contract({ id: 'kind', in: { k: str, x: num }, out: { y: num } });
  w.compose({ id: 'kind/c', implements: 'kind', steps: [
    { name: 'a', call: 'neg', when: { eq: ['$in.k', { literal: 'neg' }] }, bind: { x: '$in.x' } },
    { name: 'b', call: 'id', when: { else: ['a'] }, bind: { x: '$in.x' } },
  ], returns: { y: { one: ['a.y', 'b.y'] } } });
  const r = w.run('kind', { k: 'neg', x: 3 });
  assert.deepEqual(r.trace.decisions[0].from.args[1], { kind: 'literal', value: 'neg' });
});

// ------------------------------------------------------------------ temporal examples (B top request N10, F 13)
function latch() {
  const w = createWorld();
  const st = { type: 'object', properties: { q: int }, required: ['q'] };
  w.contract({ id: 'latch', kind: 'tick', in: { state: st, s: int, r: int }, out: { state: st, q: int },
    examples: [{ in: { state: { q: 0 }, s: 0, r: 0 }, each: [{}, { s: 1 }, {}, { r: 1 }, {}], trajectory: [{ q: 0 }, { q: 1 }, { q: 1 }, { q: 0 }, { q: 0 }] }] });
  w.implement({ id: 'latch/sr', implements: 'latch', run: ({ state, s, r }) => {
    const q = s.value ? 1 : r.value ? 0 : state.value.q; return { state: { q }, q };
  } });
  w.implement({ id: 'latch/leaky', implements: 'latch', run: ({ s }) => { const q = s.value ? 1 : 0; return { state: { q }, q }; } });
  return w;
}

test('examples over time: each gives inputs per tick, trajectory states outputs per tick, and prove checks every tick', () => {
  const w = latch();
  const p = w.prove('latch');
  assert.deepEqual(p.map((x) => [x.impl, x.ok]), [['latch/sr', true], ['latch/leaky', false]]);
  assert.match(p[1].detail, /tick 2: expected \{"q":1\} got \{"q":0\}/, 'the leaky latch forgets on the hold after SET');
});

test('examples at a tick: a calculation that reads the clock can be proved at a given tick', () => {
  const w = createWorld();
  w.contract({ id: 'stamp', in: { x: int }, out: { y: int }, examples: [{ in: { x: 1 }, tick: 7, out: { y: 107 } }] });
  w.implement({ id: 'stamp/1', implements: 'stamp', run: ({ x }, ctx) => ({ y: x.value * 100 + ctx.tick() }) });
  assert.equal(w.prove('stamp')[0].ok, true);
});

// ------------------------------------------------------------------ drives say until when until held on the last tick (E N16)
test('node.drives says until when until held on the last allowed tick', () => {
  const w = createWorld();
  w.contract({ id: 'inc', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'inc/1', implements: 'inc', run: ({ state }) => ({ state: state.value + 1 }) });
  w.contract({ id: 'go', in: { s: int }, out: { s: int } });
  w.implement({ id: 'go/1', implements: 'go', uses: ['inc'], run: ({ s }, ctx) => ({ s: ctx.drive('inc', { state: s }, { until: (o) => o.state >= 3, maxTicks: 3 }).state }) });
  assert.equal(w.run('go', { s: 0 }).trace.drives[0].stopped, 'until');
});

// ------------------------------------------------------------------ view: decisions carried by a cache hit (independent audit, verify/AUDIT.md)
test('view: a cache hit\'s decisions never draw edges to same-numbered boxes of the current run; with expand they reach the original\'s boxes', async () => {
  const { traceToSvg } = await import('../src/view.mjs');
  const w = base();
  w.compose({ id: 'f/c', implements: 'f', steps: [
    { name: 'sqr', call: 'sq', bind: { x: '$in.x' } },
    { name: 'big', call: 'neg', when: { gt: ['sqr.y', 10] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['big.y', '$in.x'] } } });
  w.contract({ id: 'g', in: { x: num }, out: { y: num } });
  w.implement({ id: 'g/1', implements: 'g', uses: ['sq', 'f'], run: ({ x }, ctx) => { ctx.call('sq', { x: 1 }); return { y: ctx.call('f', { x }).y }; } });
  const first = w.run('f', { x: 5 });
  const r = w.run('g', { x: 5 });
  assert.equal(r.trace.calls[1].cached, true);
  assert.equal(r.trace.calls[1].decisions.length, 1, 'the hit carries the decision');
  const amber = (svg) => (svg.match(/class="e-dec"/g) ?? []).length;
  assert.equal(amber(traceToSvg(r.trace, w.part)), 0, 'without the original subtree drawn, the call operand has no box to point at; #2 here is an unrelated sq');
  const expanded = traceToSvg(r.trace, w.part, { expand: (n) => w.node(n.cachedFrom.run, n.cachedFrom.call) });
  assert.equal(amber(expanded), 1, 'with expand, the edge reaches the ghost of the original sqr');
  void first;
});
