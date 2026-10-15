import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/kernel.mjs';
import { canonical } from '../src/canonical.mjs';
import { register, initialState, config, runDrive, runSimulate, contested } from '../contest/f-agents/index.mjs';

const fresh = () => { const w = createWorld({ name: 'f' }); register(w); return w; };
const EXACT = { 'agents.allocate': 'agents.allocate/exact-dp' };
const init = initialState();
const agentsById = new Map(init.agents.map((x) => [x.id, x]));

/** Oracle written against the brief's rules, not against the allocators or the kernel's own check contracts. */
function checkState(state, N, strict, tickNo) {
  const running = state.tasks.filter((t) => t.status === 'running');
  const busy = state.agents.filter((a) => a.task !== null);
  assert.equal(busy.length, running.length, `tick ${tickNo}: busy agents vs running tasks`);
  for (const a of busy) {
    const t = state.tasks.find((x) => x.id === a.task);
    assert.equal(t.status, 'running'); assert.equal(t.agent, a.id, `tick ${tickNo}: one task per agent`);
    if (a.kind === 'strong') assert.equal(t.stream, a.stream, `tick ${tickNo}: strong ${a.id} on stream ${t.stream}`);
  }
  assert.equal(new Set(running.map((t) => t.agent)).size, running.length);
  assert.ok(busy.filter((a) => a.kind === 'orchestrator').length <= 2, `tick ${tickNo}: more than 2 orchestrators busy`);
  const done = state.tasks.filter((t) => t.status === 'done').length;
  if (strict) assert.ok(done + running.length <= N, `tick ${tickNo}: done ${done} + running ${running.length} exceeds N=${N}`);
  return done;
}

test('every contract example (derived by hand) proves against every implementation', () => {
  const w = fresh();
  const proofs = w.contracts().flatMap((c) => w.prove(c.id));
  assert.deepEqual(proofs.filter((p) => !p.ok), []);
  for (const c of w.contracts()) assert.ok(c.examples.length >= 1, `${c.id} has an example`);
  assert.ok(proofs.some((p) => p.impl === 'agents.allocate/exact-dp') && proofs.some((p) => p.impl === 'agents.allocate/greedy'));
  assert.deepEqual(w.contracts().filter((c) => c.kind !== 'calculation').map((c) => `${c.id}:${c.kind}`).sort(), ['agents.capacity:check', 'agents.evaluate:check', 'agents.regret:check', 'agents.tick:tick']);
});

test('implementation examples (v0.3): the contested input is an example of each allocator with its own answer, 1709 for greedy and 1909 for exact-dp', () => {
  const w = fresh();
  const own = w.prove('agents.allocate').filter((p) => String(p.example).startsWith('impl:'));
  assert.deepEqual(own.map((p) => [p.impl, p.example, p.ok]), [['agents.allocate/greedy', 'impl:0', true], ['agents.allocate/exact-dp', 'impl:0', true]]);
  // the same input is NOT a contract example (round 2: it could not be, exact would have failed greedy's answer and vice versa)
  assert.ok(!w.contracts().find((c) => c.id === 'agents.allocate').examples.some((ex) => JSON.stringify(ex.in) === JSON.stringify(contested)));
  assert.deepEqual([w.run('agents.allocate', contested).outputs.score, w.run('agents.allocate', contested, { fill: EXACT }).outputs.score], [1709, 1909]);
});

test('the hand-derived tiny timeline is a contract example: agents.tick has the final-state example, a `trajectory` of outputs per tick (v0.5), and agents.simulate proves the same events; the clock is proved at a tick', () => {
  const w = fresh();
  const ticks = w.prove('agents.tick'); const sim = w.prove('agents.simulate'); const clock = w.prove('agents.clock');
  // v0.6: examples carry names, and the proof reports the name (round 5 reported 0, 1, 2)
  assert.deepEqual(ticks.map((p) => [p.example, p.ok]), [['a finished world is a fixed point', true], ['the tiny world, five ticks (final tick)', true], ['the tiny world, tick by tick', true]], JSON.stringify(ticks.filter((p) => !p.ok)));
  assert.deepEqual(sim.map((p) => [p.example, p.ok]), [['the tiny world in one call', true]], JSON.stringify(sim.filter((p) => !p.ok)));
  assert.deepEqual(clock.map((p) => [p.example, p.ok]), [['tick 0', true], ['tick 7', true]], 'agents.clock is proved at ticks 0 and 7 (round 4 kept the invented sentinel -1 here, FRICTION 13)');
  assert.equal(w.contracts().find((c) => c.id === 'agents.clock').examples.some((e) => e.out.tick === -1), false, 'no sentinel example left');
});

