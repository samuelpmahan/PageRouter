import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg } from '../src/view.mjs';
import { register, registerAudit, registerFaults, bitsOf, intOf, driveCounter, driveFlop, driveLatch } from '../contest/b-circuits/index.mjs';
import { adderCircuitSvg, counterTimelineSvg, latchStripSvg, inflate, countNodes, countContract } from '../contest/b-circuits/view.mjs';

const fresh = () => { const w = createWorld({ name: 'b' }); register(w); return w; };
const freshAll = () => { const w = fresh(); registerAudit(w); registerFaults(w); return w; };
const leaves = (node) => (node.calls.length === 0 ? [node.contract] : node.calls.flatMap(leaves));
const walk = (node, f) => { f(node); node.calls.forEach((c) => walk(c, f)); };

test('every contract example proves against every implementation', () => {
  const w = fresh();
  const proofs = w.contracts().flatMap((c) => w.prove(c.id));
  assert.deepEqual(proofs.filter((p) => !p.ok), []);
  assert.ok(proofs.some((p) => p.impl === 'adder.ripple4/loop') && proofs.some((p) => p.impl === 'adder.ripple4/composed'));
  assert.ok(w.contracts().every((c) => c.examples.length > 0), 'every contract has an example');
});

// Truth tables written out by hand (rows are inputs in binary counting order), not produced by running anything.
const TABLES = {
  'gate.not': { ports: ['a'], rows: [[0, 1], [1, 0]] },
  'gate.nand': { ports: ['a', 'b'], rows: [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]] },
  'gate.and': { ports: ['a', 'b'], rows: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]] },
  'gate.or': { ports: ['a', 'b'], rows: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]] },
  'gate.xor': { ports: ['a', 'b'], rows: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]] },
  // a, b, select -> q  (select b when select = 1, else a)
  'gate.mux': { ports: ['a', 'b', 'select'], rows: [[0, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 1], [1, 1, 0, 1], [0, 0, 1, 0], [0, 1, 1, 1], [1, 0, 1, 0], [1, 1, 1, 1]] },
};
const OUT_PORTS = { 'adder.half': ['sum', 'carry'], 'adder.full': ['sum', 'carry'] };
const ADDERS = {
  'adder.half': { ports: ['a', 'b'], rows: [[0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1]] },
  'adder.full': { ports: ['a', 'b', 'cin'], rows: [[0, 0, 0, 0, 0], [0, 0, 1, 1, 0], [0, 1, 0, 1, 0], [0, 1, 1, 0, 1], [1, 0, 0, 1, 0], [1, 0, 1, 0, 1], [1, 1, 0, 0, 1], [1, 1, 1, 1, 1]] },
};

for (const cache of [true, false]) {
  test(`gates match their hand-written truth tables exhaustively (cache ${cache ? 'on' : 'off'})`, () => {
    const w = fresh();
    for (const [id, { ports, rows }] of Object.entries(TABLES)) {
      assert.equal(rows.length, 2 ** ports.length, `${id} table is complete`);
      for (const row of rows) {
        const input = Object.fromEntries(ports.map((p, i) => [p, row[i]]));
        assert.equal(w.run(id, input, { cache }).outputs.q, row[ports.length], `${id} ${JSON.stringify(input)}`);
      }
    }
    for (const [id, { ports, rows }] of Object.entries(ADDERS)) {
      assert.equal(rows.length, 2 ** ports.length);
      for (const row of rows) {
        const input = Object.fromEntries(ports.map((p, i) => [p, row[i]]));
        const o = w.run(id, input, { cache }).outputs;
        assert.deepEqual([o.sum, o.carry], [row[ports.length], row[ports.length + 1]], `${id} ${JSON.stringify(input)}`);
        // independent definition: a + b + cin = sum + 2 * carry
        assert.equal(row.slice(0, ports.length).reduce((s, x) => s + x, 0), o.sum + 2 * o.carry);
      }
    }
  });
}

test('everything above NAND is NAND-only: leaves are gate.nand, with the expected gate counts', () => {
  const w = fresh();
  const gateCounts = { 'gate.not': 1, 'gate.and': 2, 'gate.or': 3, 'gate.xor': 4, 'gate.mux': 4, 'adder.half': 6, 'adder.full': 15 };
  const inputs = { 'gate.not': { a: 1 }, 'gate.and': { a: 1, b: 1 }, 'gate.or': { a: 0, b: 1 }, 'gate.xor': { a: 1, b: 0 }, 'gate.mux': { a: 1, b: 0, select: 1 }, 'adder.half': { a: 1, b: 1 }, 'adder.full': { a: 1, b: 1, cin: 1 } };
  for (const [id, count] of Object.entries(gateCounts)) {
    const t = w.run(id, inputs[id], { cache: false }).trace;
    assert.deepEqual([...new Set(leaves(t))], ['gate.nand'], `${id} bottoms out in NAND only`);
    assert.equal(countContract(t, 'gate.nand'), count, `${id} uses ${count} NANDs`);
  }
  const adder = w.run('adder.ripple4', { a: bitsOf(1), b: bitsOf(2), cin: 0 }, { cache: false }).trace;
  assert.equal(countContract(adder, 'gate.nand'), 60);
  // every implementation except NAND, the ripple loop, the ctx.when mux and the ctx.drive counter is a composition
  // (data with assembly); bits.pack4 is gone (gather); counter.run/loop is gone (ctx.drive); bit.test is gone (conditions are relations)
  const imperative = w.implementations().filter((i) => !i.assembly).map((i) => i.id).sort();
  assert.deepEqual(imperative, ['adder.ripple4/loop', 'counter.run/drive', 'gate.mux/ctx-when', 'gate.nand/js']);
  const nand = w.implementations().find((i) => i.id === 'gate.nand/js');
  assert.deepEqual(nand.uses, []);
  assert.equal(w.implementationsOf('gate.nand').length, 1);
});

test('the four-NAND XOR has exactly the documented wiring (n2 and n3 both read n1)', () => {
  const w = fresh();
  const t = w.run('gate.xor', { a: 1, b: 1 }, { cache: false }).trace;
  const [n1, n2, n3, n4] = t.calls;
  assert.equal(t.calls.length, 4);
  assert.deepEqual(n2.in.b.from, { kind: 'call', call: n1.id, port: 'q' });
  assert.deepEqual(n3.in.b.from, { kind: 'call', call: n1.id, port: 'q' });
  assert.deepEqual(n4.in.a.from, { kind: 'call', call: n2.id, port: 'q' });
  assert.deepEqual(n4.in.b.from, { kind: 'call', call: n3.id, port: 'q' });
  assert.deepEqual(n2.in.a.from, { kind: 'input', call: t.id, port: 'a' });
  assert.deepEqual(n3.in.a.from, { kind: 'input', call: t.id, port: 'b' });
});

test('F7: the cache merges identical gates: cold XOR(1,1) is four gates but only two computations', () => {
  const w = fresh();
  const t = w.run('gate.xor', { a: 1, b: 1 }).trace;
  assert.deepEqual(t.calls.map((c) => [c.contract, c.cached]), [['gate.nand', false], ['gate.nand', false], ['gate.nand', true], ['gate.nand', true]]);
  assert.equal(t.calls[2].cachedFrom.call, t.calls[1].id, 'n3 = NAND(1,0) repeats n2');
  assert.equal(t.calls[3].cachedFrom.call, t.calls[0].id, 'n4 = NAND(1,1) repeats n1');
  assert.equal(w.stats().cacheMisses, 1 + 2 + 0, 'xor call itself + two distinct nands');
  // a composite that repeats hides its whole subtree: the second half adder with identical inputs has no children
  const fa = w.run('adder.full', { a: 1, b: 1, cin: 0 }).trace;
  assert.equal(fa.calls[0].contract, 'adder.half');
  const again = w.run('adder.half', { a: 1, b: 1 }).trace;
  assert.equal(again.cached, true);
  assert.equal(again.calls.length, 0, 'a cached composition shows no gates at all');
});

test('4-bit ripple adder equals integer addition for all 512 inputs (both implementations, cache on and off)', () => {
  const w = fresh();
  let checked = 0;
  for (const [impl, cache] of [['adder.ripple4/composed', true], ['adder.ripple4/loop', true], ['adder.ripple4/composed', false]]) {
    for (let a = 0; a < 16; a += 1) for (let b = 0; b < 16; b += 1) for (let cin = 0; cin < 2; cin += 1) {
      const o = w.run('adder.ripple4', { a: bitsOf(a), b: bitsOf(b), cin }, { cache, fill: { 'adder.ripple4': impl } }).outputs;
      const total = a + b + cin; // the independent definition
      assert.equal(intOf(o.sum), total % 16, `${a}+${b}+${cin} sum (${impl})`);
      assert.equal(o.cout, total >= 16 ? 1 : 0, `${a}+${b}+${cin} cout (${impl})`);
      checked += 1;
    }
  }
  assert.equal(checked, 3 * 512);
});

