// Kernel v0.3: one test per concept that round-2 friction forced. Ledger seq 24+ names the entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';

const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const str = { type: 'string' };
const nums = { type: 'array', items: num };

function walk(n, f) { if (!n) return; f(n); n.calls.forEach((c) => walk(c, f)); }

// ------------------------------------------------------------------ tick dependency (B N1, F 11)
function clockWorld() {
  const w = createWorld();
  w.contract({ id: 'stamp', in: { x: num }, out: { y: num } });
  w.implement({ id: 'stamp/tick', implements: 'stamp', run: ({ x }, ctx) => ({ y: x.value * 100 + ctx.tick() }) });
  w.contract({ id: 'clock', kind: 'tick', in: { state: num }, out: { state: num } });
  w.implement({ id: 'clock/stamp', implements: 'clock', uses: ['stamp'], run: (_, ctx) => ({ state: ctx.call('stamp', { x: 1 }).y }) });
  return w;
}

test('tick dependency: a call that reads ctx.tick() is cached per tick, never served at another tick', () => {
  const w = clockWorld();
  const d = w.drive('clock', { state: 0 }, { ticks: 4 });
  assert.deepEqual(d.receipts.map((r) => w.part(r.outputs.state)), [100, 101, 102, 103], 'same input, different tick, different output');
  for (const r of d.receipts) assert.equal(w.replay(r).exact, true, `tick ${r.tick} replays`);
  const again = w.drive('clock', { state: 0 }, { ticks: 4 });
  assert.deepEqual(again.receipts.map((r) => r.trace.cached), [true, true, true, true], 'the second drive hits each tick\'s own entry at the root');
  assert.deepEqual(again.receipts.map((r) => w.part(r.outputs.state)), [100, 101, 102, 103]);
});

test('tick dependency: a call that never reads the tick is shared across ticks', () => {
  const w = createWorld();
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } });
  w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 't', kind: 'tick', in: { state: num }, out: { state: num } });
  w.implement({ id: 't/1', implements: 't', uses: ['sq'], run: ({ state }, ctx) => ({ state: state.value + ctx.call('sq', { x: 3 }).y.value }) });
  const d = w.drive('t', { state: 0 }, { ticks: 3 });
  assert.deepEqual(d.receipts.map((r) => r.trace.calls[0].cached), [false, true, true]);
  assert.equal(d.final.state, 27);
});

