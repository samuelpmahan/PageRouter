// Renders for contest F (round 6: kernel v0.6), all from real drives. Usage: node verify/render-f-agents.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, driveToSvg, traceHtml } from '../src/view.mjs';
import { register, initialState, config, runDrive, runSimulate, contested } from '../contest/f-agents/index.mjs';
import { ganttSvg, countsSvg, decisionSvg, pageHtml, CSS } from '../contest/f-agents/view.mjs';

const outDir = path.resolve(process.argv[2] ?? 'verify/out');
fs.mkdirSync(outDir, { recursive: true });
const world = () => { const w = createWorld({ name: 'f-agents' }); register(w); return w; };
const init = initialState();
const streamOf = (id) => init.tasks.find((t) => t.id === id).stream;
const find = (node, contract) => (node.contract === contract ? node : node.calls.map((c) => find(c, contract)).find(Boolean));
const facts = {};
// Round 6 claims, written BEFORE any PNG of this round was opened (verdicts are in contest/f-agents/EXPLAIN.md):
facts.claims = {
  'F1b': '#9 allocate#primary and #10 scoreMatrix#scores show NO rung text on their implementation lines (a contract select and the only implementation stay silent)',
  'F5b': 'tick root keeps the merged grey row "shadow, regret = false -> skipped"; ids and 15 calls unchanged; no rung text on any child',
  'F7a': 'every piece label on the root events row names its tick (gather[k]<-@k or a group with @): no label without an @',
  'F8': 'hit root: merged skipped row, and ONE line per cached verdict (two lines: evaluate, capacity)',
  'F9a': 'lit row reads eq($in.config[gate]="reserve", "literal"); res reads a short else(lit) with a cause edge',
  'F9b': 'lit row reads eq($in.config[gate]="literal", "literal"): F9a and F9b now differ in text',
  'F9c': 'integrator busy row reads ne($in.state[integrator.task]="a1", null)',
  'F10': 'root shows ONE merged amber row "shadow, regret = true -> ran" (regret now records its run); #11 allocate#shadow line reads by pin agents.allocate#shadow',
  'F11': 'fill line ends with reach "@ #12"; #12 scoreMatrix#scores shows by path fill; #10 and #15 show no rung text',
  'F12a': 'fill line "agents.allocate -> greedy @ #9"; #9 by contract agents.allocate; #11 by pin agents.allocate#shadow; regret X',
  'F12b': 'fill line "agents.allocate#* -> greedy @ #9 #11"; both seats name the every-slot rung; regret green',
  'F12c': 'fill line: primary key with "@ #9", shadow key "(not consulted)" with no reach',
  'F12d': 'one fill table under landing none, gate literal: fill line with "@ #7" and #7 shows by path fill',
  'F12e': 'the same fill table, gate reserve: the key is "(not consulted)", no reach, no error, no child under demand besides demandReserve',
  'F6b': 'tick 2 literal gate N=1: capacity X, demand rows lit ran / res skipped (else), unchanged ids',
  'F6c': 'unchanged: commit red ASSIGNMENT_REJECTED, evaluate X, root red from #12',
};
const inkPage = (svgs) => traceHtml(svgs).replace('<body', `<style>${CSS}</style><body`);

// ---- F1: one allocation decision, real tick 0 of N=3
const w3 = world();
const d3 = runDrive(w3, init, config(3), { cache: false });
const t0 = d3.receipts[0];
const alloc = find(t0.trace, 'agents.allocate');
const sm = alloc.calls.find((c) => c.slot === 'scores');
const dIn = Object.fromEntries(Object.entries(alloc.in).map(([p, v]) => [p, w3.part(v.hash)]));
const dOut = w3.part(alloc.out.assignments.hash);
facts.f1 = { assignments: dOut, idle: dIn.idle.length, ready: dIn.ready.length, constraints: dIn.constraints, allocImpl: alloc.impl, allocSlot: alloc.slot, allocId: alloc.id, scoreMatrixSlot: sm.slot };
fs.writeFileSync(path.join(outDir, 'f-agents-1-decision.html'), pageHtml([
  decisionSvg({ ...dIn, scores: w3.part(sm.out.scores.hash), assignments: dOut, title: 'F1a  tick 0, N = 3: agents.allocate/greedy on the real frontier' }),
  traceToSvg(alloc, w3.part, { title: 'F1b  the same decision as a kernel trace (agents.allocate subtree of the tick-0 run)', valueChars: 140, colWidth: 1060 }),
]));

