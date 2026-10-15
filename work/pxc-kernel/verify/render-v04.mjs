// One picture per v0.4 concept, all from real runs. Claims are printed to v04-facts.json before the PNGs are looked at.
import fs from 'node:fs';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, driveToSvg, traceHtml } from '../src/view.mjs';

const out = process.argv[2] ?? 'verify/out';
fs.mkdirSync(out, { recursive: true });
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const str = { type: 'string' };
const facts = {};
const write = (name, sections) => fs.writeFileSync(`${out}/${name}.html`, traceHtml(sections));

// ---------------------------------------------------------------- 1. relational conditions, one, imperative named branches
{
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'abs', in: { x: num }, out: { y: num } });
  w.compose({ id: 'abs/rel', implements: 'abs', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'keep', call: 'id', when: { ge: ['$in.x', 0] }, bind: { x: '$in.x' } },
  ], returns: { y: { one: ['flip.y', 'keep.y'] } } });
  w.implement({ id: 'abs/imp', implements: 'abs', uses: ['neg'], run: ({ x }, ctx) => (
    ctx.when({ lt: [x, 0] }, 'negative?', { true: 'negate', false: 'keep' }) ? { y: ctx.call('neg', { x }).y } : { y: x }) });
  w.select('abs', 'abs/rel');
  const a = w.run('abs', { x: -4 });
  const b = w.run('abs', { x: 6 }, { fill: { abs: 'abs/imp' } });
  write('v04-1-relations', [
    traceToSvg(a.trace, w.part, { title: 'v04-1a abs(-4) declared: conditions are relations, no helper contracts' }),
    traceToSvg(b.trace, w.part, { title: 'v04-1b abs(6) imperative: ctx.when with named branches' }),
  ]);
  facts['v04-1'] = {
    a: { calls: a.trace.calls.map((c) => c.contract), decisions: a.trace.decisions },
    b: { calls: b.trace.calls.map((c) => c.contract), decisions: b.trace.decisions },
    claims: [
      'A: #1 abs has exactly one child, #2 neg. There is no isNeg or not box.',
      'A: decision rows on #1 read "◇ flip = true → ran  read lt($in.x, 0)" (amber) and "◇ keep = false → skipped  read ge($in.x, 0)" (grey).',
      'A: dotted amber edges leave #1\'s own x input row and enter both decision rows of #1 (the operand is the caller\'s input).',
      'A: #1 y = 4 with a purple bracket from #2 y.',
      'B: #1 abs (abs/imp) has no children; one grey row "◇ negative? = false → ran keep, skipped negate  read lt($in.x, 0)", broken onto continuation lines inside the box; y = 6 passthrough.',
    ],
  };
}

// ---------------------------------------------------------------- 2. nested condition by and; merged decisions; a skipped gather falling through
{
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } });
  w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 'shape', in: { x: num }, out: { y: num, both: { type: 'array', items: num } } });
  const neg = { lt: ['$in.x', 0] };
  w.compose({ id: 'shape/c', implements: 'shape', steps: [
    { name: 'flip', call: 'neg', when: neg, bind: { x: '$in.x' } },
    { name: 'sqA', call: 'sq', when: neg, bind: { x: 'flip.y' } },
    { name: 'sqB', call: 'sq', when: neg, bind: { x: '$in.x' } },
    { name: 'big', call: 'neg', when: { and: [neg, { gt: ['flip.y', 10] }] }, bind: { x: 'flip.y' } },
  ], returns: { y: { first: ['big.y', 'sqA.y', '$in.x'] }, both: { first: [{ gather: ['sqA.y', 'sqB.y'] }, { gather: ['$in.x'] }] } } });
  const n = w.run('shape', { x: -3 });
  const p = w.run('shape', { x: 5 });
  write('v04-2-nested', [
    traceToSvg(n.trace, w.part, { title: 'v04-2a shape(-3): three steps share one condition; big is nested by and' }),
    traceToSvg(p.trace, w.part, { title: 'v04-2b shape(5): every step skipped; one merged row; the gather falls through' }),
  ]);
  facts['v04-2'] = {
    a: { outputs: n.outputs, calls: n.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: n.trace.decisions.map((d) => [d.label, d.value]) },
    b: { outputs: p.outputs, calls: p.trace.calls.length, decisions: p.trace.decisions.map((d) => [d.label, d.value]) },
    claims: [
      'A: children #2 neg, #3 sq, #4 sq; no fourth child (big skipped because flip.y = 3 is not > 10).',
      'A: ONE amber row "◇ flip, sqA, sqB = true → ran  read lt($in.x, 0)" instead of three, and a grey row "◇ big = false → skipped  read and(lt($in.x, 0), gt(#2.y, 10))".',
      'A: the big row has amber edges from #1 x and from #2 y.',
      'A: y = 9 bracketed from #3 y; both = [9,9] with gather[0] and gather[1] brackets from #3 and #4.',
      'B: no children; ONE grey row "◇ flip, sqA, sqB = false → skipped" and one grey row for big; y = 5 and both = [5] passthrough.',
    ],
  };
}

