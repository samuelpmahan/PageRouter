// One picture per v0.3 concept, all from real runs. Each picture has printed claims (v03-facts.json) to check against the PNG.
import fs from 'node:fs';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, driveToSvg, traceHtml } from '../src/view.mjs';

const out = process.argv[2] ?? 'verify/out';
fs.mkdirSync(out, { recursive: true });
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const str = { type: 'string' };
const nums = { type: 'array', items: num };
const facts = {};
const write = (name, sections) => fs.writeFileSync(`${out}/${name}.html`, traceHtml(sections));

// ---------------------------------------------------------------- 1. branching: declared both ways, one skipped, decision recorded
{
  const w = createWorld({ name: 'v03-branch' });
  w.contract({ id: 'isNeg', in: { x: num }, out: { yes: bool } });
  w.implement({ id: 'isNeg/1', implements: 'isNeg', run: ({ x }) => ({ yes: x.value < 0 }) });
  w.contract({ id: 'not', in: { b: bool }, out: { b: bool } });
  w.implement({ id: 'not/1', implements: 'not', run: ({ b }) => ({ b: !b.value }) });
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'abs', in: { x: num }, out: { y: num } });
  w.compose({ id: 'abs/branch', implements: 'abs', steps: [
    { name: 'test', call: 'isNeg', bind: { x: '$in.x' } },
    { name: 'pos', call: 'not', bind: { b: 'test.yes' } },
    { name: 'flip', call: 'neg', when: 'test.yes', bind: { x: '$in.x' } },
    { name: 'keep', call: 'id', when: 'pos.b', bind: { x: '$in.x' } },
  ], returns: { y: { first: ['flip.y', 'keep.y'] } } });
  const a = w.run('abs', { x: -4 });
  const b = w.run('abs', { x: 5 });
  write('v03-1-branch', [
    traceToSvg(a.trace, w.part, { title: 'v03-1a abs(-4): flip ran, keep skipped' }),
    traceToSvg(b.trace, w.part, { title: 'v03-1b abs(5): flip skipped, keep ran' }),
  ]);
  facts['v03-1'] = {
    a: { output: a.outputs.y, calls: a.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: a.trace.decisions },
    b: { output: b.outputs.y, calls: b.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: b.trace.decisions },
    claims: [
      'A: #1 abs has three children #2 isNeg, #3 not, #4 neg; no id box.',
      'A: two amber rows on #1: "◇ flip = true → ran  read #2.yes" and "◇ keep = false → skipped  read #3.b" in grey.',
      'A: dotted amber edges run from #2 yes and #3 b output rows to those two decision rows on #1.',
      'A: purple bracket from #4 y to #1 y = 4.',
      'B: children #2 isNeg, #3 not, #4 id; flip skipped (grey), keep ran; y = 5 comes from #4 y, and #4 x is a green input edge from #1 x.',
    ],
  };
}

// ---------------------------------------------------------------- 2. cache hit expanded into its original subtree, verdicts carried
{
  const w = createWorld({ name: 'v03-cache' });
  w.contract({ id: 'pos', kind: 'check', in: { x: num }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'pos/1', implements: 'pos', run: ({ x }) => ({ accepted: x.value > 0, reason: `${x.value} ${x.value > 0 ? '>' : '<='} 0` }) });
  w.contract({ id: 'half', in: { x: num }, out: { y: num } });
  w.implement({ id: 'half/1', implements: 'half', uses: ['pos'], run: ({ x }, ctx) => { ctx.call('pos', { x }); return { y: x.value / 2 }; } });
  w.contract({ id: 'quarter', in: { x: num }, out: { y: num } });
  w.implement({ id: 'quarter/1', implements: 'quarter', uses: ['half'], run: ({ x }, ctx) => ({ y: ctx.call('half', { x: ctx.call('half', { x }).y }).y }) });
  w.contract({ id: 'twoQuarters', in: { x: num, z: num }, out: { a: num, b: num } });
  w.implement({ id: 'twoQuarters/1', implements: 'twoQuarters', uses: ['quarter'], run: ({ x, z }, ctx) => ({ a: ctx.call('quarter', { x }).y, b: ctx.call('quarter', { x: z }).y }) });
  const first = w.run('quarter', { x: 8 });
  const second = w.run('twoQuarters', { x: 8, z: 12 });
  const expand = (n) => w.node(n.cachedFrom.run, n.cachedFrom.call);
  write('v03-2-cache', [
    traceToSvg(first.trace, w.part, { title: `v03-2a run ${first.receipt.runId}: quarter(8) computed` }),
    traceToSvg(second.trace, w.part, { title: `v03-2b run ${second.receipt.runId}: quarter(8) is a cache hit, drawn with its original subtree as ghosts`, expand }),
  ]);
  facts['v03-2'] = {
    secondVerdicts: second.receipt.verdicts.map((v) => ({ reason: v.reason, cached: Boolean(v.cached), cachedFrom: v.cachedFrom ?? null })),
    claims: [
      'B: #2 quarter header hatched, impl line reads "cached from run 1 #1".',
      'B: #2 has a green row "✓ 2 cached verdicts: 8 > 0; 4 > 0" inside the box.',
      'B: a green edge runs from cached #2 x to ghost #2 half x, and a purple bracket from ghost #4 half y to cached #2 y (the cached box stands for run 1 #1).',
      'B: beneath #2, ghost (faded, dashed border) boxes #2 half (run 1), #3 pos (run 1) ✓ ... matching run 1\'s #2..#5 ids.',
      'B: the ghost boxes have their own internal edges (blue from half y into the second half x), scoped to run 1, not linked to run 2 ids.',
      'B: #3 quarter (z=12) is computed, not cached, with its own checks 12 > 0 and 6 > 0.',
      'Receipt: 4 verdicts, the first two marked cached from run 1 call 1.',
    ],
  };
}