// ------------------------------------------------------------------ slots (B S2, C N2, E 2)
function seats() {
  const w = createWorld();
  w.contract({ id: 'leaf', in: { x: num }, out: { y: num } });
  w.implement({ id: 'leaf/double', implements: 'leaf', run: ({ x }) => ({ y: x.value * 2 }) });
  w.implement({ id: 'leaf/square', implements: 'leaf', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.select('leaf', 'leaf/double');
  w.contract({ id: 'pair', in: { x: num, which: int }, out: { y: num } });
  w.implement({ id: 'pair/1', implements: 'pair', uses: ['leaf#A', 'leaf#B'],
    run: ({ x, which }, ctx) => ({ y: ctx.call('leaf', { x }, { slot: which.value === 0 ? 'A' : 'B' }).y }) });
  return w;
}

test('slots: a fill key for a slot nobody declares and nobody consulted is BAD_FILL (a typo)', () => {
  const w = seats();
  assert.throws(() => w.run('pair', { x: 3, which: 0 }, { fill: { 'leaf#C': 'leaf/square' } }), (e) => e.code === 'BAD_FILL' && /leaf#C/.test(e.message));
  assert.doesNotThrow(() => w.run('pair', { x: 3, which: 0 }, { fill: { 'leaf#C': 'leaf/square' }, allowUnusedFill: true }));
});

test('slots: a declared slot that this run happened not to reach is a valid fill (standing configuration)', () => {
  const w = seats();
  const r = w.run('pair', { x: 3, which: 0 }, { fill: { 'leaf#B': 'leaf/square' } });
  assert.equal(r.outputs.y, 6, 'slot A ran with the default; the B key is declared, so not a typo');
});

test('slots: an implementation that declares slots may not call an undeclared one', () => {
  const w = seats();
  w.contract({ id: 'bad', in: { x: num }, out: { y: num } });
  w.implement({ id: 'bad/1', implements: 'bad', uses: ['leaf#A'], run: ({ x }, ctx) => ({ y: ctx.call('leaf', { x }, { slot: 'Z' }).y }) });
  assert.throws(() => w.run('bad', { x: 1 }), (e) => e.code === 'UNDECLARED_SLOT' && e.trace.calls.length === 0 && e.trace.error.code === 'UNDECLARED_SLOT');
});

test('slots: a drive validates its fill across all ticks, so a seat used only on odd ticks is not a typo', () => {
  const w = createWorld();
  w.contract({ id: 'move', in: { s: int }, out: { s: int } });
  w.implement({ id: 'move/inc', implements: 'move', run: ({ s }) => ({ s: s.value + 1 }) });
  w.implement({ id: 'move/ten', implements: 'move', run: ({ s }) => ({ s: s.value + 10 }) });
  w.select('move', 'move/inc');
  w.contract({ id: 'turn', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'turn/1', implements: 'turn', uses: ['move'], run: ({ state }, ctx) => ({ state: ctx.call('move', { s: state }, { slot: ctx.tick() % 2 ? 'odd' : 'even' }).s }) });
  const d = w.drive('turn', { state: 0 }, { ticks: 4, fill: { 'move#odd': 'move/ten' } });
  assert.equal(d.final.state, 22, 'even ticks +1, odd ticks +10');
  assert.throws(() => w.drive('turn', { state: 0 }, { ticks: 1, fill: { 'move#odd': 'move/ten' } }), (e) => e.code === 'BAD_FILL', 'one tick never reaches odd and nothing declares it');
});

test('slots: select(contract, impl, slot) sets a per-slot default; slot fill > contract#* fill > slot select > contract fill > contract select (v0.5: specificity first)', () => {
  const w = seats();
  w.select('leaf', 'leaf/square', 'B');
  assert.equal(w.run('pair', { x: 3, which: 1 }).outputs.y, 9, 'slot select');
  assert.equal(w.run('pair', { x: 3, which: 0 }).outputs.y, 6, 'other slot keeps the contract select');
  assert.equal(w.run('pair', { x: 3, which: 1 }, { fill: { leaf: 'leaf/double' } }).outputs.y, 9, 'v0.5: the slot select beats a contract fill (v0.3/v0.4: the contract fill won)');
  assert.equal(w.run('pair', { x: 3, which: 1 }, { fill: { 'leaf#*': 'leaf/double' } }).outputs.y, 6, 'contract#* reaches every slot, over the slot select');
  assert.equal(w.run('pair', { x: 3, which: 1 }, { fill: { leaf: 'leaf/double', 'leaf#B': 'leaf/square' } }).outputs.y, 9, 'slot fill beats contract fill');
});

// ------------------------------------------------------------------ cached verdicts (B, C, E 118)
function audited() {
  const w = createWorld();
  w.contract({ id: 'pos', kind: 'check', in: { x: num }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'pos/1', implements: 'pos', run: ({ x }) => ({ accepted: x.value > 0, reason: `${x.value} ${x.value > 0 ? '>' : '<='} 0` }) });
  w.contract({ id: 'half', in: { x: num }, out: { y: num } });
  w.implement({ id: 'half/1', implements: 'half', uses: ['pos'], run: ({ x }, ctx) => { ctx.call('pos', { x }); return { y: x.value / 2 }; } });
  w.contract({ id: 'twice', in: { x: num }, out: { y: num } });
  w.implement({ id: 'twice/1', implements: 'twice', uses: ['half'], run: ({ x }, ctx) => ({ y: ctx.call('half', { x: ctx.call('half', { x }).y }).y }) });
  return w;
}

test('cached verdicts: a check inside a cache hit is still reported on the receipt, marked cached', () => {
  const w = audited();
  const first = w.run('twice', { x: 8 });
  assert.deepEqual(first.receipt.verdicts.map((v) => v.reason), ['8 > 0', '4 > 0']);
  const second = w.run('twice', { x: 8 });
  assert.equal(second.trace.cached, true);
  assert.deepEqual(second.receipt.verdicts.map((v) => [v.reason, v.cached]), [['8 > 0', true], ['4 > 0', true]]);
  assert.deepEqual(second.receipt.verdicts[0].cachedFrom, { run: first.receipt.runId, call: 1 });
});

test('world.node and world.ref address a recorded call and its output across runs', () => {
  const w = audited();
  const r = w.run('twice', { x: 8 });
  const n = w.node(r.receipt.runId, 2);
  assert.equal(n.contract, 'half');
  const ref = w.ref(r.receipt.runId, 2, 'y');
  assert.equal(ref.value, 4);
  const s = w.run('half', { x: ref });
  assert.deepEqual(s.trace.in.x.from, { kind: 'run', run: r.receipt.runId, from: { kind: 'call', call: 2, port: 'y' } });
  assert.equal(w.node(999, 1), null);
});

// ------------------------------------------------------------------ concat (C, D, E, F)
test('concat: elements keep a path back into the array they came from; composition {concat}', () => {
  const w = createWorld();
  w.contract({ id: 'two', in: { a: nums }, out: { b: nums } });
  w.implement({ id: 'two/1', implements: 'two', run: ({ a }) => ({ b: a.value.map((x) => x * 2) }) });
  w.contract({ id: 'both', in: { a: nums }, out: { all: nums } });
  w.compose({ id: 'both/c', implements: 'both', steps: [{ name: 'd', call: 'two', bind: { a: '$in.a' } }], returns: { all: { concat: ['$in.a', 'd.b'] } } });
  const r = w.run('both', { a: [1, 2] });
  assert.deepEqual(r.outputs.all, [1, 2, 2, 4]);
  const pieces = r.trace.out.all.from.pieces;
  assert.deepEqual(pieces.map((p) => [p.path[0], p.from.kind, p.from.path[0], p.from.of.kind]), [[0, 'at', 0, 'input'], [1, 'at', 1, 'input'], [2, 'at', 0, 'call'], [3, 'at', 1, 'call']]);
  w.contract({ id: 'mixed', in: { a: nums, n: num }, out: { all: nums } });
  assert.throws(() => w.compose({ id: 'mixed/bad', implements: 'mixed', steps: [], returns: { all: { concat: ['$in.a', '$in.n'] } } }), (e) => e.code === 'ASSEMBLY_LINT' && /concat\[1\] is not an array/.test(e.message));
});

// ------------------------------------------------------------------ ctx.drive (C, F)
test('ctx.drive: a tick folded inside a call; each tick is a child node with its own tick index; replay is exact', () => {
  const w = clockWorld();
  w.contract({ id: 'run3', in: { s: num }, out: { s: num } });
  w.implement({ id: 'run3/1', implements: 'run3', uses: ['clock'], run: ({ s }, ctx) => ({ s: ctx.drive('clock', { state: s }, { ticks: 3 }).state }) });
  const r = w.run('run3', { s: 0 });
  assert.equal(r.outputs.s, 102);
  assert.deepEqual(r.trace.calls.map((c) => [c.contract, c.tick]), [['clock', 0], ['clock', 1], ['clock', 2]]);
  assert.deepEqual(r.trace.calls.map((c) => c.calls[0].tick), [undefined, undefined, undefined], 'a grandchild inherits the tick, it does not restate it');
  assert.equal(w.replay(r.receipt).exact, true);
  const again = w.run('run3', { s: 0 });
  assert.equal(again.trace.cached, true, 'the tick reads stay inside the drive, so the outer call is cacheable');
});

test('ctx.drive: until stops early, and a non-tick target is refused', () => {
  const w = clockWorld();
  w.contract({ id: 'upTo', in: { s: num }, out: { s: num, n: int } });
  w.implement({ id: 'upTo/1', implements: 'upTo', uses: ['clock', 'stamp'], run: ({ s }, ctx) => {
    const d = ctx.drive('clock', { state: s }, { until: (o) => o.state >= 102 });
    return { s: d.state, n: d.ticks };
  } });
  assert.deepEqual(w.run('upTo', { s: 0 }).outputs, { s: 102, n: 3 });
  w.contract({ id: 'wrong', in: {}, out: { s: num } });
  w.implement({ id: 'wrong/1', implements: 'wrong', uses: ['stamp'], run: (_, ctx) => ({ s: ctx.drive('stamp', { x: 1 }, { ticks: 1 }).y }) });
  assert.throws(() => w.run('wrong', {}), (e) => e.code === 'NOT_A_TICK');
});

// ------------------------------------------------------------------ examples (B, C, E, F)
test('prove: examples may carry fill and ticks, and implementations may carry their own examples', () => {
  const w = clockWorld();
  w.contract({ id: 'clock2', kind: 'tick', in: { state: num }, out: { state: num }, examples: [{ in: { state: 0 }, ticks: 3, out: { state: 102 } }] });
  w.implement({ id: 'clock2/stamp', implements: 'clock2', uses: ['stamp'], run: (_, ctx) => ({ state: ctx.call('stamp', { x: 1 }).y }) });
  w.implement({ id: 'clock2/count', implements: 'clock2', run: ({ state }) => ({ state: state.value + 1 }),
    examples: [{ in: { state: 5 }, ticks: 2, out: { state: 7 } }] });
  const p = w.prove('clock2');
  assert.deepEqual(p.map((x) => [x.impl, x.example, x.ok]), [['clock2/stamp', 0, true], ['clock2/count', 0, false], ['clock2/count', 'impl:0', true]]);
  const s = seats();
  s.contract({ id: 'pairEx', in: { x: num }, out: { y: num }, examples: [{ in: { x: 3 }, out: { y: 9 }, fill: { 'leaf#A': 'leaf/square' } }] });
  s.implement({ id: 'pairEx/1', implements: 'pairEx', uses: ['leaf#A'], run: ({ x }, ctx) => ({ y: ctx.call('leaf', { x }, { slot: 'A' }).y }) });
  assert.equal(s.prove('pairEx')[0].ok, true, 'the example fills slot A');
});

// ------------------------------------------------------------------ branching (B, D, E)
function branchy() {
  const w = createWorld();
  w.contract({ id: 'isNeg', in: { x: num }, out: { yes: bool } });
  w.implement({ id: 'isNeg/1', implements: 'isNeg', run: ({ x }) => ({ yes: x.value < 0 }) });
  w.contract({ id: 'not', in: { b: bool }, out: { b: bool } });
  w.implement({ id: 'not/1', implements: 'not', run: ({ b }) => ({ b: !b.value }) });
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'abs', in: { x: num }, out: { y: num } });
  return w;
}
const absSteps = [
  { name: 'test', call: 'isNeg', bind: { x: '$in.x' } },
  { name: 'pos', call: 'not', bind: { b: 'test.yes' } },
  { name: 'flip', call: 'neg', when: 'test.yes', bind: { x: '$in.x' } },
  { name: 'keep', call: 'id', when: 'pos.b', bind: { x: '$in.x' } },
];

test('branching: both steps are declared, the one not taken is skipped, and the decision is recorded with its provenance', () => {
  const w = branchy();
  w.compose({ id: 'abs/c', implements: 'abs', steps: absSteps, returns: { y: { first: ['flip.y', 'keep.y'] } } });
  const a = w.run('abs', { x: -4 });
  assert.equal(a.outputs.y, 4);
  assert.deepEqual(a.trace.calls.map((c) => c.contract), ['isNeg', 'not', 'neg'], 'keep was skipped: no node');
  assert.deepEqual(a.trace.decisions.map((d) => [d.label, d.value, d.from.kind, d.from.call]), [['flip', true, 'call', 2], ['keep', false, 'call', 3]]);
  assert.deepEqual(a.trace.out.y.from, { kind: 'call', call: 4, port: 'y' });
  const b = w.run('abs', { x: 5 });
  assert.equal(b.outputs.y, 5);
  assert.deepEqual(b.trace.calls.map((c) => c.contract), ['isNeg', 'not', 'id']);
  assert.equal(w.replay(b.receipt).exact, true);
});

test('branching lint: a conditional output used outside first (or a step with the same when) fails assembly', () => {
  const w = branchy();
  assert.throws(() => w.compose({ id: 'abs/bad', implements: 'abs', steps: absSteps, returns: { y: 'flip.y' } }), (e) => e.code === 'ASSEMBLY_LINT' && /conditional step flip/.test(e.message));
  assert.throws(() => w.compose({ id: 'abs/bad2', implements: 'abs', steps: [absSteps[0], { ...absSteps[2], when: 'test.x' }], returns: { y: { first: ['flip.y', '$in.x'] } } }), (e) => e.code === 'ASSEMBLY_LINT');
  assert.throws(() => w.compose({ id: 'abs/bad3', implements: 'abs', steps: [absSteps[0], { name: 'w', call: 'neg', when: '$in.x', bind: { x: '$in.x' } }], returns: { y: { first: ['w.y', '$in.x'] } } }), (e) => e.code === 'ASSEMBLY_LINT' && /must be a boolean/.test(e.message));
});

test('branching: every alternative skipped is NO_BRANCH, with a failed receipt', () => {
  const w = branchy();
  w.compose({ id: 'abs/half', implements: 'abs', steps: [absSteps[0], absSteps[2]], returns: { y: { first: ['flip.y', 'flip.y'] } } });
  assert.throws(() => w.run('abs', { x: 2 }), (e) => e.code === 'NO_BRANCH' && e.receipt.status === 'failed');
});

test('ctx.when: an imperative branch records the decision on its node', () => {
  const w = branchy();
  w.implement({ id: 'abs/imp', implements: 'abs', uses: ['isNeg', 'neg'], run: ({ x }, ctx) => (ctx.when(ctx.call('isNeg', { x }).yes, 'negative?') ? { y: ctx.call('neg', { x }).y } : { y: x }) });
  const r = w.run('abs', { x: 7 });
  assert.deepEqual(r.trace.decisions, [{ label: 'negative?', value: false, from: { kind: 'call', call: 2, port: 'yes' } }]);
  assert.throws(() => { w.implement({ id: 'abs/num', implements: 'abs', run: ({ x }, ctx) => (ctx.when(x) ? { y: 1 } : { y: 0 }) }); w.run('abs', { x: 7 }, { fill: { abs: 'abs/num' } }); }, (e) => e.code === 'NOT_A_BOOLEAN');
});

// ------------------------------------------------------------------ check lint + failed verdicts (D, F)
test('check: a check step need not be consumed; a failed receipt keeps the verdicts that finished before the throw', () => {
  const w = audited();
  w.contract({ id: 'boom', in: { x: num }, out: { y: num } });
  w.implement({ id: 'boom/1', implements: 'boom', run: () => { throw new Error('nope'); } });
  w.contract({ id: 'flow', in: { x: num }, out: { y: num } });
  w.compose({ id: 'flow/c', implements: 'flow', steps: [
    { name: 'audit', call: 'pos', bind: { x: '$in.x' } },
    { name: 'b', call: 'boom', bind: { x: '$in.x' } },
  ], returns: { y: 'b.y' } });
  assert.throws(() => w.run('flow', { x: 3 }), (e) => e.receipt.status === 'failed' && e.receipt.verdicts.length === 1 && e.receipt.verdicts[0].reason === '3 > 0');
});

// ------------------------------------------------------------------ replay maxCalls (E)
test('replay: maxCalls lifts the call limit for a replay of a cache-heavy run', () => {
  const w = createWorld({ limits: { maxCalls: 50 } });
  w.contract({ id: 'fib', in: { n: int }, out: { v: int } });
  w.implement({ id: 'fib/1', implements: 'fib', uses: ['fib'], run: ({ n }, ctx) => ({ v: n.value < 2 ? n.value : ctx.call('fib', { n: n.value - 1 }).v.value + ctx.call('fib', { n: n.value - 2 }).v.value }) });
  const r = w.run('fib', { n: 12 });
  assert.equal(r.outputs.v, 144);
  assert.throws(() => w.replay(r.receipt), (e) => e.code === 'CALL_LIMIT');
  assert.equal(w.replay(r.receipt, { maxCalls: 1000 }).exact, true);
});

// ------------------------------------------------------------------ fault
test('ctx.fault: a named failure with a code, recorded on the node', () => {
  const w = createWorld();
  w.contract({ id: 'f', in: {}, out: { y: num } });
  w.implement({ id: 'f/1', implements: 'f', run: (_, ctx) => ctx.fault('not today', 'CLOSED') });
  assert.throws(() => w.run('f', {}), (e) => e.code === 'CLOSED' && e.trace.error.code === 'CLOSED' && e.receipt.error.code === 'CLOSED');
});