test('11 + 6 with carry-in 0: per-bit values and exact per-bit wiring in the trace', () => {
  const w = fresh();
  const r = w.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false });
  assert.deepEqual(bitsOf(11), [1, 1, 0, 1]);
  assert.deepEqual(r.outputs, { sum: [1, 0, 0, 0], cout: 1 }); // 17 = 1 0001
  const fas = r.trace.calls.filter((c) => c.contract === 'adder.full');
  assert.equal(fas.length, 4);
  const get = (ref) => w.part(ref.hash);
  // hand-worked: bit0 1+0+0 -> s1 c0 ; bit1 1+1+0 -> s0 c1 ; bit2 0+1+1 -> s0 c1 ; bit3 1+0+1 -> s0 c1
  assert.deepEqual(fas.map((f) => [get(f.in.a), get(f.in.b), get(f.in.cin), get(f.out.sum), get(f.out.carry)]),
    [[1, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 1, 0, 1], [1, 0, 1, 0, 1]]);
  fas.forEach((f, i) => {
    assert.deepEqual(f.in.a.from, { kind: 'at', of: { kind: 'input', call: r.trace.id, port: 'a' }, path: [i] });
    assert.deepEqual(f.in.b.from, { kind: 'at', of: { kind: 'input', call: r.trace.id, port: 'b' }, path: [i] });
    assert.deepEqual(f.in.cin.from, i === 0 ? { kind: 'input', call: r.trace.id, port: 'cin' } : { kind: 'call', call: fas[i - 1].id, port: 'carry' });
  });
  // round 2: no packing contract; the sum output is a gather whose pieces are the four full adders' sum ports
  assert.equal(r.trace.calls.some((c) => c.contract === 'bits.pack4'), false);
  assert.equal(r.trace.calls.length, 4, 'exactly the four full adders, nothing else');
  assert.deepEqual(r.trace.out.cout.from, { kind: 'call', call: fas[3].id, port: 'carry' });
  assert.deepEqual(r.trace.out.sum.from, { kind: 'gather', pieces: fas.map((f, i) => ({ path: [i], from: { kind: 'call', call: f.id, port: 'sum' } })) });
  assert.deepEqual(fas.map((f) => f.slot), ['bit0', 'bit1', 'bit2', 'bit3']);
});

test('F5 resolved: the imperative adder and the composed adder now record the same wiring, including the sum gather', () => {
  const w = fresh();
  const comp = w.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false }).trace;
  const loop = w.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: { 'adder.ripple4': 'adder.ripple4/loop' } }).trace;
  const fa = (t) => t.calls.filter((c) => c.contract === 'adder.full').map((c) => [c.slot, c.in.a.from.path, c.in.b.from.path, c.in.cin.from.kind]);
  assert.deepEqual(fa(loop), fa(comp));
  const pieces = (t) => t.out.sum.from.pieces.map((p) => [p.path, p.from.kind, p.from.port]);
  assert.equal(loop.out.sum.from.kind, 'gather');
  assert.deepEqual(pieces(loop), pieces(comp));
  assert.equal(loop.calls.length, comp.calls.length);
});

test('dff as a tick contract: holds without an edge, samples with one; world.drive over a (d, clk) schedule', () => {
  const w = fresh();
  // schedule rows are (d, clk); worked by hand from "q takes d only when clk = 1": 0, 1, 1, 0, 1
  const d = driveFlop(w, [[1, 0], [1, 1], [0, 0], [0, 1], [1, 1]], 0);
  assert.deepEqual(d.receipts.map((r) => w.part(r.outputs.state)), [0, 1, 1, 0, 1]);
  assert.deepEqual(d.receipts.map((r) => r.tick), [0, 1, 2, 3, 4]);
  assert.equal(d.receipts[3].trace.in.state.from.kind, 'run');
  assert.equal(d.receipts[3].trace.in.state.from.run, d.receipts[2].runId);
});

test('F1 partly resolved: zero-delay feedback inside a tick is still rejected by assembly lint', () => {
  const w = fresh();
  assert.throws(() => w.compose({ id: 'ff.dff/latch', implements: 'ff.dff',
    steps: [{ name: 'm', call: 'gate.mux', bind: { a: 'm.q', b: '$in.d', select: '$in.clk' } }], returns: { state: 'm.q' } }),
  (e) => e.code === 'ASSEMBLY_LINT' && /unknown or later step m/.test(e.message));
  assert.throws(() => w.compose({ id: 'latch.sr/zero-delay', implements: 'latch.sr',
    steps: [
      { name: 'q', call: 'gate.nand', bind: { a: '$in.s_n', b: 'qn.q' } },
      { name: 'qn', call: 'gate.nand', bind: { a: '$in.r_n', b: 'q.q' } },
    ], returns: { state: { gather: ['q.q', 'qn.q'] } } }), (e) => e.code === 'ASSEMBLY_LINT');
});

// Hand-derived (see FRICTION F1). Schedule rows are (s_n, r_n); state is [q, qn]; start [0, 1] (reset).
// schedule: hold, set, hold, hold, reset, hold, hold.
const SCHEDULE = [[1, 1], [0, 1], [1, 1], [1, 1], [1, 0], [1, 1], [1, 1]];
// Round 5: the two trajectories are no longer arrays kept here. They are `trajectory` examples on the implementations (index.mjs), so
// `prove` checks them; this file reads them back from the implementation and compares them with what world.drive records.
const trajectoryOf = (w, impl) => w.implementations().find((i) => i.id === impl).examples.find((e) => e.trajectory).trajectory.map((t) => t.state);

test('latch.sr: one contract, two timing models; the staggered one stores a bit, the lockstep one oscillates after Set', () => {
  const w = fresh();
  const STAGGERED = trajectoryOf(w, 'latch.sr/staggered');
  const LOCKSTEP = trajectoryOf(w, 'latch.sr/lockstep');
  assert.equal(STAGGERED.length, 7); assert.equal(LOCKSTEP.length, 7);
  const st = driveLatch(w, SCHEDULE, { impl: 'latch.sr/staggered' });
  assert.deepEqual(st.receipts.map((r) => w.part(r.outputs.state)), STAGGERED);
  const lo = driveLatch(w, SCHEDULE, { impl: 'latch.sr/lockstep' });
  assert.deepEqual(lo.receipts.map((r) => w.part(r.outputs.state)), LOCKSTEP);
  // the oscillation, as a property: after Set, two ticks of Hold flip [1,1] <-> [0,0]
  assert.deepEqual([LOCKSTEP[1], LOCKSTEP[2], LOCKSTEP[3]], [[1, 1], [0, 0], [1, 1]]);
  // default fill is the staggered one, and every tick's trace names the implementation of each gate slot
  const w3 = fresh();
  const dflt = driveLatch(w3, SCHEDULE);
  assert.deepEqual(dflt.receipts.map((r) => w3.part(r.outputs.state)), STAGGERED);
  assert.deepEqual(dflt.receipts[1].trace.calls.map((c) => `${c.contract}#${c.slot}`), ['gate.nand#q', 'gate.nand#qn']);
  // NAND-only: every leaf under a latch tick is a nand
  assert.deepEqual([...new Set(leaves(lo.receipts[1].trace))], ['gate.nand']);
});

test('latch.sr: the contract specifies only Hold; Set and Reset are implementation examples, one set per timing model (N4 resolved)', () => {
  const w = fresh();
  const proofs = w.prove('latch.sr');
  // 2 contract examples x 2 implementations, plus 5 lockstep and 4 staggered examples of their own (the last of each is the seven-tick trajectory, round 5)
  assert.equal(proofs.length, 4 + 5 + 4);
  assert.ok(proofs.every((p) => p.ok), JSON.stringify(proofs.filter((p) => !p.ok)));
  assert.deepEqual(proofs.filter((p) => String(p.example).startsWith('impl:')).map((p) => `${p.impl}:${p.example}`),
    ['latch.sr/lockstep:impl:0', 'latch.sr/lockstep:impl:1', 'latch.sr/lockstep:impl:2', 'latch.sr/lockstep:impl:3', 'latch.sr/staggered:impl:0', 'latch.sr/staggered:impl:1', 'latch.sr/staggered:impl:2']);
  // v0.6: the two trajectories are named examples, so the proof says what it is instead of `impl:4` / `impl:3`
  assert.deepEqual(proofs.filter((p) => /^hold, SET/.test(String(p.example))).map((p) => `${p.impl}: ${p.example}`),
    ['latch.sr/lockstep: hold, SET, hold, hold, RESET, hold, hold: after SET the outputs chase each other', 'latch.sr/staggered: hold, SET, hold, hold, RESET, hold, hold: the bit is stored, RESET passes through [1,1]']);
  // a wrong trajectory is caught by prove, tick by tick: swap in a latch whose second gate reads the other model's input and prove it
  const sick = fresh();
  sick.compose({ id: 'latch.sr/sick', implements: 'latch.sr',
    examples: [{ name: 'staggered trajectory on a lockstep wiring', in: { state: [0, 1], s_n: 1, r_n: 1 }, each: [[1, 1], [0, 1], [1, 1], [1, 1], [1, 0], [1, 1], [1, 1]].map(([s_n, r_n]) => ({ s_n, r_n })),
      trajectory: trajectoryOf(sick, 'latch.sr/staggered').map((state) => ({ state })) }],
    steps: [
      { name: 'g1', call: 'gate.nand', slot: 'q', bind: { a: '$in.s_n', b: { at: ['$in.state', 1] } } },
      { name: 'g2', call: 'gate.nand', slot: 'qn', bind: { a: '$in.r_n', b: { at: ['$in.state', 0] } } },
    ],
    returns: { state: { gather: ['g1.q', 'g2.q'] } } });
  const bad = sick.prove('latch.sr', 'latch.sr/sick').find((p) => p.example === 'staggered trajectory on a lockstep wiring');
  assert.equal(bad.ok, false, 'the lockstep wiring does not meet the staggered trajectory');
  assert.match(bad.detail, /tick 1: expected \{"state":\[1,0\]\} got \{"state":\[1,1\]\} \(inputs \{"r_n":1,"s_n":0\}\); tick 2:/, 'the proof lists each wrong tick, first the SET at tick 1, and since v0.6 ends each with that tick\'s inputs');
  // Set from a reset latch gives different next states, which is why no CONTRACT example can mention it
  const setFrom = (impl) => w.run('latch.sr', { state: [0, 1], s_n: 0, r_n: 1 }, { cache: false, fill: { 'latch.sr': impl } }).outputs.state;
  assert.deepEqual(setFrom('latch.sr/staggered'), [1, 0]);
  assert.deepEqual(setFrom('latch.sr/lockstep'), [1, 1]);
  // an implementation example binds only its own implementation: lockstep's first example, run on the staggered one, gives another answer
  const lock0 = w.implementations().find((i) => i.id === 'latch.sr/lockstep').examples[0];
  assert.deepEqual(lock0.out.state, [1, 1]);
  assert.notDeepEqual(w.drive('latch.sr', lock0.in, { ticks: lock0.ticks, fill: { 'latch.sr': 'latch.sr/staggered' } }).final.state, lock0.out.state);
});