test('the tiny world, driven (flipped from a hand-kept literal list in this test to the trajectory example): the driver reproduces the contract\'s per-tick events and counts, and prove names the tick where a wrong trajectory breaks', () => {
  const w = fresh();
  const ex = w.contracts().find((c) => c.id === 'agents.tick').examples.find((e) => e.trajectory);
  const r = runDrive(w, ex.in.state, ex.in.config);
  assert.equal(r.ticks, ex.ticks);
  // the driver's per-tick events and counts equal the example's trajectory: the timeline is written once, on the contract, and checked by prove
  assert.deepEqual(ex.trajectory.map((t, k) => r.events.filter((e) => e.t === k)), ex.trajectory.map((t) => t.events));
  assert.deepEqual(r.series, ex.trajectory.map((t) => t.counts));
  assert.deepEqual(ex.trajectory.map((t) => t.finished), [false, false, false, false, true]);
  // a mutant that never integrates is reported at the first tick where the trajectory depends on integration (tick 1 starts integrating t2); before v0.5 this check was a list in this test
  const w2 = fresh();
  w2.implement({ id: 'agents.integrate/lazy', implements: 'agents.integrate', run: ({ state }) => ({ state: state.value, events: [] }) });
  w2.select('agents.integrate', 'agents.integrate/lazy');
  const p = w2.prove('agents.tick').find((x) => x.example === 'the tiny world, tick by tick');
  assert.equal(p.ok, false);
  assert.match(p.detail, /tick 1: expected/);
  assert.equal(/\(inputs /.test(p.detail), false, 'v0.6 appends a tick\'s inputs from `each`; this example has none (the tick\'s input is the state, which the example does not repeat per tick)');
  assert.deepEqual([...p.detail.matchAll(/tick (\d): expected/g)].map((m) => +m[1]), [1, 2, 3, 4], 'and the detail lists every wrong tick, not only the first');
});

test('constraints are never violated at any tick (N = 1, 3, 8, both allocators), by oracle and by the kernel verdicts', () => {
  for (const N of [1, 3, 8]) {
    for (const fill of [undefined, EXACT]) {
      const w = fresh();
      const r = runDrive(w, init, config(N), { fill });
      r.states.forEach((s, i) => checkState(s, N, true, i));
      assert.equal(r.verdicts.length, 2 * r.ticks, 'two checks per tick');
      assert.ok(r.verdicts.every((v) => v.accepted), `N=${N}: ${JSON.stringify(r.verdicts.find((v) => !v.accepted))}`);
      assert.ok(r.tickEvents.every((_, i) => r.receipts[i].tick === i));
    }
  }
});

test('with frontier N=1 the number of unintegrated (completed, not yet integrated) tasks never exceeds 1', () => {
  const r = runDrive(fresh(), init, config(1));
  assert.ok(r.series.every((c) => c.done <= 1), 'series');
  assert.ok(r.series.some((c) => c.done === 1), 'the backlog does reach 1, so the test is not vacuous');
  assert.ok(r.series.every((c) => c.running + c.done <= 1), 'N=1 is fully serial under the credit rule');
  assert.equal(r.ticks, 79);
});

test('the literal rule (block only when done >= N) cannot hold N=1, and the kernel check says so at the tick where it breaks', () => {
  const r = runDrive(fresh(), init, config(1, { gate: 'literal' }));
  assert.equal(Math.max(...r.series.map((c) => c.done)), 7);
  const bad = r.verdicts.filter((v) => !v.accepted);
  assert.equal(bad.length, 26);
  assert.ok(bad.every((v) => v.contract === 'agents.capacity'), 'only the backlog check fails; the allocation itself stays feasible');
  assert.deepEqual([bad[0].tick, bad[0].reason], [2, 'done 2 > N 1']);
});

test('determinism: two drives in fresh worlds give identical receipts, and every tick replays alone in a fresh world', () => {
  const a = runDrive(fresh(), init, config(3), { cache: false });
  const b = runDrive(fresh(), init, config(3), { cache: false });
  assert.equal(canonical(a.receipts), canonical(b.receipts));
  const other = fresh();
  for (const k of [0, 1, 5, 17, 35]) {
    const rep = other.replay(a.receipts[k]);
    assert.equal(rep.exact, true, `tick ${k}: ${rep.mismatches.join('; ')}`);
  }
  assert.equal(other.runs().length, 0, 'replay does not append to the run history');
  // the one-call representation replays too (cache off, so it needs the tick calls: 565 > the default would be fine, 2000 is room)
  const sim = runSimulate(fresh(), init, config(3), { cache: false });
  const rep = other.replay(sim.receipt, { maxCalls: 2000 });
  assert.equal(rep.exact, true, rep.mismatches.join('; '));
});

test('greedy and exact both finish all 16 tasks, each started once, each integrated once, 8 revealed after their parent completes', () => {
  for (const [N, fill] of [[1, undefined], [3, undefined], [8, undefined], [1, EXACT], [3, EXACT], [8, EXACT]]) {
    const r = runDrive(fresh(), init, config(N), { fill });
    const last = r.states.at(-1);
    assert.ok(last.tasks.every((t) => t.status === 'integrated'), `N=${N} ${fill ? 'exact' : 'greedy'}`);
    assert.equal(last.tasks.length, 16);
    for (const kindName of ['assign', 'complete', 'integrateStart', 'integrated']) {
      const ids = r.events.filter((e) => e.kind === kindName).map((e) => e.task);
      assert.equal(ids.length, 16); assert.equal(new Set(ids).size, 16);
    }
    const reveals = r.events.filter((e) => e.kind === 'reveal');
    assert.equal(reveals.length, 8);
    for (const e of reveals) {
      assert.equal(r.events.find((x) => x.kind === 'complete' && x.task === e.by).t, e.t);
      assert.ok(r.events.find((x) => x.kind === 'assign' && x.task === e.task).t >= e.t, `${e.task} started before it was revealed`);
    }
  }
});

test('integration is serial, takes integrationTicks, and the first completed task goes first', () => {
  const r = runDrive(fresh(), init, config(3, { integrationTicks: 3 }));
  const starts = r.events.filter((e) => e.kind === 'integrateStart');
  const ends = r.events.filter((e) => e.kind === 'integrated');
  starts.forEach((s, i) => { assert.equal(ends[i].task, s.task); assert.equal(ends[i].t - s.t, 3); if (i) assert.ok(s.t >= ends[i - 1].t); });
  assert.equal(starts[0].task, r.events.filter((e) => e.kind === 'complete')[0].task);
});

test('integration is the throughput bottleneck: back-to-back from tick 3 to 35, and more workers or a bigger N barely help', () => {
  const run = (cfg, fill) => runDrive(fresh(), init, cfg, { fill });
  const n3 = run(config(3)); const n8 = run(config(8)); const n1 = run(config(1));
  const integ = (r) => { const s = r.events.filter((e) => e.kind === 'integrateStart'); const e = r.events.filter((e2) => e2.kind === 'integrated'); return s.map((x, i) => [x.t, e[i].t]); };
  const iv3 = integ(n3);
  assert.deepEqual([iv3[0][0], iv3.at(-1)[1]], [3, 35]);
  iv3.slice(1).forEach(([s], i) => assert.equal(s, iv3[i][1], 'no idle gap between consecutive integrations'));
  const firstComplete = (r) => r.events.find((e) => e.kind === 'complete').t;
  for (const [r, name] of [[n3, 'N=3'], [n8, 'N=8']]) assert.ok(r.ticks >= firstComplete(r) + 16 * 2, `${name}: 16 integrations x 2 ticks after the first completion is a lower bound`);
  assert.deepEqual([n1.ticks, n3.ticks, n8.ticks], [79, 36, 35]);
  assert.equal(n3.ticks - n8.ticks, 1, 'five more agents in flight at once buys one tick');
  // ablation: halve the integration time and the run shortens by far more than any worker-side change did
  const quick = run(config(3, { integrationTicks: 1 }));
  assert.ok(quick.ticks < 25 && quick.ticks >= 3 + 16, `integrationTicks 1: ${quick.ticks}`);
  // idle workers: with N=3 only six agents ever work, never helper h4 or any orchestrator
  assert.deepEqual([...new Set(n3.events.filter((e) => e.kind === 'assign').map((e) => e.agent))].sort(), ['h1', 'h2', 'h3', 'sA', 'sB', 'sC']);
});

test('the orchestrator cap bites: N=8 lends exactly one orchestrator at tick 0 and never more than 2 at once', () => {
  const r = runDrive(fresh(), init, config(8));
  const lent = r.events.filter((e) => e.kind === 'assign' && e.agent.startsWith('o'));
  assert.deepEqual(lent.map((e) => `${e.task}->${e.agent}@${e.t}`), ['b2->o2@0']);
  const p = fresh().run('agents.allocate', { idle: init.agents.filter((a) => a.id[0] === 'o').map(({ id, kind, stream }) => ({ id, kind, stream })),
    ready: [{ id: 't1', stream: 'A', cost: 3 }, { id: 't2', stream: 'B', cost: 2 }, { id: 't3', stream: 'C', cost: 1 }],
    constraints: { maxStarts: 9, maxOrchestratorsBusy: 2, orchestratorsBusy: 1 } });
  assert.equal(p.outputs.assignments.length, 1, 'one orchestrator already busy: only one more may be lent');
});

test('greedy is strictly worse than exact on a contested input; both are feasible by the kernel check; exact is never worse on 300 seeded random cases', () => {
  const w = fresh();
  const contested = { idle: [{ id: 'hB', kind: 'helper', stream: 'B' }, { id: 'oA', kind: 'orchestrator', stream: 'A' }],
    ready: [{ id: 't1', stream: 'A', cost: 5 }, { id: 't2', stream: 'B', cost: 4 }], constraints: { maxStarts: 2, maxOrchestratorsBusy: 2, orchestratorsBusy: 0 } };
  // by hand: greedy t1->hB 1005, t2->oA 704 = 1709; optimum t1->oA 805, t2->hB 1104 = 1909
  assert.equal(w.run('agents.allocate', contested).outputs.score, 1709);
  assert.equal(w.run('agents.allocate', contested, { fill: EXACT }).outputs.score, 1909);
  let s = 12345; const rnd = (n) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) % n; };
  let better = 0;
  for (let k = 0; k < 300; k += 1) {
    const idle = Array.from({ length: 1 + rnd(7) }, (_, i) => ({ id: `g${i}`, kind: ['strong', 'helper', 'orchestrator'][rnd(3)], stream: 'ABC'[rnd(3)] }));
    const ready = Array.from({ length: 1 + rnd(6) }, (_, i) => ({ id: `t${i}`, stream: 'ABC'[rnd(3)], cost: 1 + rnd(5) }));
    const constraints = { maxStarts: rnd(7), maxOrchestratorsBusy: 2, orchestratorsBusy: rnd(3) };
    const input = { idle, ready, constraints };
    const g = w.run('agents.allocate', input, { cache: false });
    const e = w.run('agents.allocate', input, { cache: false, fill: EXACT });
    for (const out of [g, e]) {
      const chk = w.run('agents.evaluate', { ...input, assignments: out.outputs.assignments });
      assert.equal(chk.outputs.accepted, true, JSON.stringify(input));
      assert.deepEqual(chk.receipt.verdicts.map((v) => v.accepted), [true]);
      assert.equal(chk.outputs.score, out.outputs.score);
    }
    assert.ok(e.outputs.score >= g.outputs.score, JSON.stringify(input));
    if (e.outputs.score > g.outputs.score) better += 1;
  }
  assert.ok(better > 0, 'greedy loses somewhere in the random sample');
});

