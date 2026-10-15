// Contest B renders (round 4, kernel v0.4). Every picture is drawn from a real run in this process.
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, driveToSvg, traceHtml } from '../src/view.mjs';
import { register, registerAudit, registerFaults, bitsOf, intOf, driveCounter, driveFlop, driveLatch } from '../contest/b-circuits/index.mjs';
import { adderCircuitSvg, counterTimelineSvg, latchStripSvg, inflate, countNodes, countContract } from '../contest/b-circuits/view.mjs';

const outDir = process.argv[2] ?? 'verify/out';
fs.mkdirSync(outDir, { recursive: true });
const fresh = () => { const w = createWorld({ name: 'b-circuits' }); register(w); registerAudit(w); registerFaults(w); return w; };
const write = (name, svgs) => fs.writeFileSync(path.join(outDir, `${name}.html`), traceHtml(svgs));
const dec = (state) => `${intOf(state)}  ${[...state].reverse().join('')}`;

// 1. full adder trace, cache off so every gate is visible
const w1 = fresh();
const fa = w1.run('adder.full', { a: 1, b: 1, cin: 1 }, { cache: false });
write('b-circuits-1-fulladder-trace', [traceToSvg(fa.trace, w1.part, { title: 'B1  adder.full(a=1, b=1, cin=1), cache off: every gate visible' })]);

// 2. circuit pictures: 11 + 6 (healthy), and the same sum with a stuck carry aimed at slot bit2
const w2 = fresh();
const sum = w2.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false });
const broken = w2.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } });
write('b-circuits-2-adder-11-plus-6', [adderCircuitSvg(sum.trace, w2.part, { title: 'B2  adder.ripple4: 11 + 6 + cin 0, every wire' })]);
write('b-circuits-2b-adder-fault', [adderCircuitSvg(broken.trace, w2.part, { title: "B2b  same inputs, fill 'adder.full#bit2' = carry-stuck-0" })]);

// 3. ripple adder as a kernel trace (maxDepth 1): composed vs loop
const w3 = fresh();
const comp = w3.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false });
const loop = w3.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: { 'adder.ripple4': 'adder.ripple4/loop' } });
write('b-circuits-3-ripple-wiring', [
  traceToSvg(comp.trace, w3.part, { title: 'B3a  adder.ripple4/composed, maxDepth 1: slots bit0..3, carry chain, sum gather', maxDepth: 1 }),
  traceToSvg(loop.trace, w3.part, { title: 'B3b  adder.ripple4/loop, maxDepth 1: same wiring, same slots, sum is a gather too', maxDepth: 1 }),
]);

// 4. counter timelines from world.drive receipts: every-tick clock, and a gated clock (no edge every third tick)
const w4 = fresh();
const d20 = driveCounter(w4, 20);
const w4b = fresh();
const gated = driveCounter(w4b, 14, { clock: (k) => (k % 3 === 2 ? 0 : 1) });
const w4c = fresh();
const gatedImpl = driveCounter(w4c, 14, { clock: (k) => (k % 3 === 2 ? 0 : 1), cache: false, fill: { 'counter.tick': 'counter.tick/gated' } });
write('b-circuits-4-counter-timeline', [
  counterTimelineSvg(d20.receipts, w4.part, { title: 'B4a  world.drive(counter.tick, 20 ticks): states, wraparound, cache' }),
  counterTimelineSvg(gated.receipts, w4b.part, { title: 'B4b  same counter, clk = 0 on every third tick (each(k) supplies clk)' }),
  counterTimelineSvg(gatedImpl.receipts, w4c.part, { title: "B4c  same clock, fill counter.tick = counter.tick/gated, cache off: an idle tick is 1 call, not 138" }),
]);

// 5. what the trace shows for time, old way (loop inside one run) and one tick
const w5 = fresh();
const run20 = w5.run('counter.run', { initial: [0, 0, 0, 0], ticks: 20 });
const one = w5.run('counter.tick', { state: [1, 1, 1, 1], clk: 1 }, { cache: false });
write('b-circuits-5-counter-trace', [
  traceToSvg(run20.trace, w5.part, { title: 'B5a  counter.run/drive, maxDepth 1: ticks @0..@19', maxDepth: 1 }),
  traceToSvg(one.trace, w5.part, { title: 'B5b  one counter.tick(15), cache off, maxDepth 1', maxDepth: 1 }),
]);