test('inputs that are not bits are refused at the contract boundary', () => {
  const w = fresh();
  assert.throws(() => w.run('gate.nand', { a: 2, b: 1 }), (e) => e.code === 'INPUT_SCHEMA');
  assert.throws(() => w.run('adder.ripple4', { a: [1, 0, 1], b: bitsOf(1), cin: 0 }), (e) => e.code === 'INPUT_SCHEMA');
});

test('counter.tick: counts, wraps at 16, and holds without a clock edge', () => {
  const w = fresh();
  for (let n = 0; n < 16; n += 1) {
    assert.equal(intOf(w.run('counter.tick', { state: bitsOf(n), clk: 1 }).outputs.state), (n + 1) % 16, `step from ${n}`);
    assert.equal(intOf(w.run('counter.tick', { state: bitsOf(n), clk: 0 }).outputs.state), n, `hold at ${n}`);
  }
  // the dropped carry-out is the wraparound: 15 + 1 leaves the adder with cout = 1 and nothing consumes it
  const t = w.run('counter.tick', { state: bitsOf(15), clk: 1 }, { cache: false }).trace;
  const adder = t.calls.find((c) => c.contract === 'adder.ripple4');
  assert.equal(w.part(adder.out.cout.hash), 1);
  walk(t, (n) => Object.values(n.in).forEach((i) => { assert.ok(!(i.from.kind === 'call' && i.from.call === adder.id && i.from.port === 'cout')); }));
  assert.equal(w.stats().cacheRejectedByDeps, 0);
});

test('world.drive: counter.tick over 20 ticks gives 1..15, 0, 1..4 with the tick index on every receipt', () => {
  const w = fresh();
  const d = driveCounter(w, 20, { cache: false });
  assert.equal(d.ticks, 20);
  assert.deepEqual(d.receipts.map((r) => intOf(w.part(r.outputs.state))), Array.from({ length: 20 }, (_, k) => (k + 1) % 16));
  assert.deepEqual(d.receipts.map((r) => r.tick), Array.from({ length: 20 }, (_, k) => k));
  assert.deepEqual(d.receipts[0].trace.in.state.from, { kind: 'input', call: 0, port: 'state' });
  d.receipts.slice(1).forEach((r, k) => assert.deepEqual(r.trace.in.state.from, { kind: 'run', run: d.receipts[k].runId, from: { kind: 'call', call: 1, port: 'state' } }));
  assert.deepEqual(w.part(d.state.hash), bitsOf(4));
  // one flip-flop per bit in every tick, slot-named, wired per bit
  const step = d.receipts[9].trace;
  const ffs = step.calls.filter((c) => c.contract === 'ff.dff');
  assert.deepEqual(ffs.map((c) => c.slot), ['bit0', 'bit1', 'bit2', 'bit3']);
  ffs.forEach((f, i) => {
    assert.deepEqual(f.in.d.from.path, [i]); assert.equal(f.in.d.from.of.kind, 'call');
    assert.deepEqual(f.in.state.from, { kind: 'at', of: { kind: 'input', call: step.id, port: 'state' }, path: [i] });
  });
});

test('counter.run (ctx.drive inside one run) and world.drive agree on every state; the ticks are @k children, and the call around the drive is cacheable', () => {
  const w = fresh();
  const run = w.run('counter.run', { initial: bitsOf(0), ticks: 20 });
  const d = driveCounter(w, 20);
  assert.deepEqual(run.outputs.states.slice(1), d.receipts.map((r) => w.part(r.outputs.state)));
  assert.deepEqual(run.outputs.final, w.part(d.state.hash));
  // twenty sibling counter.tick children, each tagged with its tick, chained by call edges; the clock is a literal
  assert.deepEqual(run.trace.calls.map((c) => [c.contract, c.tick]), Array.from({ length: 20 }, (_, k) => ['counter.tick', k]));
  run.trace.calls.slice(1).forEach((c, i) => assert.deepEqual(c.in.state.from, { kind: 'call', call: run.trace.calls[i].id, port: 'state' }));
  assert.deepEqual(run.trace.calls[0].in.state.from, { kind: 'input', call: run.trace.id, port: 'initial' });
  assert.deepEqual(run.trace.calls[0].in.clk.from, { kind: 'literal' });
  // v0.4: `collect: ['state']` hands back one gathered Ref; concat([initial], collected) keeps the initial state and points the rest at the ticks
  const pieces = run.trace.out.states.from.pieces;
  assert.equal(pieces.length, 21);
  assert.deepEqual(pieces[0].from, { kind: 'input', call: run.trace.id, port: 'initial' });
  pieces.slice(1).forEach((pc, k) => {
    assert.equal(pc.from.kind, 'at');
    assert.deepEqual(pc.from.of.pieces[k].from, { kind: 'call', call: run.trace.calls[k].id, port: 'state' }, `states[${k + 1}] is tick ${k}'s state`);
  });
  assert.deepEqual(run.trace.drives.map((d) => [d.contract, d.startTick, d.ticks, d.stopped]), [['counter.tick', 0, 20, 'ticks']]);
  // zero ticks: ctx.drive returns the input state itself, so there is no special case in the implementation
  const zero = w.run('counter.run', { initial: bitsOf(9), ticks: 0 });
  assert.deepEqual(zero.outputs, { final: bitsOf(9), states: [bitsOf(9)] });
  assert.deepEqual(zero.trace.drives.map((d) => [d.ticks, d.stopped]), [[0, 'ticks']]);
  // the second identical run is one cache hit at the root: the drive's tick reads stayed inside the drive
  const again = w.run('counter.run', { initial: bitsOf(0), ticks: 20 });
  assert.equal(again.trace.cached, true);
  assert.equal(w.replay(run.receipt, { maxCalls: 10_000 }).exact, true);
});

test('F2 resolved in part: a tick has a number and a run edge; tick 16 is still a cache hit on tick 0 and the receipt says so', () => {
  const w = fresh();
  const d = driveCounter(w, 20);
  // tick k starts from state k mod 16, so ticks 16..19 repeat the inputs of ticks 0..3
  assert.deepEqual(d.receipts.map((r) => r.trace.cached), d.receipts.map((_, k) => k >= 16));
  d.receipts.slice(16).forEach((r, j) => {
    assert.equal(r.tick, 16 + j);
    assert.equal(r.trace.in.state.hash, d.receipts[j].trace.in.state.hash);
    assert.deepEqual(r.trace.cachedFrom, { run: d.receipts[j].runId, call: 1 });
    assert.equal(r.trace.calls.length, 0, 'a cached tick still shows no gates');
    assert.deepEqual(r.trace.in.state.from.kind, 'run', 'but its input still has a producer: the previous tick');
    assert.deepEqual(r.trace.out.state.from, { kind: 'cached' });
  });
  // replay recomputes (cache off) and finds the cached tick exact, with the full gate tree back
  const rep = w.replay(d.receipts[17]);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
  assert.equal(countNodes(rep.fresh.trace), 138);
  // v0.3, F7 resolved: the hardware behind a cache hit is addressable without cache:false and without replay
  const hit = d.receipts[17].trace;
  const original = w.node(hit.cachedFrom.run, hit.cachedFrom.call);
  assert.equal(original.cached, false);
  assert.equal(countNodes(original), 32, 'but tick 1 was itself computed with the cache on, so most of its gates are cache hits too');
  const whole = inflate(w, original); // follow every cachedFrom, recursively
  assert.equal(countNodes(whole), 138);
  assert.equal(countContract(whole, 'gate.nand'), 76);
  assert.ok(!JSON.stringify(whole).includes('"cached":true'));
  assert.deepEqual(w.node(hit.cachedFrom.run, hit.cachedFrom.call), d.receipts[1].trace, 'it is the very node tick 1 recorded');
  // and an output of an earlier tick can be handed to a new run by address; the run records the edge
  const ref = w.ref(d.receipts[7].runId, 1, 'state');
  assert.deepEqual(w.part(ref.hash), bitsOf(8));
  const onward = w.run('counter.tick', { state: ref, clk: 1 });
  assert.deepEqual(onward.trace.in.state.from, { kind: 'run', run: d.receipts[7].runId, from: { kind: 'call', call: 1, port: 'state' } });
  assert.equal(intOf(onward.outputs.state), 9);
});

test('F3 resolved: consecutive runs are linked by a run edge, not only by hash equality', () => {
  const w = fresh();
  const first = w.run('counter.run', { initial: bitsOf(0), ticks: 10 }, { cache: false });
  const second = w.run('counter.run', { initial: first.refs.final, ticks: 8 }, { cache: false });
  const whole = w.run('counter.run', { initial: bitsOf(0), ticks: 18 }, { cache: false });
  assert.deepEqual(second.outputs.final, whole.outputs.final);
  assert.deepEqual(second.trace.in.initial.from, { kind: 'run', run: first.receipt.runId, from: { kind: 'call', call: 1, port: 'final' } });
  // inside the second run the first step's input is an ordinary caller input
  assert.deepEqual(second.trace.calls[0].in.state.from, { kind: 'input', call: second.trace.id, port: 'initial' });
});