test('a rejecting check is a successful run with a verdict; commit refuses it with a NAMED code (was IMPL_ERROR in round 2), and the failed receipt keeps that verdict', () => {
  const w = fresh();
  const bad = { idle: [{ id: 'sB', kind: 'strong', stream: 'B' }], ready: [{ id: 'tA', stream: 'A', cost: 3 }], constraints: { maxStarts: 1, maxOrchestratorsBusy: 2, orchestratorsBusy: 0 },
    assignments: [{ task: 'tA', agent: 'sB', score: 0 }] };
  const chk = w.run('agents.evaluate', bad);
  assert.equal(chk.outputs.accepted, false);
  assert.equal(chk.trace.kind, 'check');
  assert.deepEqual(chk.receipt.verdicts.map((v) => [v.contract, v.accepted, v.reason]), [['agents.evaluate', false, 'strongOwnStream tA on sB']]);
  const before = w.runs().length;
  assert.throws(() => w.run('agents.commit', { state: init, assignments: bad.assignments, accepted: false, reason: chk.outputs.reason, t: 0 }), (e) => {
    assert.equal(e.trace.error.code, 'ASSIGNMENT_REJECTED'); assert.match(e.trace.error.message, /commit refused: strongOwnStream tA on sB/);
    assert.equal(e.receipt.status, 'failed');
    assert.deepEqual(e.trace.decisions, [{ label: 'assignments accepted', value: false, from: { kind: 'input', call: 1, port: 'accepted' }, ran: 'refuse', skipped: 'start' }], 'the refusal is also a recorded decision, with named branches (v0.4)');
    return true;
  });
  assert.equal(w.runs().length, before + 1);
  assert.equal(w.runs().at(-1).status, 'failed');
});

test('a buggy allocator inside a whole tick: the check says no, commit faults, and the failed receipt of the drive keeps the verdict that explains why', () => {
  const w = fresh();
  // sB (strong, stream B) is given a stream A task: feasible for nobody
  w.implement({ id: 'agents.allocate/bad', implements: 'agents.allocate', run: () => ({ assignments: [{ task: 'a1', agent: 'sB', score: 0 }], score: 0 }) });
  const fill = { 'agents.allocate#primary': 'agents.allocate/bad' };
  let caught;
  try { runDrive(w, init, config(3), { fill }); } catch (e) { caught = e; }
  assert.ok(caught, 'the drive throws');
  assert.equal(caught.trace.error.code, 'ASSIGNMENT_REJECTED');
  assert.equal(caught.receipt.status, 'failed'); assert.equal(caught.receipt.tick, 0);
  // round 2: a failed receipt had no verdicts. v0.3: it keeps those that finished before the throw.
  assert.deepEqual(caught.receipt.verdicts.map((v) => [v.contract, v.accepted, v.reason]), [['agents.evaluate', false, 'strongOwnStream a1 on sB']]);
  assert.equal(w.runs().at(-1).status, 'failed');
});

test('slots (v0.3): a fill for a declared slot is valid even when nothing consulted it, a typo is BAD_FILL, and a slot fill steers only its seat', () => {
  const w = fresh();
  const base = runDrive(w, init, config(3), { cache: false });
  // declared by a composition step (`slot: 'primary'`, `slot: 'shadow'`) and by `uses: ['agents.scoreMatrix#scores']`
  const viaSlot = runDrive(w, init, config(3), { cache: false, fill: { 'agents.allocate#primary': 'agents.allocate/exact-dp', 'agents.allocate#shadow': 'agents.allocate/greedy' } });
  const viaContract = runDrive(w, init, config(3), { cache: false, fill: EXACT });
  assert.deepEqual(viaSlot.events, viaContract.events, 'audit is off, so the shadow seat never runs: filling it changes nothing and is not an error');
  // v0.5: the dead fill is no longer silent; the receipt lists the keys that were used, and the shadow key is not among them (FRICTION 21)
  assert.deepEqual(viaSlot.receipts[0].fillConsulted, ['agents.allocate#primary']);
  assert.notDeepEqual(viaSlot.events, base.events, 'the exact allocator on the primary seat does change the schedule');
  for (const typo of ['agents.allocate#primry', 'agents.allocate#shdow']) {
    assert.throws(() => runDrive(w, init, config(3), { cache: false, fill: { [typo]: 'agents.allocate/exact-dp' }, maxTicks: 3 }), (e) => e.code === 'BAD_FILL' && e.message.includes(typo));
  }
  assert.throws(() => w.run('agents.allocate', contested, { fill: { 'agents.scoreMatrix#score': 'agents.scoreMatrix/weights' } }), (e) => e.code === 'BAD_FILL');
  assert.doesNotThrow(() => w.run('agents.allocate', contested, { fill: { 'agents.scoreMatrix#scores': 'agents.scoreMatrix/weights' } }));
});

test('audit seat (v0.6: regret records its inherited run, and each seat says which rung chose it): greedy on the primary seat, exact-dp on the shadow seat by select(contract, impl, slot); regret rejects 5 ticks of the N=3 run, by 10, 10, 10, 9 and 10, and never changes the schedule', () => {
  const w = fresh();
  const plain = runDrive(w, init, config(3), { cache: false });
  const aud = runDrive(w, init, config(3, { audit: true }), { cache: false });
  assert.deepEqual(aud.events, plain.events, 'the shadow is advisory');
  const reg = aud.verdicts.filter((v) => v.contract === 'agents.regret');
  assert.equal(reg.length, 36);
  const lost = reg.filter((v) => !v.accepted);
  assert.deepEqual(lost.map((v) => [v.tick, v.reason]), [
    [0, 'primary 3332 loses 10 to shadow 3342'], [7, 'primary 1103 loses 10 to shadow 1113'], [11, 'primary 1103 loses 10 to shadow 1113'],
    [15, 'primary 1103 loses 9 to shadow 1112'], [19, 'primary 1102 loses 10 to shadow 1112']]);
  // which implementation sat in which seat is in the trace
  const t0 = aud.receipts[0].trace;
  assert.deepEqual(t0.calls.filter((c) => c.contract === 'agents.allocate').map((c) => [c.slot, c.impl]), [['primary', 'agents.allocate/greedy'], ['shadow', 'agents.allocate/exact-dp']]);
  // with audit off the conditional steps are skipped: no node, and a recorded skipped decision
  const off = plain.receipts[0].trace;
  assert.equal(off.calls.filter((c) => c.contract === 'agents.allocate').length, 1);
  assert.deepEqual(off.decisions.map((d) => [d.label, d.value, d.skipped]), [['shadow', false, 'shadow'], ['regret', false, 'regret']]);
  // v0.5 inherited skips: `regret` has no `when` of its own (round 4 restated `audit`); it reads shadow, so its decision records shadow's cause
  assert.deepEqual(off.decisions[1].from, off.decisions[0].from);
  assert.equal(off.decisions[1].from.kind, 'at'); assert.deepEqual(off.decisions[1].from.path, ['audit']);
  // v0.6 (flipped: this was the red test): with audit on, `regret` records a `ran` decision with shadow's cause, so both sides leave the same two rows
  // (round 5 recorded only `shadow` here, and a reader of the root could not tell that regret was conditional: FRICTION 38)
  const onRun = runDrive(w, init, config(3, { audit: true }), { cache: false, maxTicks: 1, allowUnfinished: true });
  const on = onRun.receipts[0].trace;
  assert.deepEqual(on.decisions.map((d) => [d.label, d.value, d.ran]), [['shadow', true, 'shadow'], ['regret', true, 'regret']]);
  assert.deepEqual(on.decisions[1].from, on.decisions[0].from, 'the inherited run carries the producer\'s cause');
  assert.ok(on.calls.some((c) => c.contract === 'agents.regret'), 'and the check node is there');
  // v0.6 chosenBy: the node says which rung chose it (round 5: read off the header text and the select calls)
  const byId = Object.fromEntries(on.calls.filter((c) => c.contract === 'agents.allocate').map((c) => [c.slot, c.chosenBy]));
  assert.deepEqual(byId, { primary: { rung: 'contract select', key: 'agents.allocate' }, shadow: { rung: 'slot select', key: 'agents.allocate#shadow' } });
  // no regret at N = 1 or N = 8
  for (const N of [1, 8]) assert.equal(runDrive(w, init, config(N, { audit: true }), { cache: false }).verdicts.filter((v) => v.contract === 'agents.regret' && !v.accepted).length, 0);
});