// ---------------------------------------------------------------- 3. path-qualified slots
{
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
  const flat = w.run('whole', { x: 0 }, { fill: { 'leaf#b1': 'leaf/ten' }, cache: false });
  const path = w.run('whole', { x: 0 }, { fill: { 'half#hi/leaf#b1': 'leaf/ten' }, cache: false });
  write('v04-3-path-slots', [
    traceToSvg(flat.trace, w.part, { title: "v04-3a fill 'leaf#b1': the flat key reaches both b1 seats" }),
    traceToSvg(path.trace, w.part, { title: "v04-3b fill 'half#hi/leaf#b1': the path reaches one seat" }),
  ]);
  const seats = (t) => { const o = []; (function walk(n) { if (n.contract === 'leaf') o.push(`#${n.id} ${n.slot} ${n.impl}`); n.calls.forEach(walk); })(t); return o; };
  facts['v04-3'] = {
    flat: { outputs: flat.outputs, seats: seats(flat.trace) },
    path: { outputs: path.outputs, seats: seats(path.trace) },
    claims: [
      'A: four leaf boxes; #4 leaf#b1 and #7 leaf#b1 both read leaf/ten; lo = 11, hi = 11.',
      'B: four leaf boxes; only #7 leaf#b1 (under #5 half#hi) reads leaf/ten; #4 leaf#b1 reads leaf/inc; lo = 2, hi = 11.',
    ],
  };
}

// ---------------------------------------------------------------- 4. ctx.drive collect, startTick, stop record; drive strip with verdicts and origin
{
  const w = createWorld();
  w.contract({ id: 'step', kind: 'tick', in: { state: int }, out: { state: int, out: int } });
  w.implement({ id: 'step/1', implements: 'step', run: ({ state }, ctx) => ({ state: state.value + 1, out: state.value * 10 + ctx.tick() }) });
  w.contract({ id: 'loop', in: { s: int }, out: { s: int, outs: { type: 'array', items: int } } });
  w.implement({ id: 'loop/1', implements: 'loop', uses: ['step'], run: ({ s }, ctx) => {
    const d = ctx.drive('step', { state: s }, { ticks: 3, collect: ['out'], startTick: 5 });
    return { s: d.state, outs: d.collected.out };
  } });
  const r = w.run('loop', { s: 0 });
  w.contract({ id: 'okStep', kind: 'check', in: { s: int }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'okStep/1', implements: 'okStep', run: ({ s }) => ({ accepted: s.value < 3, reason: `${s.value} ${s.value < 3 ? '<' : '>='} 3` }) });
  w.contract({ id: 'audited', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'audited/1', implements: 'audited', uses: ['okStep'], run: ({ state }, ctx) => { ctx.call('okStep', { s: state }); return { state: state.value + 1 }; } });
  const d1 = w.drive('audited', { state: 0 }, { ticks: 5 });
  const d2 = w.drive('audited', { state: 0 }, { ticks: 5 });
  write('v04-4-collect', [
    traceToSvg(r.trace, w.part, { title: 'v04-4a ctx.drive collect: three ticks from 5, outputs gathered' }),
    driveToSvg(d2.receipts, w.part, { title: 'v04-4b second world.drive of an audited tick: origin run and verdicts per tick', describe: (s) => String(s) }),
  ]);
  facts['v04-4'] = {
    outputs: r.outputs, ticks: r.trace.calls.map((c) => c.tick), drives: r.trace.drives,
    strip: d2.receipts.map((x) => ({ state: w.part(x.outputs.state), cachedFrom: x.trace.cachedFrom?.run ?? null, verdicts: x.verdicts.map((v) => v.accepted) })),
    firstRuns: d1.receipts.map((x) => x.runId),
    claims: [
      'A: #1 loop children "#2 step @5", "#3 step @6", "#4 step @7"; headers carry no word "tick" after @k.',
      'A: #1 shows a row "⟳ step: 3 ticks, 5–7  stopped by ticks".',
      'A: #1 outs = [5,16,27] with labels gather[0] gather[1] gather[2]; three purple brackets from #2, #3, #4 out rows.',
      'A: s = 3 bracketed from #4 state.',
      'B: five cells, states 1..5, each "cached ← run k" naming runs 2..6 of the first drive, and verdict counts "1 ✓ 0 ✗" for ticks 0-2, "0 ✓ 1 ✗" in red for ticks 3-4.',
    ],
  };
}