// ---- F2: greedy and exact fill the same slot on the same input, with a different answer
const wc = world();
const g = wc.run('agents.allocate', contested, { cache: false, fill: { 'agents.allocate': 'agents.allocate/greedy' } });
const e = wc.run('agents.allocate', contested, { cache: false, fill: { 'agents.allocate': 'agents.allocate/exact-dp' } });
const mat = wc.part(g.trace.calls[0].out.scores.hash);
facts.f2 = { greedy: g.outputs, exact: e.outputs, matrix: mat, implExamples: wc.prove('agents.allocate').filter((p) => String(p.example).startsWith('impl:')).map((p) => [p.impl, p.example, p.ok]) };
fs.writeFileSync(path.join(outDir, 'f-agents-2-greedy-vs-exact.html'), pageHtml([
  decisionSvg({ ...contested, scores: mat, assignments: g.outputs.assignments, title: 'F2a  greedy (cost-descending, best agent per task)' }),
  decisionSvg({ ...contested, scores: mat, assignments: e.outputs.assignments, title: 'F2b  exact-dp (optimum over all subsets of agents)' }),
  traceToSvg(g.trace, wc.part, { title: 'F2c  greedy trace', valueChars: 90, colWidth: 740 }), traceToSvg(e.trace, wc.part, { title: 'F2d  exact-dp trace', valueChars: 90, colWidth: 740 }),
]));

// ---- F3: Gantt from drives: N=3, N=1, N=8
const runs = { 3: d3 };
for (const N of [1, 8]) runs[N] = runDrive(world(), init, config(N), { cache: false });
const cachedD3 = runDrive(world(), init, config(3));   // cache on: counts the sub-call hits inside one drive
for (const N of [3, 1, 8]) {
  const r = runs[N];
  facts[`gantt${N}`] = { ticks: r.ticks, peakDone: Math.max(...r.series.map((c) => c.done)), orchestratorAssignments: r.events.filter((x) => x.kind === 'assign' && x.agent.startsWith('o')).map((x) => `${x.task}->${x.agent}@${x.t}`),
    integrationIntervals: r.events.filter((x) => x.kind === 'integrateStart').map((x) => x.t), verdicts: r.verdicts.length, rejected: r.verdicts.filter((v) => !v.accepted).length,
    integratorBusyDecisionTicks: r.receipts.map((rc, k) => (find(rc.trace, 'agents.integrate').decisions.find((d) => d.label === 'integrator busy').value ? k : null)).filter((k) => k !== null).length,
    cacheHitsInDrive: r.receipts.reduce((n, rc) => n + (function count(x) { return (x.cached ? 1 : 0) + x.calls.reduce((m, c) => m + count(c), 0); })(rc.trace), 0), calls: r.receipts.reduce((n, rc) => n + rc.calls, 0) };
}
facts.gantt3.cacheHitsInDriveCacheOn = cachedD3.receipts.reduce((n, rc) => n + (function count(x) { return (x.cached ? 1 : 0) + x.calls.reduce((m, c) => m + count(c), 0); })(rc.trace), 0);
const title = (N, r) => `F3  frontier N = ${N}: ${r.ticks} ticks, 16 tasks, greedy allocator (world.drive over agents.tick)`;
fs.writeFileSync(path.join(outDir, 'f-agents-3-gantt-n3.html'), pageHtml([ganttSvg({ events: runs[3].events, agents: init.agents, streamOf, title: title(3, runs[3]) })]));
fs.writeFileSync(path.join(outDir, 'f-agents-3b-gantt-n1.html'), pageHtml([ganttSvg({ events: runs[1].events, agents: init.agents, streamOf, ppt: 14, title: title(1, runs[1]) })]));
fs.writeFileSync(path.join(outDir, 'f-agents-3c-gantt-n8.html'), pageHtml([ganttSvg({ events: runs[8].events, agents: init.agents, streamOf, title: title(8, runs[8]) })]));