test('demand gate (v0.5 else + one): no predicate contract and no typed complement; the branching implementation equals the monolithic one on every run, and the trace shows which rule ran and what it was tested on', () => {
  for (const N of [1, 3, 8]) for (const gate of ['reserve', 'literal']) {
    const a = runDrive(fresh(), init, config(N, { gate }), { cache: false });
    const w = fresh();
    const b = runDrive(w, init, config(N, { gate }), { cache: false, fill: { 'agents.demand': 'agents.demand/credits' } });
    assert.deepEqual(a.events, b.events, `N=${N} ${gate}`);
    assert.deepEqual(a.series, b.series);
  }
  const lit = runDrive(fresh(), init, config(3, { gate: 'literal' }), { cache: false });
  const res = runDrive(fresh(), init, config(3), { cache: false });
  const demandOf = (r) => r.receipts[2].trace.calls.find((c) => c.contract === 'agents.demand');
  assert.equal(demandOf(res).impl, 'agents.demand/gated');
  assert.deepEqual(demandOf(res).calls.map((c) => c.contract), ['agents.demandReserve'], 'the literal branch is skipped: no node; and there is no gateKind box any more (round 3: three children)');
  assert.deepEqual(demandOf(lit).calls.map((c) => c.contract), ['agents.demandLiteral']);
  assert.deepEqual(demandOf(res).decisions.map((d) => [d.label, d.value, d.ran ?? d.skipped]), [['lit', false, 'lit'], ['res', true, 'res']]);
  assert.deepEqual(demandOf(lit).decisions.map((d) => [d.label, d.value, d.ran ?? d.skipped]), [['lit', true, 'lit'], ['res', false, 'res']]);
  // `lit` is a test on the config's gate field, and the compared literal now keeps its value (round 4 printed `eq(..., literal)` for both rules: FRICTION 33)
  const t = demandOf(res).decisions[0].from;
  assert.equal(t.kind, 'test'); assert.equal(t.op, 'eq');
  assert.deepEqual(t.args[0], { kind: 'at', of: { kind: 'input', call: demandOf(res).id, port: 'config' }, path: ['gate'] });
  assert.deepEqual(t.args[1], { kind: 'literal', value: 'literal' });
  // `res` is `else: ['lit']`: derived, never typed; its provenance names the step and carries what decided it (the very same test)
  const e = demandOf(res).decisions[1].from;
  assert.deepEqual([e.kind, e.op, e.steps], ['test', 'else', ['lit']]);
  assert.deepEqual(e.args[0], t, 'the complement points at the condition that skipped lit: the literal gate is written once');
  assert.equal(demandOf(lit).decisions[1].from.args[0].args[1].value, 'literal');
  // the two compositions' steps: one `when` is a test, the other is else (no second typed equality: round 4 had `eq gate 'reserve'`)
  const comp = fresh().contracts().find((c) => c.id === 'agents.demand/gated') ?? null;
  assert.equal(comp, null, 'a composition is an implementation, not a contract');
  assert.ok(!w3('agents.gateKind'), 'the helper contract that only emitted two booleans is deleted');
  function w3(id) { return fresh().contracts().find((c) => c.id === id); }
});

test('one (v0.4, extended in v0.5): overlap the lint can prove fails at assembly; overlap it cannot prove is still AMBIGUOUS_BRANCH at run time, where round 3 first silently took the first', () => {
  const w = fresh();
  const cfgIs = (v) => ({ eq: [{ at: ['$in.config', 'gate'] }, { literal: v }] });
  const cfgNot = (v) => ({ ne: [{ at: ['$in.config', 'gate'] }, { literal: v }] });
  const steps = (lit, res) => [
    { name: 'lit', call: 'agents.demandLiteral', when: lit, bind: { counts: '$in.counts', config: '$in.config' } },
    { name: 'res', call: 'agents.demandReserve', when: res, bind: { counts: '$in.counts', config: '$in.config' } }];
  // v0.5: provable overlap is an assembly error (FRICTION 32 asked for it). An unconditional alternative:
  const noWhen = steps(undefined, cfgIs('reserve')); delete noWhen[0].when;
  assert.throws(() => w.compose({ id: 'agents.demand/uncond', implements: 'agents.demand', steps: noWhen, returns: { limit: { one: ['lit.limit', 'res.limit'] } } }),
    (e) => e.code === 'ASSEMBLY_LINT' && /unconditional/.test(e.message));
  // a condition that implies the other (the second guard restated wrongly as the first one):
  const ready = { gt: [{ at: ['$in.counts', 'ready'] }, { literal: 0 }] };
  assert.throws(() => w.compose({ id: 'agents.demand/implies', implements: 'agents.demand', steps: steps({ and: [cfgIs('literal'), ready] }, cfgIs('literal')), returns: { limit: { one: ['lit.limit', 'res.limit'] } } }),
    (e) => e.code === 'ASSEMBLY_LINT' && /implies/.test(e.message));
  // two equalities of the same path against different literals ARE exclusive, and the lint lets them through; the complement written by hand (`ne`) is accepted too
  assert.doesNotThrow(() => w.compose({ id: 'agents.demand/typed', implements: 'agents.demand', steps: steps(cfgIs('literal'), cfgIs('reserve')), returns: { limit: { one: ['lit.limit', 'res.limit'] } } }));
  // what the lint cannot prove (two `ne` that overlap) still fails only when a run makes both live
  w.compose({ id: 'agents.demand/overlap', implements: 'agents.demand', steps: steps(cfgNot('nothing'), cfgNot('nowhere')), returns: { limit: { one: ['lit.limit', 'res.limit'] } } });
  const input = { counts: { hidden: 0, ready: 4, running: 0, done: 0, integrated: 0, total: 4 }, config: config(3) };
  assert.throws(() => w.run('agents.demand', input, { fill: { 'agents.demand': 'agents.demand/overlap' } }), (e) => e.code === 'AMBIGUOUS_BRANCH');
  // under `first` (round 3) the same overlap passes silently and the literal rule wins
  w.compose({ id: 'agents.demand/overlap-first', implements: 'agents.demand', steps: steps(cfgNot('nothing'), cfgNot('nowhere')), returns: { limit: { first: ['lit.limit', 'res.limit'] } } });
  assert.equal(w.run('agents.demand', input, { fill: { 'agents.demand': 'agents.demand/overlap-first' } }).outputs.limit, 4, 'first runs both and takes the literal one: 4, where reserve says 3');
  // `one` cannot prove the enum exclusive in advance: it learns it per run. An enum with a third value would be NO_BRANCH, but the config schema forbids one.
  assert.throws(() => w.run('agents.demand', { ...input, config: config(3, { gate: 'other' }) }), (e) => e.code === 'INPUT_SCHEMA');
});