test('F4 resolved: any single tick replays alone, in a fresh world, and replay does not touch run history', () => {
  const w = fresh();
  const d = driveCounter(w, 18, { cache: false });
  // tick 7 takes state 7 to 8; replay it from its own receipt in a world that never ran ticks 0-6
  const w2 = fresh();
  const rec = d.receipts[7];
  assert.equal(intOf(w.part(rec.inputs.state)), 7);
  const rep = w2.replay(rec);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
  assert.equal(intOf(w2.part(rep.fresh.outputs.state)), 8);
  assert.equal(w2.runs().length, 0, 'replay in the second world left no run behind');
  const before = w.runs().length;
  assert.equal(w.replay(d.receipts[3]).exact, true);
  assert.equal(w.runs().length, before);
  // a whole-run receipt is replayable in a fresh world too (it carries inputValues)
  const whole = w.run('counter.run', { initial: bitsOf(0), ticks: 18 }, { cache: false });
  assert.equal(fresh().replay(whole.receipt).exact, true);
});

test('gated clock: each(k) supplies clk per tick; ticks with clk = 0 hold, and the hold ticks are cache hits on each other', () => {
  const w = fresh();
  const clock = (k) => (k % 3 === 2 ? 0 : 1); // edge, edge, no edge, repeat
  const d = driveCounter(w, 12, { clock });
  // hand-worked: counts +1, +1, +0 per group of three ticks, from 0
  assert.deepEqual(d.receipts.map((r) => intOf(w.part(r.outputs.state))), [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8]);
  assert.deepEqual(d.receipts.map((r) => r.inputValues.clk), [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]);
  // tick 2 (state 2, clk 0) is new; tick 5 (state 4, clk 0) is new too: held state differs, so no hit
  assert.deepEqual(d.receipts.map((r) => r.trace.cached), Array(12).fill(false));
});

test('world.drive startTick: a counter resumed from an earlier drive continues the clock, the receipts and the run edge instead of restarting at tick 0', () => {
  const w = fresh();
  const whole = driveCounter(fresh(), 20, { cache: false });
  const first = driveCounter(w, 10);
  const second = driveCounter(w, 10, { initial: first.state, startTick: 10 });
  assert.deepEqual(second.receipts.map((r) => r.tick), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.deepEqual([...first.receipts, ...second.receipts].map((r) => intOf(w.part(r.outputs.state))), whole.receipts.map((r, k) => (k + 1) % 16));
  // the first resumed tick's state input points at the last tick of the first drive
  assert.deepEqual(second.receipts[0].trace.in.state.from, { kind: 'run', run: first.receipts[9].runId, from: { kind: 'call', call: 1, port: 'state' } });
  // ticks 16..19 are hits on the first drive's ticks 0..3: the counter never reads the tick, so the restarted clock would not have mattered either
  assert.deepEqual(second.receipts.map((r) => r.trace.cached), [false, false, false, false, false, false, true, true, true, true]);
  assert.deepEqual(second.receipts.slice(6).map((r) => r.trace.cachedFrom.run), first.receipts.slice(0, 4).map((r) => r.runId));
  // a gated clock is given in absolute ticks: clock(k) sees 10..19
  const seen = []; driveCounter(fresh(), 4, { startTick: 10, clock: (k) => { seen.push(k); return 1; } });
  assert.deepEqual([...new Set(seen)], [10, 11, 12, 13]);
});

test('slots: a fault aimed at one full adder (adder.full#bit2) breaks the sum exactly where bit 2 would carry, and prove() shows what the fault is', () => {
  const w = freshAll();
  const fault = { 'adder.full#bit2': 'adder.full/carry-stuck-0' };
  // the real world is untouched
  assert.deepEqual(w.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false }).outputs, { sum: [1, 0, 0, 0], cout: 1 });
  let wrong = 0; let expectedWrong = 0;
  for (let a = 0; a < 16; a += 1) for (let b = 0; b < 16; b += 1) for (let cin = 0; cin < 2; cin += 1) {
    const o = w.run('adder.ripple4', { a: bitsOf(a), b: bitsOf(b), cin }, { fill: fault }).outputs;
    const total = a + b + cin;
    if (intOf(o.sum) + 16 * o.cout !== total) wrong += 1;
    // independent definition: the fault shows exactly when the carry out of bit 2 (low three bits sum >= 8) is 1
    if (((a & 7) + (b & 7) + cin) >= 8) expectedWrong += 1;
  }
  assert.equal(wrong, expectedWrong);
  assert.ok(wrong > 0 && wrong < 512);
  // the trace names the slot and the faulty implementation at exactly that call site
  const t = w.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: fault }).trace;
  assert.deepEqual(t.calls.map((c) => `${c.slot}:${c.impl}`), ['bit0:adder.full/two-half', 'bit1:adder.full/two-half', 'bit2:adder.full/carry-stuck-0', 'bit3:adder.full/two-half']);
  // prove() catches the same fault from the contract's own examples: the four rows whose carry is 1 fail
  const proofs = w.prove('adder.full', 'adder.full/carry-stuck-0');
  assert.deepEqual(proofs.filter((p) => !p.ok).map((p) => p.example), [3, 5, 6, 7]);
  // v0.3: the faulty implementation carries its own examples, which say what IT does; those pass
  assert.deepEqual(proofs.filter((p) => p.ok && String(p.example).startsWith('impl:')).map((p) => p.example), ['impl:0', 'impl:1']);
});

test('slots: a fill key naming a slot nobody declares (bit9, or the typo bti2) is BAD_FILL, where v0.2 ignored it silently', () => {
  const w = freshAll();
  const input = { a: bitsOf(11), b: bitsOf(6), cin: 0 };
  for (const key of ['adder.full#bit9', 'adder.full#bti2']) {
    assert.throws(() => w.run('adder.ripple4', input, { cache: false, fill: { [key]: 'adder.full/carry-stuck-0' } }),
      (e) => e.code === 'BAD_FILL' && e.message.includes(key) && e.receipt.status === 'failed', key);
  }
  // the failed run is on the record, and the correctly spelled key still injects the fault
  assert.equal(w.runs().filter((r) => r.status === 'failed').length, 2);
  assert.deepEqual(w.run('adder.ripple4', input, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } }).outputs, { sum: [1, 0, 0, 1], cout: 0 });
  // a declared slot is valid even where this run never reaches it (standing configuration): the typo check is by name, not by reach
  const unreached = w.run('gate.xor', { a: 1, b: 1 }, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } });
  assert.equal(unreached.outputs.q, 0);
  assert.ok(!unreached.trace.calls.some((c) => c.contract === 'adder.full'), 'accepted, applied nowhere, and nothing in the receipt says so');
  // allowUnusedFill is the explicit switch for a key nobody declared
  assert.doesNotThrow(() => w.run('adder.ripple4', input, { cache: false, fill: { 'adder.full#bit9': 'adder.full/carry-stuck-0' }, allowUnusedFill: true }));
  // the loop implementation declares bit0..bit3 in `uses`, and the ripple composition declares them through its steps
  const loop = w.implementations().find((i) => i.id === 'adder.ripple4/loop');
  assert.deepEqual(loop.slots['adder.full'], ['bit0', 'bit1', 'bit2', 'bit3']);
  assert.deepEqual(w.implementations().find((i) => i.id === 'adder.ripple4/composed').assembly.steps.map((st) => st.slot), ['bit0', 'bit1', 'bit2', 'bit3']);
});

test('slots: an implementation that declares adder.full#bit0..3 may not call any other slot (UNDECLARED_SLOT)', () => {
  const w = fresh();
  w.contract({ id: 'wide', in: { a: { type: 'array' } }, out: { q: { type: 'integer' } } });
  w.implement({ id: 'wide/1', implements: 'wide', uses: ['adder.full#bit0'], run: ({ a }, ctx) => ({ q: ctx.call('adder.full', { a: ctx.at(a, 0), b: 0, cin: 0 }, { slot: 'bit4' }).sum.value }) });
  assert.throws(() => w.run('wide', { a: bitsOf(1) }), (e) => e.code === 'UNDECLARED_SLOT' && /bit4/.test(e.message));
});
test('flat slot keys are still global: one key hits every call site with that name, in four ticks of counter.advance4 and in both nibbles of ripple8', () => {
  const w = freshAll();
  const fault = { 'adder.full#bit2': 'adder.full/carry-stuck-0' };
  const r = w.run('counter.advance4', { state: bitsOf(3) }, { cache: false, fill: fault });
  // round 6: the receipt counts the sites (fillReach), no walk over the trace; each id is a node chosen by that key
  const faulty = r.receipt.fillReach['adder.full#bit2'];
  assert.equal(faulty.length, 4, 'one flat key, four call sites in four different counter.tick calls');
  assert.ok(faulty.every((id) => w.node(r.receipt.runId, id).impl === 'adder.full/carry-stuck-0' && w.node(r.receipt.runId, id).chosenBy.rung === 'slot fill'));
  assert.equal(w.run('counter.advance4', { state: bitsOf(3) }, { cache: false }).outputs.state.join(), bitsOf(7).join());
  const both = w.run('adder.ripple8', { a: bitsOf(0, 8), b: bitsOf(0, 8), cin: 0 }, { cache: false, fill: fault });
  assert.equal(both.receipt.fillReach['adder.full#bit2'].length, 2, 'bit2 of the low nibble and bit2 of the high nibble: one flat key, two call sites');
});