// 6. driveToSvg: the kernel's own strip for the same drive, plus a single flop
const w6 = fresh();
const d6 = driveCounter(w6, 20);
const flop = driveFlop(w6, [[1, 0], [1, 1], [0, 0], [0, 1], [1, 1]], 0);
write('b-circuits-6-drive-strip', [
  driveToSvg(d6.receipts.slice(0, 10), w6.part, { title: 'B6a  driveToSvg(counter.tick) ticks 0-9', describe: dec }),
  driveToSvg(d6.receipts.slice(10), w6.part, { title: 'B6b  driveToSvg(counter.tick) ticks 10-19 (16-19 reuse ticks 0-3)', describe: dec }),
  driveToSvg(flop.receipts, w6.part, { title: 'B6c  driveToSvg(ff.dff) schedule (d,clk) = (1,0) (1,1) (0,0) (0,1) (1,1)', describe: (s) => `q = ${s}` }),
]);

// 7. SR latch: lockstep vs staggered timing, and one tick's trace with slot names
const w7 = fresh();
const SCHEDULE = [[1, 1], [0, 1], [1, 1], [1, 1], [1, 0], [1, 1], [1, 1]];
const stag = driveLatch(w7, SCHEDULE, { impl: 'latch.sr/staggered' });
const lock = driveLatch(w7, SCHEDULE, { impl: 'latch.sr/lockstep' });
const lockTick = w7.run('latch.sr', { state: [1, 1], s_n: 1, r_n: 1 }, { cache: false, fill: { 'latch.sr': 'latch.sr/lockstep' } });
write('b-circuits-7-latch', [
  latchStripSvg(stag.receipts, w7.part, { title: 'B7a  latch.sr/staggered: hold, SET, hold, hold, RESET, hold, hold' }),
  latchStripSvg(lock.receipts, w7.part, { title: 'B7b  latch.sr/lockstep, same schedule: after SET the outputs chase each other' }),
  traceToSvg(lockTick.trace, w7.part, { title: 'B7c  one lockstep hold tick from [1,1]: two NANDs, slots q and qn, state is a gather' }),
]);

// 8. audit: a check over the adder, healthy and with the stuck carry
const w8 = fresh();
const okA = w8.run('adder.audited', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false });
const badA = w8.run('adder.audited', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: { 'adder.full#bit2': 'adder.full/carry-stuck-0' } });
write('b-circuits-8-audit', [
  traceToSvg(okA.trace, w8.part, { title: 'B8a  adder.audited(11, 6, 0), healthy: check accepts', maxDepth: 1 }),
  traceToSvg(badA.trace, w8.part, { title: "B8b  adder.audited(11,6,0) with #bit2 = carry-stuck-0: check rejects", maxDepth: 1 }),
]);

// 9. the multiplexer three ways: gates, a declared decision (when/first), an imperative decision (ctx.when); same inputs
const w9 = fresh();
const muxIn = { a: 1, b: 0, select: 1 };
const mux = Object.fromEntries(['gate.mux/nand', 'gate.mux/branch', 'gate.mux/ctx-when'].map((impl) => [impl, w9.run('gate.mux', muxIn, { cache: false, fill: { 'gate.mux': impl } })]));
write('b-circuits-9-mux-decisions', [
  traceToSvg(mux['gate.mux/nand'].trace, w9.part, { title: 'B9a  gate.mux/nand with a=1, b=0, select=1: four NANDs always switch' }),
  traceToSvg(mux['gate.mux/branch'].trace, w9.part, { title: 'B9b  gate.mux/branch: takeB when eq select 1, takeA by else' }),
  traceToSvg(mux['gate.mux/ctx-when'].trace, w9.part, { title: 'B9c  gate.mux/ctx-when: ctx.when with named branches' }),
]);

// 10. clock gating as a decision: one tick with the edge and one without
const w10 = fresh();
const gateFill = { 'counter.tick': 'counter.tick/gated' };
const busy = w10.run('counter.tick', { state: [1, 0, 1, 0], clk: 1 }, { cache: false, fill: gateFill });
const idle = w10.run('counter.tick', { state: [1, 0, 1, 0], clk: 0 }, { cache: false, fill: gateFill });
write('b-circuits-10-gated-counter', [
  traceToSvg(busy.trace, w10.part, { title: 'B10a  gated, state 5, clk 1: inc and the flops run: five decisions, one merged row, one cause', maxDepth: 1 }),
  traceToSvg(idle.trace, w10.part, { title: 'B10b  gated, state 5, clk 0: inc and the flops skipped: five decisions, one merged row, one cause', maxDepth: 1 }),
]);