// ---- F4: counts per tick, N=1 and N=3 side by side
fs.writeFileSync(path.join(outDir, 'f-agents-4-counts.html'), pageHtml([countsSvg({ title: 'F4  tasks by state per tick (same axes in both panels)', panels: [
  { label: 'N = 1', capacity: 1, series: runs[1].series }, { label: 'N = 3', capacity: 3, series: runs[3].series }] })]));

// ---- F5: the drive strip (first 12 of 36 ticks) and one tick's trace with slots, gather and the cross-run input
const describe = (state, r) => { const c = w3.part(r.outputs.counts); return `r${c.ready} w${c.running} d${c.done} i${c.integrated}`; };
const strip = driveToSvg(d3.receipts.slice(0, 12), w3.part, { title: 'F5a  world.drive: ticks 0 to 11 of 36 (N = 3). r ready, w running (working), d done-unintegrated, i integrated', describe });
const tick1 = traceToSvg(d3.receipts[1].trace, w3.part, { title: 'F5b  tick 1 (run 2): state arrives from run 1; slots before/after/primary; events is a concat; two checks; skipped steps leave decisions', valueChars: 50, colWidth: 430 });
facts.f5 = { driveTicks: d3.ticks, runsPerTick: 1, tick1: { runId: d3.receipts[1].runId, tick: d3.receipts[1].tick, stateFrom: d3.receipts[1].trace.in.state.from, impure: d3.receipts[1].impure, decisions: d3.receipts[1].trace.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? `ran ${d.ran}` : `skipped ${d.skipped}`}`), calls: d3.receipts[1].calls,
  slots: d3.receipts[1].trace.calls.filter((c) => c.slot).map((c) => `${c.contract}#${c.slot}`), eventsFrom: d3.receipts[1].trace.out.events.from.kind, verdicts: d3.receipts[1].verdicts } };
const litW = world(); const lit2 = runDrive(litW, init, config(1, { gate: 'literal' }), { cache: false });
// F5c: the literal-gate strip (verdict counts per tick, v0.4) and F5d: a drive resumed at tick 18 with startTick (v0.4)
const litStrip = driveToSvg(lit2.receipts.slice(0, 8), litW.part, { title: 'F5c  literal gate, N = 1: ticks 0 to 7 of 39, with verdict counts per tick', describe: (st, r) => { const c = litW.part(r.outputs.counts); return `r${c.ready} w${c.running} d${c.done} i${c.integrated}`; } });
const wr = world(); const full = runDrive(wr, init, config(3));
const resumed = wr.drive('agents.tick', { state: wr.ref(full.receipts[17].runId, 1, 'state'), config: config(3) }, { until: (o) => o.finished, startTick: 18 });
const resumedStrip = driveToSvg(resumed.receipts.slice(0, 6), wr.part, { title: 'F5d  the same simulation resumed from the state of tick 17 with startTick 18: ticks 18 to 23', describe });
facts.f5.litStrip = { ticks: lit2.ticks, rejectedTicks: lit2.receipts.map((rc, k) => [k, rc.verdicts.filter((v) => !v.accepted).length]).filter(([, n]) => n).map(([k]) => k).slice(0, 5), verdictsPerTick: lit2.receipts.slice(0, 4).map((rc) => rc.verdicts.length) };
facts.f5.resumed = { ticks: resumed.receipts.map((rc) => rc.tick).slice(0, 3), first: { run: resumed.receipts[0].runId, stateFrom: resumed.receipts[0].trace.in.state.from }, count: resumed.ticks, sameTail: JSON.stringify(resumed.receipts.flatMap((rc) => wr.part(rc.outputs.events))) === JSON.stringify(full.events.slice(full.tickEvents.slice(0, 18).flat().length)) };
fs.writeFileSync(path.join(outDir, 'f-agents-5-drive.html'), inkPage([strip, litStrip, resumedStrip, tick1]));

// ---- F6: checks. (a) a rejected allocation, (b) the literal gate's backlog check going red at tick 2 (N = 1)
const wk = world();
const bad = { idle: [{ id: 'sB', kind: 'strong', stream: 'B' }, { id: 'o1', kind: 'orchestrator', stream: 'A' }], ready: [{ id: 'tA', stream: 'A', cost: 3 }, { id: 'tB', stream: 'B', cost: 2 }],
  constraints: { maxStarts: 1, maxOrchestratorsBusy: 2, orchestratorsBusy: 0 }, assignments: [{ task: 'tA', agent: 'sB', score: 0 }, { task: 'tB', agent: 'sB', score: 0 }] };
const chk = wk.run('agents.evaluate', bad, { cache: false });
const lit = runDrive(world(), init, config(1, { gate: 'literal' }), { cache: false });
const firstBad = lit.verdicts.find((v) => !v.accepted);
facts.f6 = { evaluate: { accepted: chk.outputs.accepted, reason: chk.outputs.reason, verdicts: chk.receipt.verdicts }, literal: { firstRejected: firstBad, rejected: lit.verdicts.filter((v) => !v.accepted).length, ticks: lit.ticks, peakDone: Math.max(...lit.series.map((c) => c.done)) } };
fs.writeFileSync(path.join(outDir, 'f-agents-6-checks.html'), traceHtml([
  traceToSvg(chk.trace, wk.part, { title: 'F6a  agents.evaluate on a bad assignment: a check that says no is a successful run', valueChars: 80, colWidth: 640 }),
  traceToSvg(lit2.receipts[firstBad.tick].trace, litW.part, { title: `F6b  literal gate, N = 1, tick ${firstBad.tick}: agents.capacity rejects (done ${firstBad.reason.slice(5)}) and the run goes on`, maxDepth: 1, valueChars: 50, colWidth: 430 }),
]));

// ---- F6c: a buggy allocator inside a whole tick: the check says no, commit faults, the failed receipt keeps the verdict
{
  const wb = world();
  wb.implement({ id: 'agents.allocate/bad', implements: 'agents.allocate', run: () => ({ assignments: [{ task: 'a1', agent: 'sB', score: 0 }], score: 0 }) });
  let caught;
  try { runDrive(wb, init, config(3), { fill: { 'agents.allocate#primary': 'agents.allocate/bad' } }); } catch (err) { caught = err; }
  facts.f6c = { code: caught.trace.error.code, message: caught.trace.error.message, status: caught.receipt.status, tick: caught.receipt.tick, verdicts: caught.receipt.verdicts.map((v) => [v.contract, v.accepted, v.reason]),
    commitDecisions: find(caught.trace, 'agents.commit').decisions, commitError: find(caught.trace, 'agents.commit').error };
  fs.writeFileSync(path.join(outDir, 'f-agents-6c-failed-tick.html'), traceHtml([
    traceToSvg(caught.trace, wb.part, { title: 'F6c  a buggy allocator on the primary seat, tick 0: evaluate says no, commit refuses with ASSIGNMENT_REJECTED', maxDepth: 1, valueChars: 60, colWidth: 520 })]));
}

// ---- F7: the whole simulation in ONE call (ctx.drive). (a) N = 3, children only; (b) one child opened
const wsim = world();
const sim = runSimulate(wsim, init, config(3), { cache: false });
facts.f7 = { ticks: sim.ticks, calls: sim.receipt.calls, children: sim.trace.calls.length, tags: sim.trace.calls.map((c) => c.tick), verdicts: sim.receipt.verdicts.length, impure: sim.receipt.impure,
  sameEventsAsDrive: JSON.stringify(sim.events) === JSON.stringify(d3.events), sumOfTickCalls: d3.receipts.reduce((n, rc) => n + rc.calls, 0),
  drives: sim.trace.drives.map((d) => ({ contract: d.contract, startTick: d.startTick, ticks: d.ticks, stopped: d.stopped, calls: d.calls.length })), eventPieces: sim.trace.out.events.from.pieces.length };
fs.writeFileSync(path.join(outDir, 'f-agents-7-simulate.html'), inkPage([
  traceToSvg({ ...sim.trace, calls: [0, 1, 2, 35].map((k) => sim.trace.calls[k]) }, wsim.part, { title: 'F7a  agents.simulate (N = 3): ONE run; ctx.drive with collect; 4 of its 36 children (@0 @1 @2 @35)', maxDepth: 1, valueChars: 40, colWidth: 470 }),
  traceToSvg(sim.trace.calls[4], wsim.part, { title: 'F7b  the @4 child of that run opened one level: its grandchildren carry no tag of their own', maxDepth: 1, valueChars: 40, colWidth: 470 }),
]));

// ---- F8: world.drive after simulate: each tick root is a cache hit on a child of the simulate run; ghost boxes show what the hit stands for
{
  const wg = world();
  const s1 = runSimulate(wg, init, config(3));
  const dd = runDrive(wg, init, config(3));
  const hit = dd.receipts[4].trace;
  facts.f8 = { simulateRun: s1.receipt.runId, driveRoots: dd.receipts.filter((rc) => rc.trace.cached).length, tick4: { cachedFrom: hit.cachedFrom, original: { id: wg.node(hit.cachedFrom.run, hit.cachedFrom.call).id, tick: wg.node(hit.cachedFrom.run, hit.cachedFrom.call).tick, contract: wg.node(hit.cachedFrom.run, hit.cachedFrom.call).contract },
    carriedVerdicts: hit.verdicts.map((v) => `${v.contract} ${v.accepted}: ${v.reason}`), ghostChildren: wg.node(hit.cachedFrom.run, hit.cachedFrom.call).calls.length, receiptVerdictsCached: dd.receipts[4].verdicts.every((v) => v.cached) } };
  fs.writeFileSync(path.join(outDir, 'f-agents-8-ghost.html'), inkPage([
    traceToSvg(hit, wg.part, { title: 'F8  tick 4 of a world.drive that ran AFTER agents.simulate: a cache hit on the simulate run, original subtree as ghosts', maxDepth: 1, valueChars: 40, colWidth: 470,
      expand: (n) => wg.node(n.cachedFrom.run, n.cachedFrom.call) })]));
}

// ---- F9: decisions. (a) demand under the reserve gate, (b) under the literal gate, (c) the integrator while it is busy (N = 3, tick 4)
{
  const wl = world();
  const lit3 = runDrive(wl, init, config(3, { gate: 'literal' }), { cache: false });
  const demandRes = find(d3.receipts[0].trace, 'agents.demand'); const demandLit = find(lit3.receipts[0].trace, 'agents.demand');
  const integ4 = find(d3.receipts[4].trace, 'agents.integrate');
  facts.f9 = { reserve: { id: demandRes.id, impl: demandRes.impl, calls: demandRes.calls.map((c) => `#${c.id} ${c.contract}`), decisions: demandRes.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}`) },
    literal: { id: demandLit.id, calls: demandLit.calls.map((c) => `#${c.id} ${c.contract}`), decisions: demandLit.decisions.map((d) => `${d.label}=${d.value} ${d.ran ? 'ran' : 'skipped'}`) },
    integrate4: { id: integ4.id, decisions: integ4.decisions.map((d) => `${d.label}=${d.value}`), events: w3.part(integ4.out.events.hash) },
    integrate3: { decisions: find(d3.receipts[3].trace, 'agents.integrate').decisions.map((d) => `${d.label}=${d.value}`), events: w3.part(find(d3.receipts[3].trace, 'agents.integrate').out.events.hash) },
    limitReserve: w3.part(demandRes.out.limit.hash), limitLiteral: wl.part(demandLit.out.limit.hash) };
  fs.writeFileSync(path.join(outDir, 'f-agents-9-decisions.html'), inkPage([
    traceToSvg(demandRes, w3.part, { title: 'F9a  agents.demand, tick 0, N = 3, reserve gate: lit skipped, res ran (limit 3)', valueChars: 40, colWidth: 470 }),
    traceToSvg(demandLit, wl.part, { title: 'F9b  agents.demand, tick 0, N = 3, literal gate: lit ran, res skipped (limit 8)', valueChars: 40, colWidth: 470 }),
    traceToSvg(integ4, w3.part, { title: 'F9c  agents.integrate, tick 4, N = 3: busy', valueChars: 40, colWidth: 470 }),
  ]));
}

// ---- F10: the audit seat. Tick 0 of N = 3 with audit on: greedy loses 10 to exact-dp on the shadow seat and the regret check says so
{
  const wa = world();
  const aud = runDrive(wa, init, config(3, { audit: true }), { cache: false });
  const lost = aud.verdicts.filter((v) => v.contract === 'agents.regret' && !v.accepted);
  facts.f10 = { regretVerdicts: aud.verdicts.filter((v) => v.contract === 'agents.regret').length, lost: lost.map((v) => [v.tick, v.reason]), sameEventsAsPlain: JSON.stringify(aud.events) === JSON.stringify(d3.events),
    tick0Seats: aud.receipts[0].trace.calls.filter((c) => c.contract === 'agents.allocate').map((c) => `#${c.id} ${c.slot} ${c.impl}`), tick0Calls: aud.receipts[0].calls };
  fs.writeFileSync(path.join(outDir, 'f-agents-10-audit.html'), inkPage([
    traceToSvg(aud.receipts[0].trace, wa.part, { title: 'F10  tick 0, N = 3, audit on: allocate#primary (greedy) and allocate#shadow (exact-dp) side by side; agents.regret rejects', maxDepth: 1, valueChars: 40, colWidth: 470 })]));
}

// ---- F11: a path-qualified fill reaches only the scoreMatrix under the shadow seat (audit tick 0, N = 3)
{
  const wp = world();
  wp.implement({ id: 'agents.scoreMatrix/flat', implements: 'agents.scoreMatrix', run: ({ idle: ag, ready: tk }) => ({
    scores: tk.value.map((t) => ag.value.map((x) => (x.kind === 'strong' && x.stream !== t.stream ? null : 1000 + (x.kind === 'orchestrator' ? -300 : 0) + t.cost))) }) });
  const KEY = 'agents.allocate#shadow/agents.scoreMatrix#scores';
  const pr = runDrive(wp, init, config(3, { audit: true }), { fill: { [KEY]: 'agents.scoreMatrix/flat' }, maxTicks: 1, cache: false, allowUnfinished: true });
  const t0 = pr.receipts[0].trace;
  const seatsNodes = t0.calls.filter((c) => ['agents.allocate', 'agents.evaluate'].includes(c.contract));
  facts.f11 = { key: KEY, seats: seatsNodes.map((c) => `#${c.id} ${c.contract}#${c.slot ?? ''} -> ${c.calls.map((k) => `#${k.id} ${k.contract}#${k.slot} ${k.impl}`).join(', ')}`),
    firstScoreRow: seatsNodes.map((c) => wp.part(c.calls[0].out.scores.hash)[0].slice(0, 4)) };
  fs.writeFileSync(path.join(outDir, 'f-agents-11-path-slot.html'), inkPage([
    traceToSvg({ ...t0, calls: seatsNodes }, wp.part, { title: `F11  fill '${KEY}': only the shadow seat's scoreMatrix is flat`, maxDepth: 2, valueChars: 40, colWidth: 470, receipt: pr.receipts[0] })]));
  facts.f11.fillConsulted = pr.receipts[0].fillConsulted;
}


// ---- F12: specificity and the receipt's fill line (audit tick 0, N = 3): (a) a contract fill sweeps seats without a pin, (b) contract#* sweeps every seat, (c) a slot fill on a dead seat
{
  const ws = world();
  const seatsAndRegret = (t) => ({ ...t, calls: t.calls.filter((c) => ['agents.allocate', 'agents.regret'].includes(c.contract)) });
  const one = (fill, audit = true) => runDrive(ws, init, config(3, { audit }), { fill, maxTicks: 1, cache: false, allowUnfinished: true });
  const fa = { 'agents.allocate': 'agents.allocate/greedy' }; const fb = { 'agents.allocate#*': 'agents.allocate/greedy' };
  const fc = { 'agents.allocate#primary': 'agents.allocate/greedy', 'agents.allocate#shadow': 'agents.allocate/exact-dp' };
  const ra = one(fa); const rb = one(fb); const rc = one(fc, false);
  const seats = (r) => r.receipts[0].trace.calls.filter((c) => c.contract === 'agents.allocate').map((c) => `#${c.id} ${c.slot} ${c.impl} ${JSON.stringify(c.chosenBy)} ${ws.part(c.out.score.hash)}`);
  const reg = (r) => r.receipts[0].trace.calls.filter((c) => c.contract === 'agents.regret').map((c) => `#${c.id} ${ws.part(c.out.accepted.hash)} ${ws.part(c.out.reason.hash)}`);
  facts.f12 = { a: { seats: seats(ra), regret: reg(ra), reach: ra.receipts[0].fillReach }, b: { seats: seats(rb), regret: reg(rb), reach: rb.receipts[0].fillReach },
    c: { seats: seats(rc), reach: rc.receipts[0].fillReach, consulted: rc.receipts[0].fillConsulted, fillKeys: Object.keys(fc) } };
  fs.writeFileSync(path.join(outDir, 'f-agents-12-specificity.html'), inkPage([
    traceToSvg(seatsAndRegret(ra.receipts[0].trace), ws.part, { title: "F12a  fill { 'agents.allocate': greedy }: the shadow seat's select is a pin", maxDepth: 1, valueChars: 40, colWidth: 470, receipt: ra.receipts[0] }),
    traceToSvg(seatsAndRegret(rb.receipts[0].trace), ws.part, { title: "F12b  fill { 'agents.allocate#*': greedy }: every seat, the pin included", maxDepth: 1, valueChars: 40, colWidth: 470, receipt: rb.receipts[0] }),
    traceToSvg({ ...rc.receipts[0].trace, calls: rc.receipts[0].trace.calls.filter((c) => c.contract === 'agents.allocate') }, ws.part, { title: 'F12c  audit off, slot fills on primary and on shadow: the dead one is marked', maxDepth: 0, valueChars: 40, colWidth: 470, receipt: rc.receipts[0] }),
    ...(() => {
      // F12d/e: ONE fill table across a sweep over both demand gates, landing 'none'
      ws.implement({ id: 'agents.demandLiteral/greedy', implements: 'agents.demandLiteral', run: ({ counts }) => ({ limit: counts.value.ready }) });
      ws.select('agents.demandLiteral', 'agents.demandLiteral/done');
      const fd = { 'agents.demand/agents.demandLiteral': 'agents.demandLiteral/greedy' };
      const go = (gate) => runDrive(ws, init, config(3, { gate }), { fill: fd, landing: 'none', maxTicks: 1, cache: false, allowUnfinished: true });
      const rl = go('literal'); const rr = go('reserve');
      const demandNode = (r) => ({ ...r.receipts[0].trace, calls: r.receipts[0].trace.calls.filter((c) => c.contract === 'agents.demand') });
      facts.f12.d = { reach: rl.receipts[0].fillReach, children: demandNode(rl).calls[0].calls.map((c) => `#${c.id} ${c.contract} ${c.impl} ${JSON.stringify(c.chosenBy)}`) };
      facts.f12.e = { reach: rr.receipts[0].fillReach, children: demandNode(rr).calls[0].calls.map((c) => `#${c.id} ${c.contract} ${c.impl}`) };
      return [traceToSvg(demandNode(rl), ws.part, { title: 'F12d  landing none, ONE fill table, gate literal: the fill lands on the literal rule', maxDepth: 2, valueChars: 40, colWidth: 470, receipt: rl.receipts[0] }),
        traceToSvg(demandNode(rr), ws.part, { title: 'F12e  landing none, the same fill table, gate reserve: it misses, and that is not an error', maxDepth: 2, valueChars: 40, colWidth: 470, receipt: rr.receipts[0] })];
    })()]));
}

facts.helperContracts = { before: [], after: [] };
facts.sixthRound = { traceScansBefore: ['seats walk (path slots test)', 'seatImpls (specificity test)', 'seats (render F12)'], traceScansAfter: [], fillPerConfig: { before: 1, after: 0 }, allowUnusedFill: 0 };   // round 4: agents.gateKind removed; none came back
facts.restated = { round5: { before: ['regret when audit', 'res when eq gate reserve (typed complement)'], after: [] }, round6: 'nothing left to remove: no guard is kept because of an else or one gap' };
fs.writeFileSync(path.join(outDir, 'f-agents-facts.json'), JSON.stringify(facts, null, 1));
console.log(Object.keys(facts).join(' '));