test('path slots (v0.4): "adder.ripple4#hi/adder.full#bit2" reaches exactly one full adder, with no per-nibble copies of the implementation', () => {
  const w = freshAll();
  assert.equal(w.implementationsOf('adder.ripple4').length, 2, 'composed and loop: the lo-nibble and hi-nibble copies are gone');
  const hi = { 'adder.ripple4#hi/adder.full#bit2': 'adder.full/carry-stuck-0' }; // bit 6 of the 8-bit sum
  const lo = { 'adder.ripple4#lo/adder.full#bit2': 'adder.full/carry-stuck-0' }; // bit 2
  const sites = (fill, a, b) => {
    const r = w.run('adder.ripple8', { a: bitsOf(a, 8), b: bitsOf(b, 8), cin: 0 }, { cache: false, fill });
    const reach = Object.values(r.receipt.fillReach).flat();
    // each reached node says which rung chose it and by which key
    assert.ok(reach.every((id) => w.node(r.receipt.runId, id).chosenBy.rung === 'path fill'));
    return { hits: reach.map((id) => w.node(r.receipt.runId, id).slot), impls: r.trace.calls.map((c) => `${c.slot}:${c.impl}`) };
  };
  assert.deepEqual(sites(hi, 112, 16).hits, ['bit2'], 'one call site');
  assert.deepEqual(sites(hi, 112, 16).impls, ['lo:adder.ripple4/composed', 'hi:adder.ripple4/composed'], 'both nibbles are the same implementation');
  assert.deepEqual(sites(lo, 112, 16).hits, ['bit2'], 'and the other nibble has its own key');
  // wrong exactly where bit 6 (resp. bit 2) carries, counted on a 16 x 16 x 2 grid against independent arithmetic; cache ON, cold then warm
  for (const [fill, mask] of [[hi, 127], [lo, 7]]) {
    let wrong = 0; let expectedWrong = 0; let checked = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      wrong = 0; expectedWrong = 0; checked = 0;
      for (let a = 0; a < 256; a += 17) for (let b = 0; b < 256; b += 17) for (let cin = 0; cin < 2; cin += 1) {
        const o = w.run('adder.ripple8', { a: bitsOf(a, 8), b: bitsOf(b, 8), cin }, { fill }).outputs;
        if (intOf(o.sum) + 256 * o.cout !== a + b + cin) wrong += 1;
        if (((a & mask) + (b & mask) + cin) > mask) expectedWrong += 1;
        checked += 1;
      }
      assert.equal(wrong, expectedWrong, `pass ${pass}`);
    }
    assert.equal(checked, 16 * 16 * 2);
    assert.ok(wrong > 0 && wrong < checked);
  }
  // the cache does not carry a healthy entry into a faulty run, or the reverse
  const w2 = freshAll();
  const input = { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 };
  assert.deepEqual(w2.run('adder.ripple8', input).outputs.sum, bitsOf(128, 8));
  assert.deepEqual(w2.run('adder.ripple8', input, { fill: hi }).outputs.sum, bitsOf(0, 8));
  assert.deepEqual(w2.run('adder.ripple8', input).outputs.sum, bitsOf(128, 8));
  // typos in the path are BAD_FILL, like typos in a flat key
  assert.throws(() => w2.run('adder.ripple8', input, { fill: { 'adder.ripple4#hj/adder.full#bit2': 'adder.full/carry-stuck-0' } }), (e) => e.code === 'BAD_FILL' && /hj/.test(e.message));
  // the flat key stays valid and still reaches both
  assert.equal(w2.run('adder.ripple8', input, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } }).trace.calls.map((c) => c.calls.filter((g) => g.impl === 'adder.full/carry-stuck-0').length).join(), '1,1');
});

test('path slots in the counter: "counter.tick#t3/adder.full#bit2" faults one adder of one tick of counter.advance4; a drive cannot name a tick (documented friction)', () => {
  const w = freshAll();
  const sites = (fill) => {
    const r = w.run('counter.advance4', { state: bitsOf(3) }, { cache: false, fill });
    return { hits: Object.values(r.receipt.fillReach).flat(), state: intOf(r.outputs.state), trace: r.trace };
  };
  // 3 -> 4 -> 5 -> 6 -> 7. A stuck bit-2 carry matters only when the low three bits carry: tick t0 takes 3 to 4 (011 + 001 carries into bit 2)
  const one = sites({ 'counter.tick#t0/adder.full#bit2': 'adder.full/carry-stuck-0' });
  assert.equal(one.hits.length, 1);
  assert.deepEqual(one.trace.calls.map((c) => [c.slot, c.calls.some((g) => g.impl === 'adder.ripple4/composed')]), [['t0', true], ['t1', true], ['t2', true], ['t3', true]]);
  assert.equal(sites({ 'counter.tick#t3/adder.full#bit2': 'adder.full/carry-stuck-0' }).hits.length, 1);
  assert.equal(sites({ 'adder.full#bit2': 'adder.full/carry-stuck-0' }).hits.length, 4, 'the flat key is still all four');
  // the tick contract has no slot inside ctx.drive except the one `slot` option for the whole drive, and world.drive has none
  const d = w.drive('counter.tick', { state: bitsOf(3), clk: 1 }, { ticks: 4, fill: { 'counter.tick/adder.ripple4/adder.full#bit2': 'adder.full/carry-stuck-0' }, each: () => ({ clk: 1 }), cache: false });
  // v0.6: the per-tick receipts carry the reach accumulated so far, so the last one counts the whole drive (ids repeat: they are per run)
  const n = d.receipts.at(-1).fillReach['counter.tick/adder.ripple4/adder.full#bit2'].length;
  assert.equal(n, 4, 'a path through bare contracts reaches every tick: there is no way to say "tick 3" in a drive');
});

test('fills in v0.5: the receipt says which keys were consulted, a path fill must land (BAD_FILL where v0.4 shrugged), and contract#* reaches every seat of a contract', () => {
  const w = freshAll();
  const input = { a: bitsOf(11), b: bitsOf(6), cin: 0 };
  const stuck = 'adder.full/carry-stuck-0';
  // the receipt names the key the fault used: "did the fault land" is a check on the receipt, not a scan of the trace
  const hit = w.run('adder.ripple4', input, { cache: false, fill: { 'adder.full#bit2': stuck } });
  assert.deepEqual(hit.receipt.fillConsulted, ['adder.full#bit2']);
  const path8 = w.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { cache: false, fill: { 'adder.ripple4#hi/adder.full#bit2': stuck } });
  assert.deepEqual(path8.receipt.fillConsulted, ['adder.ripple4#hi/adder.full#bit2']);
  // a flat key that nothing reached is still standing configuration (accepted), and now the receipt says it was not used
  const idle = w.run('gate.xor', { a: 1, b: 1 }, { cache: false, fill: { 'adder.full#bit2': stuck } });
  assert.deepEqual(idle.receipt.fillConsulted, []);
  // a path to nowhere: declared chain names, but the 4-bit adder has no `hi` seat in this run; v0.4 accepted it, v0.5 refuses it
  assert.throws(() => w.run('adder.ripple4', input, { cache: false, fill: { 'adder.ripple4#hi/adder.full#bit2': stuck } }),
    (e) => e.code === 'BAD_FILL' && /adder\.ripple4#hi\/adder\.full#bit2/.test(e.message) && e.receipt.status === 'failed');
  // contract#*: one key for every seat of the contract; every full adder of the 4-bit adder drops its carry
  const everyTrace = w.run('adder.ripple4', input, { cache: false, fill: { 'adder.full#*': stuck } });
  assert.deepEqual(everyTrace.receipt.fillConsulted, ['adder.full#*']);
  assert.deepEqual(everyTrace.trace.calls.map((c) => `${c.slot}:${c.impl}`), ['bit0:adder.full/carry-stuck-0', 'bit1:adder.full/carry-stuck-0', 'bit2:adder.full/carry-stuck-0', 'bit3:adder.full/carry-stuck-0']);
  let checked = 0;
  for (let a = 0; a < 16; a += 1) for (let b = 0; b < 16; b += 1) for (let cin = 0; cin < 2; cin += 1) {
    const o = w.run('adder.ripple4', { a: bitsOf(a), b: bitsOf(b), cin }, { fill: { 'adder.full#*': stuck } }).outputs;
    // independent definition: with every carry stuck at 0, bit i is a_i xor b_i, and only bit 0 sees the real carry-in
    const expected = bitsOf(a).map((x, i) => x ^ bitsOf(b)[i] ^ (i === 0 ? cin : 0));
    assert.deepEqual([o.sum, o.cout], [expected, 0], `${a} + ${b} + ${cin}`);
    checked += 1;
  }
  assert.equal(checked, 512);
  // specificity: the path key beats the wildcard, so "everything stuck except bit 2 of the high nibble" is two keys, not a copy of an implementation
  const mixed = w.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { cache: false, fill: { 'adder.full#*': stuck, 'adder.ripple4#hi/adder.full#bit2': 'adder.full/two-half' } });
  const impl = (slot, nib) => mixed.trace.calls.find((c) => c.slot === nib).calls.find((c) => c.slot === slot).impl;
  assert.equal(impl('bit2', 'hi'), 'adder.full/two-half');
  assert.equal(impl('bit1', 'hi'), stuck);
  assert.equal(impl('bit2', 'lo'), stuck);
  assert.deepEqual([...mixed.receipt.fillConsulted].sort(), ['adder.full#*', 'adder.ripple4#hi/adder.full#bit2']);
  // v0.6: fillReach says which calls each key chose for, and every node says which rung chose it (N29 resolved)
  const reach = mixed.receipt.fillReach;
  assert.equal(reach['adder.full#*'].length, 7, 'the wildcard governs seven seats: every adder but the hi bit 2');
  assert.equal(reach['adder.ripple4#hi/adder.full#bit2'].length, 1, 'the path key governs one');
  assert.equal(new Set([...reach['adder.full#*'], ...reach['adder.ripple4#hi/adder.full#bit2']]).size, 8, 'no seat is counted twice');
  const node = (id) => w.node(mixed.receipt.runId, id);
  assert.deepEqual(reach['adder.ripple4#hi/adder.full#bit2'].map((id) => [node(id).slot, node(id).impl, node(id).chosenBy]), [['bit2', 'adder.full/two-half', { rung: 'path fill', key: 'adder.ripple4#hi/adder.full#bit2' }]]);
  assert.ok(reach['adder.full#*'].every((id) => node(id).chosenBy.rung === 'every-slot fill' && node(id).impl === stuck));
  // the seats nobody filled say so: the two nibbles are the declared default (select), and the root is the only implementation
  assert.deepEqual(mixed.trace.calls.map((c) => c.chosenBy.rung), ['contract select', 'contract select']);
  assert.deepEqual(mixed.trace.chosenBy, { rung: 'only implementation' });
  // a cache hit counts as its hit node: the same path fill, run again with the cache on, reaches the hit, not the nodes under it
  const wc = freshAll();
  const key = 'adder.ripple4#hi/adder.full#bit2';
  const cold = wc.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { fill: { [key]: stuck } });
  const warm = wc.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { fill: { [key]: stuck } });
  assert.equal(cold.receipt.fillReach[key].length, 1);
  assert.equal(warm.trace.cached, true);
  assert.deepEqual(warm.receipt.fillReach[key], [warm.trace.id], 'one hit, one id: the root');
  // landing (v0.6): the author names the game. 'all' makes the unreached flat key an error, 'none' lets a sweep miss; a typo fails in every mode
  const unreachedFill = { 'adder.full#bit2': stuck };
  assert.deepEqual(w.run('gate.xor', { a: 1, b: 1 }, { cache: false, fill: unreachedFill }).receipt.fillReach, { 'adder.full#bit2': [] }, 'default: standing configuration, reach is empty');
  assert.throws(() => w.run('gate.xor', { a: 1, b: 1 }, { cache: false, fill: unreachedFill, landing: 'all' }), (e) => e.code === 'BAD_FILL' && /adder\.full#bit2/.test(e.message) && /landing: 'all'/.test(e.message));
  const sweep = { 'adder.ripple4#hi/adder.full#bit2': stuck };
  assert.doesNotThrow(() => w.run('adder.ripple4', input, { cache: false, fill: sweep, landing: 'none' }), 'a sweep that reuses one table across 4-bit and 8-bit runs may miss');
  assert.throws(() => w.run('adder.ripple4', input, { cache: false, fill: sweep }), (e) => e.code === 'BAD_FILL', 'the default is still strict about a path');
  assert.throws(() => w.run('adder.ripple4', input, { cache: false, fill: { 'adder.full#bti2': stuck }, landing: 'none' }), (e) => e.code === 'BAD_FILL', 'a typo is a typo in every mode');
});