// 11. a cache hit with and without its original subtree drawn
const w11 = fresh();
const fa000 = w11.run('adder.full', { a: 0, b: 0, cin: 0 });
const expand = (n) => w11.node(n.cachedFrom.run, n.cachedFrom.call);
write('b-circuits-11-ghost-cache', [
  traceToSvg(fa000.trace, w11.part, { title: 'B11a  adder.full(0,0,0), cache on, as v0.2 drew it: the second half adder is a hatched box with no gates' }),
  traceToSvg(fa000.trace, w11.part, { title: 'B11b  same run with expand: the cache hit draws the subtree it was served from, as ghosts', expand }),
]);

// 12. the 8-bit adder: concat of nibble sums
const w12 = fresh();
const add8 = w12.run('adder.ripple8', { a: bitsOf(15, 8), b: bitsOf(1, 8), cin: 0 }, { cache: false });
write('b-circuits-12-ripple8-concat', [
  traceToSvg(add8.trace, w12.part, { title: 'B12  adder.ripple8(15, 1, 0): lo, hi, sum = concat', maxDepth: 1 }),
]);

// 13. a fault aimed at one full adder of the high nibble with a slot that only that adder has
const w13 = fresh();
const fault8 = w13.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { cache: false, fill: { 'adder.ripple4#hi/adder.full#bit2': 'adder.full/carry-stuck-0' } });
const ok8 = w13.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { cache: false });
write('b-circuits-13-ripple8-fault-hi2', [
  traceToSvg(ok8.trace, w13.part, { title: 'B13a  adder.ripple8(112, 16, 0) healthy, maxDepth 2: sum bit 7 only', maxDepth: 2 }),
  traceToSvg(fault8.trace, w13.part, { title: "B13b  path fill on hi bit 2 = carry-stuck-0, maxDepth 2", maxDepth: 2, receipt: fault8.receipt }),
]);

// 16. fills read back from the receipt (v0.5): an unreached flat key is marked, contract#* reaches every seat, a path key beats it
const w16 = fresh();
const stuck = 'adder.full/carry-stuck-0';
const unreached = w16.run('gate.xor', { a: 1, b: 1 }, { cache: false, fill: { 'adder.full#bit2': stuck } });
const allStuck = w16.run('adder.ripple4', { a: bitsOf(11), b: bitsOf(6), cin: 0 }, { cache: false, fill: { 'adder.full#*': stuck } });
const mixed16 = w16.run('adder.ripple8', { a: bitsOf(112, 8), b: bitsOf(16, 8), cin: 0 }, { cache: false, fill: { 'adder.full#*': stuck, 'adder.ripple4#hi/adder.full#bit2': 'adder.full/two-half' } });
write('b-circuits-16-fills-consulted', [
  traceToSvg(unreached.trace, w16.part, { title: 'B16a  flat key aimed at a gate.xor run: accepted, marked not consulted', maxDepth: 1, receipt: unreached.receipt }),
  traceToSvg(allStuck.trace, w16.part, { title: 'B16b  contract#* on adder.ripple4: all four seats stuck', maxDepth: 1, receipt: allStuck.receipt }),
  traceToSvg(mixed16.trace, w16.part, { title: 'B16c  ripple8: contract#* plus one path key that beats it', maxDepth: 2, receipt: mixed16.receipt }),
]);

// 14. a resumed drive: the second drive continues the clock from tick 10 and its first tick points at the first drive's last run
const w14 = fresh();
const first14 = driveCounter(w14, 10);
const second14 = driveCounter(w14, 10, { initial: first14.state, startTick: 10 });
write('b-circuits-14-resumed-drive', [
  driveToSvg(first14.receipts, w14.part, { title: 'B14a  driveCounter ticks 0-9', describe: dec }),
  driveToSvg(second14.receipts, w14.part, { title: 'B14b  resumed with startTick 10, state = first.state: ticks 10-19', describe: dec }),
]);