test('integrator decisions (ctx.when) reproduce the bottleneck finding from the kernel, not from the events: busy at exactly the ticks strictly inside an integration', () => {
  const r = runDrive(fresh(), init, config(3), { cache: false });
  const fromDecisions = r.receipts.map((rc) => rc.trace.calls.find((c) => c.contract === 'agents.integrate').decisions.find((d) => d.label === 'integrator busy').value);
  // independent derivation from the event log: an integration that starts at s and ends at e keeps the integrator busy at ticks s+1 .. e-1
  const starts = r.events.filter((e) => e.kind === 'integrateStart'); const ends = r.events.filter((e) => e.kind === 'integrated');
  const busyTicks = new Set(); starts.forEach((s, i) => { for (let t = s.t + 1; t < ends[i].t; t += 1) busyTicks.add(t); });
  assert.deepEqual(fromDecisions.map((b, t) => (b ? t : null)).filter((t) => t !== null), [...busyTicks].sort((a, b) => a - b));
  assert.equal(busyTicks.size, 16, 'one busy tick inside each of the 16 two-tick integrations');
  // v0.4: the decision is a test over the incoming state's integrator.task, with named branches; round 3 recorded `computed`
  const d4 = r.receipts[4].trace.calls.find((c) => c.contract === 'agents.integrate').decisions[0];
  assert.deepEqual([d4.label, d4.value, d4.ran, d4.skipped, d4.from.kind, d4.from.op], ['integrator busy', true, 'busy', 'free', 'test', 'ne']);
  assert.deepEqual(d4.from.args[0].path, ['integrator', 'task']);
  // and it survives the cache: a second drive's hit roots carry the decisions of the original subtree (v0.4; round 3 lost them)
  const w2 = fresh(); runDrive(w2, init, config(3)); const again = runDrive(w2, init, config(3));
  assert.ok(again.receipts.every((rc) => rc.trace.cached));
  assert.deepEqual(again.receipts.map((rc) => rc.trace.decisions), r.receipts.map((rc) => rc.trace.decisions), 'the tick root carries its decisions (shadow, regret skipped) through a hit');
  // integrate's other decision: from tick 4 to 34 something is always waiting or being integrated; before tick 3 nothing has completed
  const waits = r.receipts.map((rc) => rc.trace.calls.find((c) => c.contract === 'agents.integrate').decisions.find((d) => d.label === 'a completed task waits')?.value);
  assert.deepEqual(waits.slice(0, 3), [false, false, false]);
});

test('drive: each tick is a run; state is a cross-run Ref; the receipt carries the tick; the clock is ctx.tick(), a cache dependency and NOT impurity (flipped from round 2)', () => {
  const r = runDrive(fresh(), init, config(3));
  assert.deepEqual(r.receipts[0].trace.in.state.from, { kind: 'input', call: 0, port: 'state' });
  r.receipts.slice(1).forEach((rc, k) => {
    assert.equal(rc.tick, k + 1);
    assert.deepEqual(rc.trace.in.state.from, { kind: 'run', run: r.receipts[k].runId, from: { kind: 'call', call: 1, port: 'state' } });
    assert.equal(rc.trace.in.state.hash, r.receipts[k].trace.out.state.hash);
  });
  // every event is stamped with the tick of the receipt that produced it
  r.receipts.forEach((rc, k) => assert.ok(r.tickEvents[k].every((e) => e.t === k)));
  assert.equal(fresh().run('agents.clock', {}).outputs.tick, -1, 'outside a drive there is no tick');
  // round 2 asserted impure === true on all 36 ticks (the pure:false workaround). Now nothing is impure.
  assert.ok(r.receipts.every((rc) => rc.impure === false), 'no tick is impure');
  assert.ok(r.receipts.every((rc) => rc.trace.calls[0].impure !== true));
  assert.ok(r.receipts.every((rc) => rc.trace.cached === false), 'first drive: nothing to hit at the root');
});

test('tick dependency: the round 2 stale-clock reproduction (FRICTION 11) answers per tick, and a second drive hits every tick root with its verdicts', () => {
  // the reproduction, verbatim from FRICTION 11 (round 2 printed seen = [0,0,0,0] and root cached = [false,true,true,true])
  const w = createWorld();
  const int = { type: 'integer' };
  w.contract({ id: 'now', in: {}, out: { t: int } });
  w.implement({ id: 'now/1', implements: 'now', run: (_, ctx) => ({ t: ctx.tick() ?? -1 }) });
  w.contract({ id: 'tk', kind: 'tick', in: { state: int }, out: { state: int, seen: int } });
  w.implement({ id: 'tk/1', implements: 'tk', uses: ['now'], run: ({ state }, ctx) => ({ state: state.value, seen: ctx.call('now', {}).t.value }) });
  const d = w.drive('tk', { state: 5 }, { ticks: 4 });
  assert.deepEqual(d.receipts.map((rc) => w.part(rc.outputs.seen)), [0, 1, 2, 3]);
  assert.deepEqual(d.receipts.map((rc) => rc.trace.cached), [false, false, false, false]);
  assert.deepEqual(w.run('now', {}).outputs, { t: -1 }, 'a run outside any drive is no longer answered from a tick-0 entry');
  // and in the agents world: a second identical drive is 36 root hits, with all 72 verdicts carried and marked cached
  const aw = fresh();
  const first = runDrive(aw, init, config(1, { gate: 'literal' }));
  const second = runDrive(aw, init, config(1, { gate: 'literal' }));
  assert.equal(second.receipts.filter((rc) => rc.trace.cached).length, second.ticks);
  assert.deepEqual(second.events, first.events);
  assert.equal(second.verdicts.length, first.verdicts.length);
  assert.ok(second.verdicts.every((v) => v.cached === true), 'every verdict of the second drive is a carried one');
  assert.ok(first.verdicts.some((v) => !v.cached) && first.verdicts.some((v) => v.cached), 'the first drive mixes fresh verdicts with ones carried by sub-call hits');
  assert.equal(second.verdicts.filter((v) => !v.accepted).length, 26, 'the 26 literal-gate rejections survive the cache');
  assert.ok(second.receipts.every((rc) => rc.calls === 1), 'a hit is one call');
});

test('concat and collect (v0.4): a tick\'s events are a { concat } of three calls; the whole run\'s events are collected by ctx.drive and each keeps the tick it came from, so no log rides in the state', () => {
  const r = runDrive(fresh(), init, config(3));
  const rc = r.receipts[4];
  const from = rc.trace.out.events.from;
  assert.equal(from.kind, 'gather');
  const byId = new Map(rc.trace.calls.map((c) => [c.id, c.contract]));
  assert.equal(from.pieces.length, r.tickEvents[4].length);
  assert.ok(from.pieces.every((p) => p.from.kind === 'at' && p.from.of.port === 'events' && ['agents.advance', 'agents.integrate', 'agents.commit'].includes(byId.get(p.from.of.call))));
  // round 3 carried a `log` in the state (and 'sim' beside it); the state is the plain world again
  assert.deepEqual(Object.keys(r.states[4]).sort(), ['agents', 'integrator', 'tasks']);
  // simulate: the ONE call collects every tick's events
  const w = fresh();
  const s = runSimulate(w, init, config(3));
  assert.deepEqual(s.events, r.events, 'the same 72 events as the driver\'s flat-map of the receipts');
  assert.equal(s.events.length, 72);
  const drive = s.trace.drives[0];
  assert.deepEqual([drive.contract, drive.startTick, drive.ticks, drive.stopped, drive.calls.length], ['agents.tick', 0, 36, 'until', 36]);
  // every output event is `at [j]` of `at [k]` of ONE gather whose piece k is the events port of the call that ran tick k
  const pieces = s.trace.out.events.from.pieces;
  assert.equal(pieces.length, 72);
  const gather = pieces[0].from.of.of;
  assert.equal(gather.kind, 'gather'); assert.equal(gather.pieces.length, 36);
  assert.deepEqual(gather.pieces.map((g) => g.from.call), drive.calls, 'piece k is the call of tick k');
  assert.ok(pieces.every((p, i) => p.from.kind === 'at' && p.from.of.kind === 'at' && p.from.of.of === gather || JSON.stringify(p.from.of.of) === JSON.stringify(gather)), 'one shared gather');
  const tickOf = pieces.map((p) => p.from.of.path[0]);
  assert.deepEqual(tickOf, r.tickEvents.flatMap((ev, k) => ev.map(() => k)), 'event i belongs to the tick it was made in');
});