// ---------------------------------------------------------------- 3. ctx.drive and the tick dependency
{
  const w = createWorld({ name: 'v03-drive' });
  w.contract({ id: 'stamp', in: { x: num }, out: { y: num } });
  w.implement({ id: 'stamp/tick', implements: 'stamp', run: ({ x }, ctx) => ({ y: x.value * 100 + ctx.tick() }) });
  w.contract({ id: 'clock', kind: 'tick', in: { state: num }, out: { state: num } });
  w.implement({ id: 'clock/stamp', implements: 'clock', uses: ['stamp'], run: (_, ctx) => ({ state: ctx.call('stamp', { x: 1 }).y }) });
  w.contract({ id: 'run3', in: { s: num }, out: { s: num } });
  w.implement({ id: 'run3/1', implements: 'run3', uses: ['clock'], run: ({ s }, ctx) => ({ s: ctx.drive('clock', { state: s }, { ticks: 3 }).state }) });
  const r = w.run('run3', { s: 0 });
  const d1 = w.drive('clock', { state: 0 }, { ticks: 4 });
  const d2 = w.drive('clock', { state: 0 }, { ticks: 4 });
  write('v03-3-drive', [
    traceToSvg(r.trace, w.part, { title: 'v03-3a ctx.drive inside run3: three clock ticks as child calls' }),
    driveToSvg(d1.receipts, w.part, { title: 'v03-3b world.drive: ticks 0-2 hit the entries run3\'s inner drive made; tick 3 is new', describe: (s) => String(s) }),
    driveToSvg(d2.receipts, w.part, { title: 'v03-3c same drive again: each tick hits its own entry (tick is a cache dependency)', describe: (s) => String(s) }),
  ]);
  facts['v03-3'] = {
    run3: r.outputs.s,
    childTicks: r.trace.calls.map((c) => c.tick),
    d1: d1.receipts.map((x) => [w.part(x.outputs.state), x.trace.cached]),
    d2: d2.receipts.map((x) => [w.part(x.outputs.state), x.trace.cached]),
    claims: [
      'A: #1 run3 has children "#2 clock @0", "#4 clock @1", "#6 clock @2" with amber @k tags; each has a stamp child with no @ tag.',
      'A: stamp outputs 100, 101, 102; #4 clock state input is a blue edge from #2 state, #6 from #4 state.',
      'A: #1 s = 102 via a purple bracket from #6.',
      'B: strip shows states 100 101 102 103; ticks 0, 1, 2 read "cached" (entries made by run3\'s ctx.drive at the same ticks), tick 3 reads "2 calls".',
      'C: strip shows states 100 101 102 103, each "cached" (same values: the entry is valid only at its own tick).',
    ],
  };
}

// ---------------------------------------------------------------- 4. concat with many pieces, grouped per source
{
  const w = createWorld({ name: 'v03-concat' });
  w.contract({ id: 'two', in: { a: nums }, out: { b: nums } });
  w.implement({ id: 'two/1', implements: 'two', run: ({ a }) => ({ b: a.value.map((x) => x * 2) }) });
  w.contract({ id: 'both', in: { a: nums }, out: { all: nums } });
  w.compose({ id: 'both/c', implements: 'both', steps: [{ name: 'd', call: 'two', bind: { a: '$in.a' } }], returns: { all: { concat: ['$in.a', 'd.b'] } } });
  w.contract({ id: 'few', in: { a: nums }, out: { all: nums } });
  w.compose({ id: 'few/c', implements: 'few', steps: [{ name: 'd', call: 'two', bind: { a: '$in.a' } }], returns: { all: { concat: ['$in.a', 'd.b'] } } });
  const many = w.run('both', { a: [1, 2, 3, 4, 5, 6, 7, 8] });
  const few = w.run('few', { a: [1, 2] });
  write('v03-4-concat', [
    traceToSvg(few.trace, w.part, { title: 'v03-4a concat of 2 + 2: four pieces drawn one by one', valueChars: 60 }),
    traceToSvg(many.trace, w.part, { title: 'v03-4b concat of 8 + 8: sixteen pieces grouped per source', valueChars: 60 }),
  ]);
  facts['v03-4'] = {
    fewPieces: few.trace.out.all.from.pieces.length,
    manyPieces: many.trace.out.all.from.pieces.length,
    claims: [
      'A: #1 all = [1,2,2,4] then wrapped lines inside the box: gather[0]←[0] passthrough, gather[1]←[1] passthrough, gather[2]←[0] gather[3]←[1]; the two #2 pieces each draw a dashed purple bracket from #2 b, in two separate lanes.',
      'B: #1 all row value is truncated with … inside the box, continuation line reads "pieces ×8 passthrough pieces ×8", one dashed purple bracket from #2 b.',
      'Both: no text crosses a box edge and no edge crosses text.',
    ],
  };
}

fs.writeFileSync(`${out}/v03-facts.json`, JSON.stringify(facts, null, 2));
console.log(JSON.stringify(facts, null, 2));