// ---------------------------------------------------------------- 5. a cached check keeps its colour; cached verdicts name their check; long names stay in the box
{
  const w = createWorld();
  w.contract({ id: 'audit.portfolioVarianceWithinRegulatoryBudget', kind: 'check', in: { v: num }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'audit.portfolioVarianceWithinRegulatoryBudget/strict-quarterly-v2', implements: 'audit.portfolioVarianceWithinRegulatoryBudget', run: ({ v }) => ({ accepted: v.value <= 4, reason: `variance ${v.value} ${v.value <= 4 ? '<=' : '>'} budget 4` }) });
  w.contract({ id: 'pos', kind: 'check', in: { v: num }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'pos/1', implements: 'pos', run: ({ v }) => ({ accepted: v.value > 0, reason: `${v.value} > 0` }) });
  w.contract({ id: 'both', in: { v: num }, out: { v: num } });
  w.implement({ id: 'both/1', implements: 'both', uses: ['audit.portfolioVarianceWithinRegulatoryBudget', 'pos'], run: ({ v }, ctx) => {
    ctx.call('audit.portfolioVarianceWithinRegulatoryBudget', { v }); ctx.call('pos', { v }); return { v };
  } });
  w.contract({ id: 'twice', in: { v: num }, out: { v: num } });
  w.implement({ id: 'twice/1', implements: 'twice', uses: ['both', 'audit.portfolioVarianceWithinRegulatoryBudget'], run: ({ v }, ctx) => {
    ctx.call('audit.portfolioVarianceWithinRegulatoryBudget', { v }); return { v: ctx.call('both', { v }).v };
  } });
  w.run('both', { v: 6 });
  w.run('audit.portfolioVarianceWithinRegulatoryBudget', { v: 6 });
  const r = w.run('twice', { v: 6 });
  write('v04-5-cached-checks', [traceToSvg(r.trace, w.part, { title: 'v04-5 a cached rejecting check stays red under the hatch; cached verdicts name their check' })]);
  facts['v04-5'] = {
    verdicts: r.receipt.verdicts.map((v) => [v.contract, v.accepted, Boolean(v.cached)]),
    claims: [
      '#2 audit.portfolio… header is red AND hatched (cached); the name is cut with … but "check ✗" is kept whole at the end of the header.',
      'Its impl line is cut with … inside the box, still starts "audit.portfolio", and keeps its flag "· cached from run 1 #2" visible (run 2, the standalone audit, was itself a hit of run 1 call #2).',
      '#2 has "✗ 1 cached verdict:" and the verdict line shows the reason "variance 6 > budget 4" after a cut contract name, no JSON quotes.',
      '#3 both is hatched (cached) and has a row "✗ 2 cached verdicts:" then "✗ audit.portfolioVarianceW…:" with "variance 6 > budget 4;" whole on the same or next line, in red and "✓ pos: 6 > 0;" in green, wrapped inside the box.',
      'No text crosses a box edge.',
    ],
  };
}

fs.writeFileSync(`${out}/v04-facts.json`, JSON.stringify(facts, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'claims'))])), null, 1));