test('ctx.drive: the whole simulation in ONE run (the round 1 big run, impossible in round 2); each tick is a child tagged with its tick; same events as world.drive', () => {
  for (const [N, gate] of [[1, 'reserve'], [3, 'reserve'], [8, 'reserve'], [1, 'literal']]) {
    const d = runDrive(fresh(), init, config(N, { gate }), { cache: false });
    const s = runSimulate(fresh(), init, config(N, { gate }), { cache: false });
    assert.deepEqual(s.events, d.events, `N=${N} ${gate}`);
    assert.equal(s.ticks, d.ticks);
    assert.deepEqual(s.trace.calls.map((c) => c.tick), Array.from({ length: d.ticks }, (_, k) => k), 'one child per tick, tagged @k');
    assert.deepEqual(s.receipt.verdicts.map((v) => [v.contract, v.accepted]), d.verdicts.map((v) => [v.contract, v.accepted]), 'the verdicts of every tick reach the one receipt');
    // the clock inside the fold is the fold's tick: every event is stamped with the tick of the child that made it
    assert.ok(s.events.every((e) => Number.isInteger(e.t) && e.t < s.ticks));
  }
  const w = fresh();
  const s = runSimulate(w, init, config(3), { cache: false });
  const sumTicks = runDrive(fresh(), init, config(3), { cache: false }).receipts.reduce((n, rc) => n + rc.calls, 0);
  assert.equal(s.receipt.calls, sumTicks + 1, 'the one run holds exactly the calls of the 36 tick runs plus its own root');
  assert.equal(s.receipt.impure, false);
});

test('ctx.drive and the tick dependency: the call around the drive is cacheable, and a later world.drive reuses all 36 tick entries the fold made', () => {
  const w = fresh();
  const a = runSimulate(w, init, config(3));
  assert.equal(a.trace.cached, false);
  const b = runSimulate(w, init, config(3));
  assert.equal(b.trace.cached, true, 'the tick reads stay inside the drive, so the outer call is a hit');
  assert.equal(b.receipt.verdicts.length, 72); assert.ok(b.receipt.verdicts.every((v) => v.cached));
  assert.deepEqual(b.events, a.events);
  // fresh world: simulate, then world.drive. Every tick root of the drive is a hit on a child of the simulate run.
  const w2 = fresh();
  const sim = runSimulate(w2, init, config(3));
  const drv = runDrive(w2, init, config(3));
  assert.equal(drv.receipts.filter((rc) => rc.trace.cached).length, 36);
  drv.receipts.forEach((rc, k) => {
    const src = w2.node(rc.trace.cachedFrom.run, rc.trace.cachedFrom.call);
    assert.equal(rc.trace.cachedFrom.run, sim.receipt.runId); assert.equal(src.contract, 'agents.tick'); assert.equal(src.tick, k);
  });
  assert.deepEqual(drv.events, sim.events);
});

test('world.ref and startTick (v0.4): a drive resumed from any recorded tick continues the clock, so the resumed events ARE the original ones (round 3 shifted them by 18)', () => {
  const w = fresh();
  const full = runDrive(w, init, config(3));
  const k = 17;
  const resumed = w.drive('agents.tick', { state: w.ref(full.receipts[k].runId, 1, 'state'), config: config(3) }, { until: (o) => o.finished, startTick: k + 1 });
  assert.deepEqual(resumed.receipts[0].trace.in.state.from, { kind: 'run', run: full.receipts[k].runId, from: { kind: 'call', call: 1, port: 'state' } });
  assert.deepEqual(resumed.receipts.map((rc) => rc.tick), Array.from({ length: full.ticks - (k + 1) }, (_, i) => k + 1 + i));
  assert.equal(resumed.ticks, full.ticks - (k + 1));
  const resumedEvents = resumed.receipts.flatMap((rc) => w.part(rc.outputs.events));
  const done = full.tickEvents.slice(0, k + 1).flat().length;
  assert.deepEqual(resumedEvents, full.events.slice(done), 'the new part is the original tail, unshifted');
  assert.deepEqual(w.part(resumed.receipts.at(-1).outputs.state), full.states.at(-1), 'and ends in the same final state');
  // without startTick the old behaviour remains: the clock restarts at 0 and the tail is shifted
  const restarted = w.drive('agents.tick', { state: w.ref(full.receipts[k].runId, 1, 'state'), config: config(3) }, { until: (o) => o.finished });
  assert.notDeepEqual(restarted.receipts.flatMap((rc) => w.part(rc.outputs.events)), full.events.slice(done));
});

test('slots: the two measure calls of a tick carry their call-site names, and the allocate seat is called primary', () => {
  const r = runDrive(fresh(), init, config(3));
  const slots = r.receipts[2].trace.calls.filter((c) => c.contract === 'agents.measure').map((c) => c.slot);
  assert.deepEqual(slots, ['before', 'after']);
  const alloc = r.receipts[0].trace.calls.find((c) => c.contract === 'agents.allocate');
  assert.equal(alloc.slot, 'primary');
  assert.equal(alloc.calls[0].slot, 'scores');
});

test('demand supplied by drive.each is lagged by one tick, so it finishes later than demand computed inside the tick', () => {
  // Experiment: the same tick with the demand step removed and `limit` an input, filled by each(k, stateValue) from the PREVIOUS tick's state.
  const w = fresh();
  const base = w.contracts().find((c) => c.id === 'agents.tick');
  w.contract({ id: 'agents.tickExt', kind: 'tick', in: { ...base.in, limit: { type: 'integer' } }, out: base.out });
  w.compose({ id: 'agents.tickExt/pipeline', implements: 'agents.tickExt',
    steps: [
      { name: 'now', call: 'agents.clock', bind: {} },
      { name: 'adv', call: 'agents.advance', bind: { state: '$in.state', t: 'now.tick' } },
      { name: 'integ', call: 'agents.integrate', bind: { state: 'adv.state', config: '$in.config', t: 'now.tick' } },
      { name: 'view', call: 'agents.frontier', bind: { state: 'integ.state', limit: '$in.limit', config: '$in.config' } },
      { name: 'alloc', call: 'agents.allocate', bind: { idle: 'view.idle', ready: 'view.ready', constraints: 'view.constraints' } },
      { name: 'check', call: 'agents.evaluate', bind: { idle: 'view.idle', ready: 'view.ready', constraints: 'view.constraints', assignments: 'alloc.assignments' } },
      { name: 'commit', call: 'agents.commit', bind: { state: 'integ.state', assignments: 'alloc.assignments', accepted: 'check.accepted', reason: 'check.reason', t: 'now.tick' } },
      { name: 'after', call: 'agents.measure', bind: { state: 'commit.state' } },
      { name: 'cap', call: 'agents.capacity', bind: { counts: 'after.counts', config: '$in.config' } },
    ],
    returns: { state: 'commit.state', events: { concat: ['adv.events', 'integ.events', 'commit.events'] }, counts: 'after.counts', finished: 'after.finished' } });
  for (const N of [1, 3]) {
    const inside = runDrive(w, init, config(N));
    // v0.3 hands each() the plain state value at every tick (round 2: a plain value at tick 0 and a Ref afterwards, FRICTION 15)
    const each = (k, s) => { assert.equal(s.value, undefined, 'a plain value, never a Ref'); const c = { done: 0, running: 0 }; for (const t of s.tasks) if (t.status in c) c[t.status] += 1; return { limit: Math.max(0, N - c.done - c.running) }; };
    const outside = w.drive('agents.tickExt', { state: init, config: config(N), limit: 0 }, { each, until: (o) => o.finished, maxTicks: 500 });
    const doneMax = Math.max(...outside.receipts.map((rc) => w.part(rc.outputs.counts).done));
    assert.ok(doneMax <= N, 'stale demand is conservative, so the cap still holds');
    assert.ok(outside.ticks > inside.ticks, `N=${N}: each-demand ${outside.ticks} ticks vs in-tick demand ${inside.ticks}`);
    // and the kernel records the limit as an unexplained input value
    assert.deepEqual(outside.receipts[3].trace.in.limit.from, { kind: 'input', call: 0, port: 'limit' });
  }
});