// 15. one: a mux whose two conditions overlap fails with AMBIGUOUS_BRANCH, and the failed trace is the picture
const w15 = fresh();
w15.compose({ id: 'gate.mux/overlap-one', implements: 'gate.mux', steps: [
  { name: 'takeB', call: 'gate.buf', when: { eq: ['$in.select', 1] }, bind: { a: '$in.b' } },
  { name: 'takeA', call: 'gate.buf', when: { eq: ['$in.a', 1] }, bind: { a: '$in.a' } },
], returns: { q: { one: ['takeB.q', 'takeA.q'] } } });
let overlap = null;
try { w15.run('gate.mux', { a: 1, b: 0, select: 1 }, { cache: false, fill: { 'gate.mux': 'gate.mux/overlap-one' } }); } catch (e) { overlap = e; }
write('b-circuits-15-one-ambiguous', [
  traceToSvg(overlap.trace, w15.part, { title: 'B15  one over eq select 1 and eq a 1: both live at select 1, a 1' }),
]);

const facts = {
  fullAdderNodes: countNodes(fa.trace), fullAdderNands: countContract(fa.trace, 'gate.nand'),
  adder4Nands: countContract(sum.trace, 'gate.nand'), adder4Nodes: countNodes(sum.trace),
  oneStepNodes: countNodes(one.trace), oneStepNands: countContract(one.trace, 'gate.nand'),
  driveStates: d6.receipts.map((r) => intOf(w6.part(r.outputs.state))),
  driveCached: d6.receipts.map((r, k) => (r.trace.cached ? `${r.tick}=run${r.trace.cachedFrom.run}` : null)).filter(Boolean),
  gatedStates: gated.receipts.map((r) => intOf(w4b.part(r.outputs.state))),
  gatedCached: gated.receipts.map((r) => (r.trace.cached ? `${r.tick}=run${r.trace.cachedFrom.run}` : null)).filter(Boolean),
  runLoopNodesCacheOn: countNodes(run20.trace),
  runLoopNodesCacheOff: countNodes(w5.run('counter.run', { initial: [0, 0, 0, 0], ticks: 20 }, { cache: false }).trace),
  latchStaggered: stag.receipts.map((r) => w7.part(r.outputs.state)), latchLockstep: lock.receipts.map((r) => w7.part(r.outputs.state)),
  brokenSum: broken.outputs, audit: { healthy: okA.outputs, broken: badA.outputs, healthyVerdicts: okA.receipt.verdicts, verdicts: badA.receipt.verdicts },
  loopSumFrom: loop.trace.out.sum.from.kind, composedSumFrom: comp.trace.out.sum.from.kind,
  resumed: { ticks: second14.receipts.map((r) => r.tick), links: second14.receipts.map((r) => r.trace.in.state.from.kind === 'run' ? `← run ${r.trace.in.state.from.run}` : 'initial'), cached: second14.receipts.map((r) => (r.trace.cached ? `run ${r.trace.cachedFrom.run}` : null)) },
  overlap: { code: overlap.code, calls: overlap.trace.calls.map((c) => c.contract), decisions: overlap.trace.decisions.map((d) => `${d.label}=${d.value}`) },
  helperContracts: w1.contracts().filter((c) => /^bit\./.test(c.id)).map((c) => c.id),
  // ---- round 5
  guards: Object.fromEntries(['counter.tick/gated', 'gate.mux/branch'].map((id) => [id, w1.implementations().find((i) => i.id === id).assembly.steps.map((s) => `${s.name}:${s.when ? JSON.stringify(s.when) : '-'}`)])),
  latchTrajectoryOnImpl: Object.fromEntries(['latch.sr/staggered', 'latch.sr/lockstep'].map((id) => [id, w7.implementations().find((i) => i.id === id).examples.filter((e) => e.trajectory).length])),
  latchDrivenEqualsExample: ['latch.sr/staggered', 'latch.sr/lockstep'].map((id, k) => JSON.stringify((k ? lock : stag).receipts.map((r) => w7.part(r.outputs.state))) === JSON.stringify(w7.implementations().find((i) => i.id === id).examples.find((e) => e.trajectory).trajectory.map((t) => t.state))),
  proofs: { latch: w7.prove('latch.sr').map((p) => `${p.impl}:${p.example}:${p.ok}`) },
  fills: { unreached: unreached.receipt.fillConsulted, allStuck: allStuck.receipt.fillConsulted, mixed: mixed16.receipt.fillConsulted, path8: fault8.receipt.fillConsulted,
    allStuckOut: allStuck.outputs, mixedOut: mixed16.outputs },
  busyDecisions: busy.trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ?? d.skipped}`), idleDecisions: idle.trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ?? d.skipped}`),
  statesPieceLabels: run20.trace.out.states.from.pieces.slice(0, 4).map((p) => JSON.stringify(p).slice(0, 120)),
  // ---- round 6
  reach: { mixed: mixed16.receipt.fillReach, allStuck: allStuck.receipt.fillReach, path8: fault8.receipt.fillReach, unreached: unreached.receipt.fillReach },
  rungs: { mixed: Object.fromEntries(mixed16.trace.calls.flatMap((c) => [[`#${c.id} ${c.slot}`, c.chosenBy.rung], ...c.calls.map((g) => [`#${g.id} ${c.slot}/${g.slot}`, g.chosenBy.rung])])), busyCalls: busy.trace.calls.map((c) => `#${c.id} ${c.chosenBy.rung}`) },
  busyDecisionCauses: new Set(busy.trace.decisions.map((d) => JSON.stringify(d.from))).size,
  // ---- round 3
  runDriveTicks: run20.trace.calls.map((c) => c.tick), runDriveCached: run20.trace.calls.map((c) => c.cached),
  runDriveStatesPieces: run20.trace.out.states.from.pieces.length,
  timelineCalls: d20.receipts.map((r) => (r.trace.cached ? null : r.calls)),
  gatedImplCalls: gatedImpl.receipts.map((r) => r.calls), gatedImplStates: gatedImpl.receipts.map((r) => intOf(w4c.part(r.outputs.state))),
  mux: Object.fromEntries(Object.entries(mux).map(([k, v]) => [k, { q: v.outputs.q, nodes: countNodes(v.trace), nands: countContract(v.trace, 'gate.nand'), boxes: v.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: v.trace.decisions }])),
  gated: { busy: { state: busy.outputs.state, nodes: countNodes(busy.trace), boxes: busy.trace.calls.map((c) => `#${c.id} ${c.contract}${c.slot ? `#${c.slot}` : ''}`), decisions: busy.trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ?? d.skipped}`) },
    idle: { state: idle.outputs.state, nodes: countNodes(idle.trace), boxes: idle.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: idle.trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ?? d.skipped}`), stateFrom: idle.trace.out.state.from.kind } },
  ghost: { out: fa000.outputs, root: `#${fa000.trace.id}`, children: fa000.trace.calls.map((c) => `#${c.id} ${c.contract} cached=${c.cached}${c.cachedFrom ? ` from run ${c.cachedFrom.run} #${c.cachedFrom.call}` : ''} kids=${c.calls.length}`),
    originalNodes: fa000.trace.calls.filter((c) => c.cached).map((c) => countNodes(w11.node(c.cachedFrom.run, c.cachedFrom.call))), inflatedNodes: countNodes(inflate(w11, fa000.trace)) },
  ripple8: { out: add8.outputs, boxes: add8.trace.calls.map((c) => `#${c.id} ${c.contract}#${c.slot} ${c.impl}`), sumPieces: add8.trace.out.sum.from.pieces.map((p) => `${p.path}<-#${p.from.of.call}${p.from.path}`), nands: countContract(add8.trace, 'gate.nand') },
  ripple8Fault: { healthy: ok8.outputs, faulty: fault8.outputs,
    faultyCallSites: (() => { const hits = []; (function f(n) { if (n.impl === 'adder.full/carry-stuck-0') hits.push(`#${n.id} ${n.slot}`); n.calls.forEach(f); })(fault8.trace); return hits; })() },
};
// Round 5 claims, written before the PNGs were opened (verdicts are in contest/b-circuits/EXPLAIN.md). The round 4 claims are kept below as claimsRound4.
// Round 6 claims, written before the re-rendered PNGs were opened. EVERY picture has a claim and a verdict (the audit found unrecorded claims).
// The round 5 claims are kept as claimsRound5, the round 4 ones as claimsRound4.
facts.claims = {
  'b1': 'content unchanged: 27 boxes, 15 NAND boxes, sum = 1, carry = 1. New in v0.6: every bracket in the right margin has its own lane, so no two vertical purple/blue lines share an x in the gutter (to be checked by zooming)',
  'b2': 'unchanged: four boxes bit 3..0, 9 lit lamps, sum 10001 = 17 (my own SVG, not the kernel view)',
  'b2b': 'unchanged: only the bit 2 box is red, circuit says 9 (DISAGREE)',
  'b3': 'content unchanged: B3a and B3b identical but for /composed vs /loop; four boxes adder.full#bit0..#bit3; the four purple sum brackets and the carry bracket run in distinct lanes (zoom the margin)',
  'b4a': 'unchanged: calls made 55 32 18 16 10 ... 10 then dashes under the hatched ticks 16-19',
  'b4b': 'unchanged: every tick has a call count, no cached cell, clk zeros red at ticks 2 5 8 11',
  'b4c': 'unchanged: calls made reads 138 138 1 138 138 1 ...; values identical to b4b',
  'b5a': 'the 20 collected pieces of the states row each name their tick with a trailing <-@k, k = 0..19 ascending with no repeat; the initial piece carries no tick; 20 dashed brackets to the 20 tick boxes, each in its own lane (zoom the right margin: no two share an x); drive row unchanged',
  'b5b': 'unchanged: adder.ripple4 with cout = 1 and nothing leaving it, four ff.dff#bit0..3, gather state',
  'b6': 'unchanged: cached cells say cached <- run 1 .. 4 for ticks 16-19; b6c ticks 0 and 2 compute (6 calls), ticks 1 3 4 cached',
  'b7': 'unchanged: staggered strip one red box at tick 4; lockstep strip red boxes at ticks 1 2 3 (my own SVG)',
  'b8': 'unchanged: root with sum and cout only; green check box #111 (check mark kept in its header), red check box #115; the reason line is cut with an ellipsis',
  'b9a': 'unchanged: gate.mux/nand with #2 gate.not, #4 #5 #6 gate.nand, no decision rows',
  'b9b': 'takeB row unchanged (ran, read eq($in.select=1, 1)); the takeA row now prints SHORT: skipped, read else(takeB), with its cause drawn as an edge from the root select row instead of the spelled-out eq test; two separate decision lanes',
  'b9c': 'unchanged: ONE row select = 1? ran takeB, skipped takeA, read eq($in.select=1, 1)',
  'b10a': 'busy tick, clk 1: v0.6 records inherited runs, so the root has ONE merged row inc, ff0, ff1, ff2, ff3 = true -> ran, read eq($in.clk=1, 1) (five names, one cause), where v0.5 showed a row for inc alone; five child boxes as before (#2 adder.ripple4, #111 #118 #125 #132 ff.dff#bit0..3)',
  'b10b': 'idle tick, clk 0: unchanged from round 5: root alone, ONE merged row inc, ff0, ff1, ff2, ff3 = false -> skipped, read eq($in.clk=0, 1); state a passthrough',
  'b11a': 'unchanged: #12 adder.half hatched, cached from run 1 #2, no children, hatched NAND/NOT boxes #6 #9 #11 #15 #16 #17',
  'b11b': 'unchanged: nine faded dashed ghost boxes (run 1) under #12',
  'b12': 'unchanged: #2 adder.ripple4#lo and #111 adder.ripple4#hi, both adder.ripple4/composed, blue bracket cout -> cin, sum = [0,0,0,0,1,0,0,0], cout 0',
  'b13a': 'unchanged: healthy 112 + 16: root sum = [0,0,0,0,0,0,0,1]; no fill line',
  'b13b': 'the fill line now carries reach: adder.ripple4#hi/adder.full#bit2 -> adder.full/carry-stuck-0 @ #166; box #166 is carry-stuck-0 and shows how it was chosen (path fill) on its implementation line or a flag row; the other seven adders say nothing about a fill',
  'b14a': 'unchanged: strip of ticks 0-9, run ids 1-10',
  'b14b': 'unchanged: ticks 10-19, tick 10 reads <- run 10, ticks 16-19 cached <- run 1..4',
  'b15': 'unchanged: error wrapped inside the red root box, both rows ran with their eq tests and values, both gate.buf boxes present',
  'b16a': 'fill line: adder.full#bit2 -> adder.full/carry-stuck-0 (not consulted) with no @ ids; gate.xor with four NAND children',
  'b16b': 'fill line: adder.full#* -> adder.full/carry-stuck-0 @ #2 #33 #64 #95; the four boxes say they were chosen by the every-slot fill; sum [1,0,1,1], cout 0',
  'b16c': 'fill line has two keys with their reach: adder.full#* @ #3 #34 #65 #96 #128 #159 #217 and the path key @ #190; #190 is two-half chosen by path fill, the other seven stuck chosen by the every-slot fill; the nibble boxes #2 and #127 are chosen by the declared default (contract select); root sum [0,0,0,0,0,1,1,0]',
};
facts.claimsRound5 = {
  'b1': 'unchanged: 27 boxes, 15 NAND boxes, sum = 1 carry = 1',
  'b2': 'unchanged: four boxes bit 3..0, 9 lit lamps, sum 10001 = 17',
  'b2b': 'unchanged: only the bit 2 box is red, circuit says 9 (DISAGREE)',
  'b3': 'unchanged: B3a and B3b identical but for /composed vs /loop; boxes adder.full#bit0..#bit3, ids #2 #29 #56 #83',
  'b4a': 'unchanged: calls made 55 32 18 16 10 ... 10 then dashes under the hatched ticks 16-19',
  'b4b': 'unchanged: every tick has a call count, no cached cell, clk zeros red at ticks 2 5 8 11',
  'b4c': 'unchanged: calls made reads 138 138 1 138 138 1 ...; values identical to b4b (inherited skips changed the guard, not the trace)',
  'b5a': 'the states row of the root no longer shows a wall of identical "pieces x20" labels: its 21 pieces carry distinct labels (the initial state, then one per tick), each with one bracket to its tick child',
  'b5b': 'unchanged: adder.ripple4 with cout = 1 and nothing leaving it, four ff.dff#bit0..3, gather state',
  'b6': 'unchanged: cached cells say cached <- run 1 .. 4 for ticks 16-19',
  'b7': 'unchanged: staggered strip has one red box at tick 4; lockstep strip has red boxes at ticks 1 2 3. The values now equal the trajectory examples stored on the implementations (fact latchDrivenEqualsExample: true, true)',
  'b8': 'unchanged: root with sum and cout only; green check box #111, red check box #115',
  'b9a': 'unchanged: gate.mux/nand with #2 gate.not, #4 #5 #6 gate.nand, no decision rows',
  'b9b': 'ONE child #2 gate.buf as before; two decision rows: takeB ran, reading eq($in.select=1, 1); takeA skipped, reading an else expression that names takeB and shows the same eq test with its values; no relation on select = 0 anywhere in the box',
  'b9c': 'unchanged: ONE child #2 gate.buf; one decision row select = 1? ran takeB, skipped takeA',
  'b10a': 'busy tick, clk 1: children #2 adder.ripple4 and ff.dff#bit0..3 (#111 #118 #125 #132) as before. Decisions: the guard is written once, on inc. I predict ONE decision row for inc (ran, read eq($in.clk=1, 1)) and NO rows for the four flops, because they have no condition of their own (see fact busyDecisions)',
  'b10b': 'idle tick, clk 0: the root alone, no child box; ONE merged row skipped inc, ff0, ff1, ff2, ff3 with the same single read eq($in.clk=0, 1) (the flops are skipped by inheritance and the record says so with the original cause); the state is one passthrough',
  'b11a': 'unchanged: #12 adder.half hatched, cached from run 1 #2, no children',
  'b11b': 'unchanged: nine faded dashed ghost boxes (run 1) under #12',
  'b12': 'unchanged: #2 adder.ripple4#lo and #111 adder.ripple4#hi, both adder.ripple4/composed, blue bracket cout -> cin, sum = [0,0,0,0,1,0,0,0], cout 0',
  'b13a': 'unchanged: healthy 112 + 16: root sum = [0,0,0,0,0,0,0,1]',
  'b13b': 'a fill line under the title reads adder.ripple4#hi/adder.full#bit2 -> adder.full/carry-stuck-0 with no "not consulted" mark; exactly one box (#166 under hi) names carry-stuck-0; root sum all zero',
  'b14a': 'unchanged: strip of ticks 0-9, run ids 1-10',
  'b14b': 'unchanged: ticks 10-19, tick 10 reads "<- run 10", ticks 16-19 cached <- run 1..4',
  'b15': 'one over eq select 1 and eq a 1 at select 1, a 1: the root is red with AMBIGUOUS_BRANCH and the whole error sentence is wrapped INSIDE the root box (v0.4 ran 145 px out of it); both decision rows read ran with their eq tests and values; both gate.buf boxes present',
  'b16a': 'fill line: adder.full#bit2 -> adder.full/carry-stuck-0 marked (not consulted); the trace is gate.xor with four NAND children and no adder box',
  'b16b': 'adder.ripple4 11 + 6 + 0 with adder.full#*: four boxes adder.full#bit0..bit3, every one carry-stuck-0, fill line shows one key with no not-consulted mark, sum = [1,0,1,1] (13), cout 0 (hand-worked: with every carry stuck at 0, bit i is a_i xor b_i)',
  'b16c': 'adder.ripple8 112 + 16 with adder.full#* and a path key for hi bit 2: fill line lists two keys, neither marked; under lo every full adder is carry-stuck-0; under hi bit0, bit1, bit3 carry-stuck-0 and bit2 two-half; root sum = [0,0,0,0,0,1,1,0] (96), cout 0',
};
facts.claimsRound4 = {
  'b1': 'unchanged: 27 boxes, 15 NAND boxes, sum = 1 carry = 1',
  'b2': 'unchanged: four boxes bit 3..0, 9 lit lamps, sum 10001 = 17',
  'b2b': 'unchanged: only the bit 2 box is red, circuit says 9 (DISAGREE)',
  'b3': 'unchanged except the label style: B3a and B3b identical but for the impl line; boxes adder.full#bit0..#bit3 with ids #2 #29 #56 #83; labels now read target<-source',
  'b4a': 'unchanged: calls made 55 32 18 16 10 ... 10 then dashes under the hatched ticks 16-19',
  'b4b': 'unchanged: every tick has a call count, no cached cell, clk zeros red at ticks 2 5 8 11',
  'b4c': 'calls made reads 138 138 1 138 138 1 ... (one less than round 3: the bit.test helper is gone); values identical to b4b',
  'b5a': 'counter.run/drive: the root carries a drive row (the drive glyph) saying 20 ticks, 0-19, stopped by ticks; 20 children @0..@19; hatched @16..@19; the states row has 21 piece labels of which 20 end at a tick child',
  'b5b': 'unchanged: adder.ripple4 with cout = 1 and nothing leaving it, four ff.dff#bit0..3, gather state',
  'b6': 'the cached cells of b6b and b6c now say where the entry came from: "cached ← run 1" .. "← run 4" for ticks 16-19; ✓/✗ counts absent because the counter has no check',
  'b7': 'unchanged: latch strips; red dashed boxes at tick 4 (staggered), ticks 1 2 3 (lockstep)',
  'b8': 'unchanged: root with sum and cout only; green check box #111, red check box #115',
  'b9a': 'unchanged: gate.mux/nand with #2 gate.not, #4 #5 #6 gate.nand, no decision rows',
  'b9b': 'root gate.mux/branch has ONE child, #2 gate.buf (two NOTs, two NANDs below it); no bit.test box; two decision rows that print the relation eq($in.select, 1) and eq($in.select, 0) with amber edges from the root\'s select row; takeB ran amber, takeA skipped grey; 6 boxes in all',
  'b9c': 'same ONE child #2 gate.buf; ONE decision row for select = 1? with the relation eq(..., 1), reading ran takeB, skipped takeA',
  'b10a': 'counter.tick/gated, clk 1: children #2 adder.ripple4, ff.dff#bit0..3 (ids #111 #118 #125 #132); no bit.test box; the five identical decisions are drawn as ONE merged row reading eq($in.clk, 1) = true with ran inc, ff0, ff1, ff2, ff3',
  'b10b': 'clk 0: the root alone, no child box at all; ONE merged row with skipped inc, ff0, ff1, ff2, ff3; the state row is a single passthrough from the root input, not four labels',
  'b11a': 'unchanged: #12 adder.half hatched, cached from run 1 #2, no children',
  'b11b': 'unchanged: nine faded dashed ghost boxes (run 1) under #12',
  'b12': 'unchanged shape: #2 adder.ripple4#lo and #111 adder.ripple4#hi, both with impl adder.ripple4/composed (not lo-nibble/hi-nibble), blue bracket cout -> cin, sum = [0,0,0,0,1,0,0,0], cout 0',
  'b13a': 'healthy 112 + 16: under hi, #166 adder.full#bit2 carry = 1 and #193 #bit3 sum = 1; the slots are bit0..bit3 in both nibbles; root sum = [0,0,0,0,0,0,0,1]',
  'b13b': 'path fill: exactly one box (#166 under hi) names adder.full/carry-stuck-0, carry = 0; the lo nibble box #57 adder.full#bit2 is two-half; root sum all zero',
  'b14a': 'strip of ticks 0-9, run ids 1-10, as b6a',
  'b14b': 'strip of ticks 10-19 with run ids 11-20; tick 10 reads "← run 10" (the first drive), not "initial"; ticks 16-19 read "cached ← run 1" .. "cached ← run 4"',
  'b15': 'failed run: root gate.mux/overlap-one shows an error AMBIGUOUS_BRANCH inside its box, both takeB and takeA rows true / ran, and both #2 and #3 gate.buf boxes present',
};
fs.writeFileSync(path.join(outDir, 'b-circuits-facts.json'), JSON.stringify(facts, null, 1));
console.log(JSON.stringify(facts));