test('check kind: the audited adder needs no verdict ports (check steps are exempt from the unused-output lint); a fault turns the verdict red on receipt.verdicts', () => {
  const w = freshAll();
  const ok = w.run('adder.audited', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false });
  assert.deepEqual(ok.outputs, { sum: [1, 0, 0, 0], cout: 1 });
  assert.deepEqual(ok.receipt.verdicts.map((v) => [v.contract, v.accepted, v.reason]), [['check.adderSum', true, '11 + 6 + 0 = 17; circuit gives 17']]);
  const bad = w.run('adder.audited', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } });
  assert.deepEqual(bad.outputs, { sum: [1, 0, 0, 1], cout: 0 }); // the run still succeeded; the bad sum is 9 with cout 0
  assert.deepEqual(bad.receipt.verdicts.map((v) => [v.contract, v.accepted, v.reason]), [['check.adderSum', false, '11 + 6 + 0 = 17; circuit gives 9']]);
  assert.equal(bad.trace.calls[1].kind, 'check');
  assert.equal(bad.trace.calls[1].id, bad.receipt.verdicts[0].call);
  // exhaustive: the audit accepts all 512 real-circuit runs, and the second pass (all cache hits at the root) still reports its verdict, marked cached
  for (let a = 0; a < 16; a += 1) for (let b = 0; b < 16; b += 1) for (let cin = 0; cin < 2; cin += 1) {
    assert.deepEqual(w.run('adder.audited', { a: bitsOf(a), b: bitsOf(b), cin }).receipt.verdicts.map((v) => v.accepted), [true]);
  }
  const again = w.run('adder.audited', { a: bitsOf(11), b: bitsOf(6), cin: 0 });
  assert.equal(again.trace.cached, true);
  assert.deepEqual(again.receipt.verdicts.map((v) => [v.accepted, v.cached]), [[true, true]]);
});

test('a verdict can gate a result: a single-alternative first releases the sum for a healthy adder, and a rejected audit is NO_BRANCH', () => {
  const w = freshAll();
  const b4 = { type: 'array', minItems: 4, maxItems: 4, items: { type: 'integer', minimum: 0, maximum: 1 } };
  w.contract({ id: 'adder.released', in: { a: b4, b: b4, cin: { type: 'integer' } }, out: { sum: b4 } });
  w.contract({ id: 'wire.bits4', in: { s: b4 }, out: { s: b4 } });
  w.implement({ id: 'wire.bits4/js', implements: 'wire.bits4', run: ({ s }) => ({ s }) });
  // v0.3 refused this (`first` needed two alternatives, so 'release or refuse' was spelled with the same alternative twice); v0.4 accepts it
  w.compose({ id: 'adder.released/c', implements: 'adder.released', steps: [
    { name: 'add', call: 'adder.ripple4', bind: { a: '$in.a', b: '$in.b', cin: '$in.cin' } },
    { name: 'audit', call: 'check.adderSum', bind: { a: '$in.a', b: '$in.b', cin: '$in.cin', sum: 'add.sum', cout: 'add.cout' } },
    { name: 'release', call: 'wire.bits4', when: 'audit.accepted', bind: { s: 'add.sum' } },
  ], returns: { sum: { first: ['release.s'] } } });
  const input = { a: bitsOf(11), b: bitsOf(6), cin: 0 };
  const good = w.run('adder.released', input, { cache: false });
  assert.deepEqual(good.outputs.sum, [1, 0, 0, 0]);
  assert.deepEqual(good.trace.decisions.map((d) => [d.label, d.value, d.ran]), [['release', true, 'release']]);
  assert.throws(() => w.run('adder.released', input, { cache: false, fill: { 'adder.ripple4#x/adder.full#bit2': 'adder.full/carry-stuck-0' } }), (e) => e.code === 'BAD_FILL', 'a path through an undeclared slot is a typo');
  assert.throws(() => w.run('adder.released', input, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } }),
    (e) => e.code === 'NO_BRANCH' && e.receipt.status === 'failed' && e.receipt.verdicts.length === 1 && e.receipt.verdicts[0].accepted === false);
  // `wire.bits4` exists only because a conditional step has to call a contract: it is the one helper that stays (it is not a boolean helper)
});

test('counter.advance4: four ticks declared by composition; the tick count is fixed at assembly', () => {
  const w = fresh();
  const r = w.run('counter.advance4', { state: bitsOf(14) }, { cache: false });
  assert.equal(intOf(r.outputs.state), 2);
  const steps = r.trace.calls;
  assert.equal(steps.length, 4);
  steps.forEach((c, k) => { if (k > 0) assert.deepEqual(c.in.state.from, { kind: 'call', call: steps[k - 1].id, port: 'state' }); });
  assert.deepEqual(steps[0].in.clk.from, { kind: 'literal' });
  assert.ok(w.implementationsOf('counter.advance4')[0].assembly, 'wiring is data, inspectable before running');
});