test('nested clocks: a tick folded with ctx.drive inside a world.drive tick reads the INNER tick; the outer tick is invisible to it (FRICTION 24)', () => {
  const w = createWorld(); const int = { type: 'integer' };
  w.contract({ id: 'now', in: {}, out: { t: int } });
  w.implement({ id: 'now/1', implements: 'now', run: (_, ctx) => ({ t: ctx.tick() }) });
  w.contract({ id: 'inner', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'inner/1', implements: 'inner', uses: ['now'], run: ({ state }, ctx) => ({ state: state.value * 10 + ctx.call('now', {}).t.value }) });
  w.contract({ id: 'outer', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'outer/1', implements: 'outer', uses: ['inner'], run: ({ state }, ctx) => ({ state: ctx.drive('inner', { state }, { ticks: 2 }).state }) });
  const d = w.drive('outer', { state: 1 }, { ticks: 3 });
  // every outer tick folds two inner ticks that read 0 and 1; the outer ticks 0, 1, 2 leave no trace in the number
  assert.deepEqual(d.receipts.map((rc) => w.part(rc.outputs.state)), [101, 10101, 1010101]);
});

test('implementation parameters (FRICTION 7, now more costly): a knob outside the cache key is served stale for whole ticks, 36 root hits at a time; making it an implementation fixes it', () => {
  const w = fresh();
  const knob = { strong: 10, affinity: 100 };
  // the same scoring as agents.scoreMatrix/weights, but reading a mutable parameter that no hash contains
  w.implement({ id: 'agents.scoreMatrix/knob', implements: 'agents.scoreMatrix', run: ({ idle: ag, ready: tk }) => ({
    scores: tk.value.map((t) => ag.value.map((a) => (a.kind === 'strong' && a.stream !== t.stream ? null
      : 1000 + (a.kind === 'orchestrator' ? -300 : 0) + (a.stream === t.stream ? knob.affinity : 0) + (a.kind === 'strong' ? knob.strong : 0) + t.cost))) }) });
  const fill = { 'agents.scoreMatrix': 'agents.scoreMatrix/knob' };
  const a = runDrive(w, init, config(3), { fill });
  knob.strong = 0; knob.affinity = 0;
  const stale = runDrive(w, init, config(3), { fill });
  const truth = runDrive(w, init, config(3), { fill, cache: false });
  assert.equal(stale.receipts.filter((rc) => rc.trace.cached).length, 36, 'every tick root is a hit');
  assert.deepEqual(stale.events, a.events, 'so the old knob values answer');
  assert.notDeepEqual(truth.events, a.events, 'while the knob as it is now gives another schedule');
  // the knob as an implementation: a different choice is a different cache dependency, so nothing stale is served
  w.implement({ id: 'agents.scoreMatrix/flat', implements: 'agents.scoreMatrix', run: ({ idle: ag, ready: tk }) => ({
    scores: tk.value.map((t) => ag.value.map((x) => (x.kind === 'strong' && x.stream !== t.stream ? null : 1000 + (x.kind === 'orchestrator' ? -300 : 0) + t.cost))) }) });
  const viaImpl = runDrive(w, init, config(3), { fill: { 'agents.scoreMatrix': 'agents.scoreMatrix/flat' } });
  assert.equal(viaImpl.receipts.filter((rc) => rc.trace.cached).length, 0);
  assert.deepEqual(viaImpl.events, truth.events);
});

test('path slots (v0.4, flipped in v0.5: a path fill must land): a fill can reach the scoreMatrix under the shadow seat only; the primary seat and the checker keep theirs, and the cache does not serve the old entry', () => {
  const w = fresh();
  w.implement({ id: 'agents.scoreMatrix/flat', implements: 'agents.scoreMatrix', run: ({ idle: ag, ready: tk }) => ({
    scores: tk.value.map((t) => ag.value.map((x) => (x.kind === 'strong' && x.stream !== t.stream ? null : 1000 + (x.kind === 'orchestrator' ? -300 : 0) + t.cost))) }) });
  const KEY = 'agents.allocate#shadow/agents.scoreMatrix#scores';
  const plain = runDrive(w, init, config(3, { audit: true }));   // fills the cache with weights entries first
  const reached = runDrive(w, init, config(3, { audit: true }), { fill: { [KEY]: 'agents.scoreMatrix/flat' } });
  // v0.6: receipt.fillReach answers "which calls did this key choose for" (round 5 walked the trace to rebuild the seat table). Tick 0 is a MISS root in both drives.
  const flatKey = runDrive(w, init, config(3, { audit: true }), { fill: { 'agents.scoreMatrix#scores': 'agents.scoreMatrix/flat' }, maxTicks: 1, cache: false, allowUnfinished: true });
  const all3 = flatKey.receipts[0].fillReach['agents.scoreMatrix#scores'];
  assert.equal(all3.length, 3, 'the flat key hits all three call sites at once (primary, shadow, checker)');
  const nodeOf = (r, id) => w.node(r.receipts[0].runId, id);
  assert.deepEqual(plain.receipts[0].fillReach, {}, 'no fill, no reach');
  const reachedIds = reached.receipts[0].fillReach[KEY];
  assert.equal(reachedIds.length, 1, 'the path reaches exactly one call: the scoreMatrix under the shadow seat');
  assert.ok(all3.includes(reachedIds[0]));
  assert.deepEqual([nodeOf(reached, reachedIds[0]).impl, nodeOf(reached, reachedIds[0]).chosenBy], ['agents.scoreMatrix/flat', { rung: 'path fill', key: KEY }]);
  const others = all3.filter((id) => id !== reachedIds[0]);
  for (const id of others) assert.deepEqual([nodeOf(reached, id).impl, nodeOf(reached, id).chosenBy.rung], ['agents.scoreMatrix/weights', 'contract select'], 'the primary seat and the checker keep theirs');
  for (const id of all3) assert.equal(nodeOf(plain, id).impl, 'agents.scoreMatrix/weights');
  assert.deepEqual(reached.events, plain.events, 'the primary seat decides the schedule, so it is untouched');
  // the shadow now scores on another scale, so the regret check reads 0 rejections where the plain audit had 5: a path fill can make the audit meaningless
  assert.equal(plain.verdicts.filter((v) => v.contract === 'agents.regret' && !v.accepted).length, 5);
  assert.equal(reached.verdicts.filter((v) => v.contract === 'agents.regret' && !v.accepted).length, 0);
  // v0.5: a path fill must land. With audit off the shadow seat is skipped in every tick, so nothing is ever called under it: BAD_FILL, where v0.4 accepted it
  // silently (the red test of this round). A flat slot key for the same dead seat stays valid (standing configuration), see the slots test.
  assert.throws(() => runDrive(w, init, config(3), { fill: { [KEY]: 'agents.scoreMatrix/flat' }, maxTicks: 2, cache: false, allowUnfinished: true }),
    (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message) && e.message.includes(KEY));
  // it lands as soon as the seat runs, and the receipt says so
  const landed = runDrive(w, init, config(3, { audit: true }), { fill: { [KEY]: 'agents.scoreMatrix/flat' }, maxTicks: 1, cache: false, allowUnfinished: true });
  assert.deepEqual(landed.receipts[0].fillConsulted, [KEY]);
  // a typo in any segment is BAD_FILL; a longer path beats the flat key
  assert.throws(() => runDrive(w, init, config(3), { fill: { 'agents.allocate#shadow/agents.scoreMatrix#score': 'agents.scoreMatrix/flat' }, maxTicks: 2, cache: false, allowUnfinished: true }), (e) => e.code === 'BAD_FILL');
  const both = runDrive(w, init, config(3, { audit: true }), { fill: { 'agents.scoreMatrix#scores': 'agents.scoreMatrix/weights', [KEY]: 'agents.scoreMatrix/flat' }, maxTicks: 1, cache: false, allowUnfinished: true });
  assert.deepEqual(both.receipts[0].fillReach[KEY], reachedIds);
  assert.deepEqual(both.receipts[0].fillReach['agents.scoreMatrix#scores'], others, 'the longer path takes the shadow seat; the flat key keeps the other two');
});