test('F8: trace size is still 138 nodes per tick; maxDepth collapses it in the view', () => {
  const w = fresh();
  const off = w.run('counter.run', { initial: bitsOf(0), ticks: 20 }, { cache: false });
  const step = w.run('counter.tick', { state: bitsOf(1), clk: 1 }, { cache: false });
  assert.equal(countNodes(step.trace), 138);
  assert.equal(countNodes(off.trace), 2761);
  const collapsed = traceToSvg(off.trace, w.part, { maxDepth: 1 });
  assert.ok(collapsed.length < 60_000, 'maxDepth collapses without a helper');
  assert.equal((collapsed.match(/<g data-call="/g) ?? []).length, 21, 'the root and its twenty counter.tick children are the only boxes drawn');
  assert.equal((collapsed.match(/ @\d+/g) ?? []).length, 20, 'and each child carries its @k tick tag');
});

test('views render from runs: adder circuit flags a mis-wired trace in red; timeline and latch strip come from receipts', () => {
  const w = fresh();
  const r = w.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false });
  const svg = adderCircuitSvg(r.trace, w.part, { title: 't' });
  assert.equal((svg.match(/class="fa"/g) ?? []).length, 4);
  assert.ok(svg.includes('Wiring check passed') && !svg.includes('WIRING MISMATCH'));
  const lit = (svg.match(/data-value="1"/g) ?? []).length; const unlit = (svg.match(/data-value="0"/g) ?? []).length;
  assert.equal(lit + unlit, 17); // lamps: 4 a + 4 b + 4 sum + 5 carries
  const forged = structuredClone(r.trace);
  const fas = forged.calls.filter((c) => c.contract === 'adder.full');
  fas[2].in.cin.from = { kind: 'call', call: fas[0].id, port: 'carry' };
  assert.ok(adderCircuitSvg(forged, w.part).includes('WIRING MISMATCH in trace: FA2.cin'));
  const d = driveCounter(w, 20);
  const tl = counterTimelineSvg(d.receipts, w.part, { title: 't' });
  assert.equal((tl.match(/class="callcell"/g) ?? []).length, 20);
  assert.equal((tl.match(/data-cached="true"/g) ?? []).length, 4);
  assert.ok(tl.includes('wrap: 15 → 0 at tick 15'));
  const strip = latchStripSvg(driveLatch(w, SCHEDULE, { impl: 'latch.sr/lockstep' }).receipts, w.part, { title: 't' });
  assert.equal((strip.match(/class="equal"/g) ?? []).length, 3, 'q = qn in three columns: [1,1], [0,0], [1,1]');
});

test('K1 fixed: a nested fill is honoured and the stale cache entry is not served', () => {
  const w = fresh();
  const loop = { 'adder.ripple4': 'adder.ripple4/loop' };
  const first = w.run('counter.tick', { state: bitsOf(4), clk: 1 }, { fill: loop }).trace;
  assert.equal(first.calls[0].impl, 'adder.ripple4/loop');
  const second = w.run('counter.tick', { state: bitsOf(4), clk: 1 }, { fill: { 'adder.ripple4': 'adder.ripple4/composed' } }).trace;
  assert.equal(second.cached, false, 'the entry computed with the loop does not satisfy a request for the composed adder');
  assert.equal(second.calls[0].impl, 'adder.ripple4/composed');
  const again = w.run('counter.tick', { state: bitsOf(4), clk: 1 }, { fill: { 'adder.ripple4': 'adder.ripple4/composed' } }).trace;
  assert.equal(again.cached, true, 'and the composed entry is then reused for the composed fill');
});

test('ctx.tick() is a cache dependency (N1 fixed in v0.3): a tick-aware implementation reports each tick, replay agrees, and it is not impure', () => {
  const w = createWorld();
  const n = { type: 'integer' };
  w.contract({ id: 'clock.seen', kind: 'tick', in: { state: n }, out: { state: n, seen: n } });
  w.implement({ id: 'clock.seen/1', implements: 'clock.seen', run: ({ state }, ctx) => ({ state: state.value % 2, seen: ctx.tick() }) });
  const d = w.drive('clock.seen', { state: 0 }, { ticks: 4 });
  assert.deepEqual(d.receipts.map((r) => w.part(r.outputs.seen)), [0, 1, 2, 3], 'each tick reports its own tick');
  assert.deepEqual(d.receipts.map((r) => r.trace.cached), [false, false, false, false], 'the entry made at tick 0 is not served at tick 1..3');
  assert.deepEqual(d.receipts.map((r) => w.replay(r).exact), [true, true, true, true]);
  assert.notEqual(d.receipts[3].impure, true, 'a tick read is a dependency, not impurity');
  // the same drive again: every tick finds its own entry
  const again = w.drive('clock.seen', { state: 0 }, { ticks: 4 });
  assert.deepEqual(again.receipts.map((r) => r.trace.cached), [true, true, true, true]);
  assert.deepEqual(again.receipts.map((r) => w.part(r.outputs.seen)), [0, 1, 2, 3]);
  // and in my domain: the counter never reads the tick, so its ticks 16..19 are still cache hits on ticks 0..3 (the dependency costs nothing here)
  const c = createWorld(); register(c);
  assert.deepEqual(driveCounter(c, 20).receipts.map((r) => r.trace.cached).slice(14), [false, false, true, true, true, true]);
});

test('the two behavioural multiplexers read the wire directly, and the branch mux derives its complement with else (round 5): same truth table as the NAND mux, 2 NANDs instead of 4', () => {
  const w = fresh();
  assert.equal(w.contracts().some((c) => c.id === 'bit.test'), false, 'no helper contract that only emits a boolean');
  const rows = TABLES['gate.mux'].rows;
  for (const impl of ['gate.mux/nand', 'gate.mux/branch', 'gate.mux/ctx-when']) {
    for (const row of rows) {
      const input = { a: row[0], b: row[1], select: row[2] };
      assert.equal(w.run('gate.mux', input, { cache: false, fill: { 'gate.mux': impl } }).outputs.q, row[3], `${impl} ${JSON.stringify(input)}`);
    }
  }
  const run = (impl) => w.run('gate.mux', { a: 1, b: 0, select: 1 }, { cache: false, fill: { 'gate.mux': impl } }).trace;
  const nand = run('gate.mux/nand'); const branch = run('gate.mux/branch'); const imp = run('gate.mux/ctx-when');
  assert.deepEqual([countContract(nand, 'gate.nand'), countContract(branch, 'gate.nand'), countContract(imp, 'gate.nand')], [4, 2, 2]);
  assert.deepEqual([...new Set(leaves(branch))], ['gate.nand'], 'below the decision there is only NAND, and no boundary contract');
  // the composition declares both buffers and names the one that did not run; its decisions carry the relation, not a helper's output
  assert.deepEqual(branch.calls.map((c) => c.contract), ['gate.buf']);
  assert.equal(countNodes(branch), 6);
  const sel = { kind: 'input', call: branch.id, port: 'select' };
  assert.deepEqual(branch.decisions.map((d) => [d.label, d.value, d.ran ?? d.skipped]), [['takeB', true, 'takeB'], ['takeA', false, 'takeA']]);
  // round 5 (else): takeA's condition is not typed any more; it is derived as "takeB was skipped", and its provenance names takeB and what decided it
  const takeBTest = { kind: 'test', op: 'eq', args: [sel, { kind: 'literal', value: 1 }] };
  assert.deepEqual(branch.decisions.map((d) => d.from), [takeBTest, { kind: 'test', op: 'else', steps: ['takeB'], args: [takeBTest] }]);
  assert.equal(JSON.stringify(w.implementations().find((i) => i.id === 'gate.mux/branch').assembly).includes('"eq":["$in.select",0]'), false, 'no typed complement (select = 0) in the shipped mux');
  // the derived complement follows the true condition for both bit values, with no second relation to keep in step
  const at0 = w.run('gate.mux', { a: 1, b: 0, select: 0 }, { cache: false, fill: { 'gate.mux': 'gate.mux/branch' } }).trace;
  assert.deepEqual(at0.decisions.map((d) => [d.label, d.value]), [['takeB', false], ['takeA', true]]);
  // the imperative twin now names both branches too (N14): ctx.when(cond, label, { true, false })
  assert.deepEqual(imp.decisions, [{ label: 'select = 1?', value: true, from: { kind: 'test', op: 'eq', args: [sel, { kind: 'literal', value: 1 }] }, ran: 'takeB', skipped: 'takeA' }]);
  assert.deepEqual(imp.calls.map((c) => c.contract), ['gate.buf']);
  // the output is the taken branch, and the skipped one leaves no node and no edge
  assert.deepEqual(branch.out.q.from, { kind: 'call', call: branch.calls[0].id, port: 'q' });
  assert.deepEqual(branch.calls[0].in.a.from, { kind: 'input', call: branch.id, port: 'b' });
  // a bare wire is still not a boolean, but a relation over it is
  assert.throws(() => w.compose({ id: 'gate.mux/bad', implements: 'gate.mux',
    steps: [{ name: 'x', call: 'gate.buf', when: '$in.select', bind: { a: '$in.b' } }, { name: 'y', call: 'gate.buf', when: { eq: ['$in.select', 0] }, bind: { a: '$in.a' } }],
    returns: { q: { first: ['x.q', 'y.q'] } } }), (e) => e.code === 'ASSEMBLY_LINT' && /must be a boolean/.test(e.message));
  // a flip-flop built on the branch mux still stores: fill reaches through ff.dff/mux
  const flop = driveFlop(w, [[1, 0], [1, 1], [0, 0], [0, 1], [1, 1]], 0);
  const viaBranch = w.drive('ff.dff', { state: 0, d: 1, clk: 0 }, { ticks: 5, fill: { 'gate.mux': 'gate.mux/branch' }, each: (k) => ({ d: [1, 1, 0, 0, 1][k], clk: [0, 1, 0, 1, 1][k] }) });
  assert.deepEqual(viaBranch.receipts.map((r) => w.part(r.outputs.state)), flop.receipts.map((r) => w.part(r.outputs.state)));
});

test('one: a mux whose conditions overlap is AMBIGUOUS_BRANCH where first would silently take the first; only exclusive conditions are accepted by the run', () => {
  const w = fresh();
  const steps = (second) => [
    { name: 'takeB', call: 'gate.buf', when: { eq: ['$in.select', 1] }, bind: { a: '$in.b' } },
    { name: 'takeA', call: 'gate.buf', when: second, bind: { a: '$in.a' } },
  ];
  w.compose({ id: 'gate.mux/overlap-one', implements: 'gate.mux', steps: steps({ ne: ['$in.select', 7] }), returns: { q: { one: ['takeB.q', 'takeA.q'] } } });
  w.compose({ id: 'gate.mux/overlap-first', implements: 'gate.mux', steps: steps({ ne: ['$in.select', 7] }), returns: { q: { first: ['takeB.q', 'takeA.q'] } } });
  const fill = (impl) => ({ fill: { 'gate.mux': impl }, cache: false });
  // select = 0: only takeA's condition holds, so both agree
  assert.equal(w.run('gate.mux', { a: 1, b: 0, select: 0 }, fill('gate.mux/overlap-one')).outputs.q, 1);
  // select = 1: both conditions hold; `one` refuses, `first` takes takeB without comment (and both buffers ran)
  assert.throws(() => w.run('gate.mux', { a: 1, b: 0, select: 1 }, fill('gate.mux/overlap-one')), (e) => e.code === 'AMBIGUOUS_BRANCH' && e.receipt.status === 'failed');
  const quiet = w.run('gate.mux', { a: 1, b: 0, select: 1 }, fill('gate.mux/overlap-first')).trace;
  assert.deepEqual(quiet.calls.map((c) => c.contract), ['gate.buf', 'gate.buf']);
  // the shipped mux is exclusive by construction (takeA is `else` of takeB, derived, not typed); the run confirms it for both bit values
  for (const sel of [0, 1]) assert.doesNotThrow(() => w.run('gate.mux', { a: 1, b: 0, select: sel }, fill('gate.mux/branch')));
  // round 5: the assembly now refuses two provable overlaps (an unconditional alternative, and one condition implying another) ...
  assert.throws(() => w.compose({ id: 'gate.mux/one-bare', implements: 'gate.mux',
    steps: [{ name: 'takeB', call: 'gate.buf', when: { eq: ['$in.select', 1] }, bind: { a: '$in.b' } }, { name: 'takeA', call: 'gate.buf', bind: { a: '$in.a' } }],
    returns: { q: { one: ['takeB.q', 'takeA.q'] } } }), (e) => e.code === 'ASSEMBLY_LINT' && /one/.test(e.message));
  assert.throws(() => w.compose({ id: 'gate.mux/one-implies', implements: 'gate.mux',
    steps: [{ name: 'takeB', call: 'gate.buf', when: { and: [{ eq: ['$in.select', 1] }, { eq: ['$in.a', 1] }] }, bind: { a: '$in.b' } }, { name: 'takeA', call: 'gate.buf', when: { eq: ['$in.select', 1] }, bind: { a: '$in.a' } }],
    returns: { q: { one: ['takeB.q', 'takeA.q'] } } }), (e) => e.code === 'ASSEMBLY_LINT' && /implies/.test(e.message));
  // ... and still cannot see a semantic overlap: `eq select 1` against `ne select 7` is the overlap above, found only by the run (N20 residue)
  assert.ok(w.implementations().some((i) => i.id === 'gate.mux/overlap-one'), 'the lint accepted the semantic overlap at assembly');
});

test('counter.tick/gated: clock gating as a decision on the wire; same answers as the gate-level tick on all 32 (state, clk) inputs; clk = 0 builds nothing; busy and idle both leave five rows (v0.6)', () => {
  const w = fresh();
  const gated = { 'counter.tick': 'counter.tick/gated' };
  for (let n = 0; n < 16; n += 1) for (const clk of [0, 1]) {
    const full = w.run('counter.tick', { state: bitsOf(n), clk }, { cache: false }).outputs;
    const g = w.run('counter.tick', { state: bitsOf(n), clk }, { cache: false, fill: gated }).outputs;
    assert.deepEqual(g, full, `state ${n} clk ${clk}`);
    assert.equal(intOf(g.state), clk ? (n + 1) % 16 : n);
  }
  const idle = w.run('counter.tick', { state: bitsOf(5), clk: 0 }, { cache: false, fill: gated }).trace;
  const busy = w.run('counter.tick', { state: bitsOf(5), clk: 1 }, { cache: false, fill: gated }).trace;
  assert.deepEqual([countNodes(idle), countContract(idle, 'gate.nand')], [1, 0], 'the root alone: no helper, no adder, no flop');
  assert.deepEqual([countNodes(busy), countContract(busy, 'gate.nand')], [138, 76], 'exactly the nodes of the gate-level tick: the helper that added one is gone');
  // the trace still records five decisions for one cause (the view merges them): inc and the four flops each name their own step
  assert.deepEqual(idle.decisions.map((d) => [d.label, d.value, d.skipped]), [['inc', false, 'inc'], ['ff0', false, 'ff0'], ['ff1', false, 'ff1'], ['ff2', false, 'ff2'], ['ff3', false, 'ff3']]);
  assert.equal(new Set(idle.decisions.map((d) => JSON.stringify(d.from))).size, 1);
  assert.deepEqual(idle.decisions[0].from, { kind: 'test', op: 'eq', args: [{ kind: 'input', call: idle.id, port: 'clk' }, { kind: 'literal', value: 1 }] });
  // round 5 (inherited skips): the guard is written once, on inc. Round 6 (inherited runs are recorded): the busy tick leaves the same five rows
  // as the idle tick, `ran` instead of `skipped`, all with inc's cause, so both sides of the condition are the same shape (N25 resolved)
  assert.deepEqual(busy.decisions.map((d) => [d.label, d.value, d.ran]), [['inc', true, 'inc'], ['ff0', true, 'ff0'], ['ff1', true, 'ff1'], ['ff2', true, 'ff2'], ['ff3', true, 'ff3']]);
  assert.equal(new Set(busy.decisions.map((d) => JSON.stringify(d.from))).size, 1, 'one cause for all five');
  assert.deepEqual(busy.decisions.map((d) => JSON.stringify(d.from)), idle.decisions.map((d) => JSON.stringify(d.from)), 'the same cause (the relation over clk) on both sides');
  const gatedAssembly = w.implementations().find((i) => i.id === 'counter.tick/gated').assembly;
  assert.deepEqual(gatedAssembly.steps.filter((s) => s.when !== undefined).map((s) => s.name), ['inc'], 'one restated guard in the shipped composition, where round 4 had five');
  // an idle tick still records five skips for one cause: the four flops are skipped by inheritance and carry inc's cause
  // the state out of an idle tick is the input state itself: one passthrough, where v0.3 built a gather of four `at` pieces
  assert.deepEqual(idle.out.state.from, { kind: 'input', call: idle.id, port: 'state' });
  const clock = (k) => (k % 3 === 2 ? 0 : 1);
  const a = driveCounter(w, 12, { clock, fill: gated, cache: false });
  const wb = fresh();
  const b = driveCounter(wb, 12, { clock, cache: false });
  assert.deepEqual(a.receipts.map((r) => w.part(r.outputs.state)), b.receipts.map((r) => wb.part(r.outputs.state)));
  assert.deepEqual(a.receipts.map((r) => r.calls), [138, 138, 1, 138, 138, 1, 138, 138, 1, 138, 138, 1]);
  assert.equal(w.replay(a.receipts[2]).exact, true);
  // cache ON: a cache hit carries its decisions (v0.4), so a cached idle tick still says why it did nothing
  const wc = fresh();
  wc.run('counter.tick', { state: bitsOf(5), clk: 0 }, { fill: gated });
  const hit = wc.run('counter.tick', { state: bitsOf(5), clk: 0 }, { fill: gated }).trace;
  assert.equal(hit.cached, true);
  assert.equal(hit.decisions.length, 5);
});

test('gated tick: a gather around skipped outputs is itself skipped, so a single-alternative first falls through (v0.3 failed at run time here)', () => {
  const w = fresh();
  // the exact scenario of the v0.3 trap: `first` over a gather of a skipped step's outputs, and the idle alternative
  w.compose({ id: 'counter.tick/gated-naive', implements: 'counter.tick',
    steps: [
      { name: 'inc', call: 'adder.ripple4', when: { eq: ['$in.clk', 1] }, bind: { a: '$in.state', b: { literal: [1, 0, 0, 0] }, cin: { literal: 0 } } },
    ],
    returns: { state: { first: [{ gather: [{ at: ['inc.sum', 0] }, { at: ['inc.sum', 1] }, { at: ['inc.sum', 2] }, { at: ['inc.sum', 3] }] }, '$in.state'] } } });
  const naive = { cache: false, fill: { 'counter.tick': 'counter.tick/gated-naive' } };
  assert.deepEqual(w.run('counter.tick', { state: bitsOf(5), clk: 1 }, naive).outputs.state, bitsOf(6));
  assert.deepEqual(w.run('counter.tick', { state: bitsOf(5), clk: 0 }, naive).outputs.state, bitsOf(5));
  // the shipped composition has the same shape (one first around one gather) and no per-bit first
  const shipped = w.implementations().find((i) => i.id === 'counter.tick/gated').assembly;
  assert.equal(JSON.stringify(shipped.returns).match(/"first"/g).length, 1);
});

test('adder.ripple8: sum is a concat of the nibble sums; the low carry-out is the high carry-in; equals integer addition on an 18 x 18 x 2 grid and the corners', () => {
  const w = fresh();
  let checked = 0;
  const cases = [];
  for (let a = 0; a < 256; a += 15) for (let b = 0; b < 256; b += 15) for (const cin of [0, 1]) cases.push([a, b, cin]);
  cases.push([255, 255, 1], [255, 255, 0], [0, 0, 0], [15, 1, 0], [240, 16, 0], [128, 128, 0]);
  for (const [a, b, cin] of cases) {
    const o = w.run('adder.ripple8', { a: bitsOf(a, 8), b: bitsOf(b, 8), cin }, { cache: false }).outputs;
    const total = a + b + cin; // the independent definition
    assert.equal(intOf(o.sum), total % 256, `${a}+${b}+${cin}`);
    assert.equal(o.cout, total >= 256 ? 1 : 0);
    checked += 1;
  }
  assert.equal(checked, 18 * 18 * 2 + 6);
  const t = w.run('adder.ripple8', { a: bitsOf(15, 8), b: bitsOf(1, 8), cin: 0 }, { cache: false }).trace;
  assert.deepEqual(t.calls.map((c) => [c.contract, c.slot]), [['adder.ripple4', 'lo'], ['adder.ripple4', 'hi']]);
  assert.equal(countContract(t, 'gate.nand'), 120);
  assert.equal(countContract(t, 'adder.full'), 8);
  // eight pieces, each one `at` into one of the nibble sums, in order: low nibble first
  const pieces = t.out.sum.from.pieces;
  assert.equal(pieces.length, 8);
  pieces.forEach((p, i) => {
    assert.deepEqual(p.path, [i]);
    assert.deepEqual(p.from, { kind: 'at', of: { kind: 'call', call: t.calls[i < 4 ? 0 : 1].id, port: 'sum' }, path: [i % 4] });
  });
  // the carry crosses the nibble boundary by a call edge
  assert.deepEqual(t.calls[1].in.cin.from, { kind: 'call', call: t.calls[0].id, port: 'cout' });
  // each nibble's inputs are gathers of four `at` pieces of the 8-bit input (there is no slice)
  assert.deepEqual(t.calls[1].in.a.from.pieces.map((p) => p.from.path), [[4], [5], [6], [7]]);
});