test('a path fill must land (v0.5) and landing: \'none\' (v0.6) lets ONE fill set serve both demand gates', () => {
  const w = fresh();
  w.implement({ id: 'agents.demandLiteral/greedy', implements: 'agents.demandLiteral', run: ({ counts }) => ({ limit: counts.value.ready }) });
  w.select('agents.demandLiteral', 'agents.demandLiteral/done');   // a second implementation makes the contract AMBIGUOUS for every other caller, so it is pinned again (FRICTION 35)
  const KEY = 'agents.demand/agents.demandLiteral';
  const fill = { [KEY]: 'agents.demandLiteral/greedy' };
  const go = (gate, extra = {}) => runDrive(w, init, config(1, { gate }), { fill, cache: false, maxTicks: 3, allowUnfinished: true, ...extra });
  // gate = literal: the literal rule runs, the fill lands
  const lit = go('literal');
  assert.deepEqual(lit.receipts[0].fillConsulted, [KEY]);
  // default landing ('path'): gate = reserve never calls the literal rule, so the same fill is BAD_FILL (round 5: the sweep had to build a fill per gate)
  assert.throws(() => go('reserve'), (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message));
  // v0.6 landing: 'none': the author says "this is a sweep", and ONE fill table serves both gates; the receipts say where it landed
  const sweep = ['literal', 'reserve'].map((gate) => go(gate, { landing: 'none' }));
  assert.equal(sweep[0].receipts[0].fillReach[KEY].length, 1, 'literal: it reached the literal rule\'s node');
  assert.equal(nodeLandsOn(w, sweep[0], KEY).chosenBy.rung, 'path fill');
  assert.deepEqual(sweep[1].receipts.map((r) => r.fillReach[KEY] ?? []), [[], [], []], 'reserve: it reached nothing, in every tick, and that is not an error');
  // 'all' is the strict game: every key must land, in every mode a typo still fails
  assert.throws(() => go('reserve', { landing: 'all' }), (e) => e.code === 'BAD_FILL');
  const nonePlay = (key) => runDrive(w, init, config(1), { fill: { [key]: 'agents.demandLiteral/greedy' }, landing: 'none', maxTicks: 2, cache: false, allowUnfinished: true });
  assert.throws(() => nonePlay('agents.demandLiteral#nobody'), (e) => e.code === 'BAD_FILL', 'a flat slot typo is a typo in every game');
  assert.throws(() => nonePlay('agents.nope/agents.demandLiteral'), (e) => e.code === 'BAD_FILL', 'so is a contract that does not exist, in any segment');
  // What v0.6 does NOT catch (FRICTION 42): a slot name that does not exist INSIDE a path segment. Under 'none' it is indistinguishable from a sweep that missed.
  assert.doesNotThrow(() => nonePlay('agents.demand/agents.demandLiteral#nobody'));
  assert.doesNotThrow(() => nonePlay('agents.demand#nobody/agents.demandLiteral'));
  assert.throws(() => runDrive(w, init, config(1), { fill: { 'agents.demand#nobody/agents.demandLiteral': 'agents.demandLiteral/greedy' }, maxTicks: 2, cache: false, allowUnfinished: true }), (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message), 'under the default landing the same typo is caught, but only as "reached no call"');
  assert.throws(() => go('literal', { landing: 'some' }), (e) => e.code === 'BAD_OPTION');
  function nodeLandsOn(world, r, key) { return world.node(r.receipts[0].runId, r.receipts[0].fillReach[key][0]); }
});

test('specificity (v0.5) with chosenBy and fillReach (v0.6): a contract fill does not reach the shadow seat\'s pin, `contract#*` does; each seat says which rung chose it', () => {
  const w = fresh();
  const GREEDY = 'agents.allocate/greedy';
  const regrets = (r) => r.verdicts.filter((v) => v.contract === 'agents.regret' && !v.accepted).length;
  const seat = (r, id) => { const n = w.node(r.receipts[0].runId, id); return [n.slot, n.impl, n.chosenBy]; };
  // the shadow seat is `select(allocate, exact-dp, 'shadow')`. A contract-wide fill is a sweep over seats that have no pin of their own:
  const sweep = runDrive(w, init, config(3, { audit: true }), { fill: { 'agents.allocate': GREEDY }, cache: false });
  const [primary] = sweep.receipts[0].fillReach['agents.allocate'];
  assert.equal(sweep.receipts[0].fillReach['agents.allocate'].length, 1, 'the contract fill reached the primary seat only');
  assert.deepEqual(seat(sweep, primary), ['primary', GREEDY, { rung: 'contract fill', key: 'agents.allocate' }]);
  const shadow = primary + 2;   // the tick has frontier (#8) before primary (#9), shadow follows primary's one nested call: read from the picture, asserted by the next line
  assert.deepEqual(seat(sweep, shadow), ['shadow', 'agents.allocate/exact-dp', { rung: 'slot select', key: 'agents.allocate#shadow' }], 'the pin on the shadow seat survives the contract fill, and the node says it is a pin');
  assert.equal(regrets(sweep), 5, 'so the audit still measures greedy against exact-dp (before v0.5 a contract fill was not held off by a pin, ledger seq 46; I did not run that case on v0.4)');
  assert.deepEqual(sweep.receipts[0].fillConsulted, ['agents.allocate']);
  // `contract#*` says "every seat" when that is meant: the shadow is greedy too and the audit is meaningless
  const every = runDrive(w, init, config(3, { audit: true }), { fill: { 'agents.allocate#*': GREEDY }, cache: false });
  assert.deepEqual(every.receipts[0].fillReach['agents.allocate#*'], [primary, shadow]);
  assert.deepEqual(seat(every, shadow), ['shadow', GREEDY, { rung: 'every-slot fill', key: 'agents.allocate#*' }]);
  assert.equal(regrets(every), 0, 'greedy against greedy never regrets');
  assert.deepEqual(every.receipts[0].fillConsulted, ['agents.allocate#*']);
  // a slot fill beats `contract#*`, which beats the shadow pin
  const mixed = runDrive(w, init, config(3, { audit: true }), { fill: { 'agents.allocate#*': GREEDY, 'agents.allocate#shadow': 'agents.allocate/exact-dp' }, cache: false, maxTicks: 1, allowUnfinished: true });
  assert.deepEqual(mixed.receipts[0].fillReach, { 'agents.allocate#*': [primary], 'agents.allocate#shadow': [shadow] });
  assert.deepEqual(seat(mixed, shadow), ['shadow', 'agents.allocate/exact-dp', { rung: 'slot fill', key: 'agents.allocate#shadow' }]);
  // the schedule is the primary seat's in every case
  assert.deepEqual(sweep.events, every.events);
});
