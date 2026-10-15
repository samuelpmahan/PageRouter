// One picture per v0.6 concept, all from real runs. Claims are printed to v06-facts.json before the PNGs are looked at.
import fs from 'node:fs';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, traceHtml } from '../src/view.mjs';

const out = process.argv[2] ?? 'verify/out';
fs.mkdirSync(out, { recursive: true });
const num = { type: 'number' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const str = { type: 'string' };
const facts = {};
const write = (name, sections) => fs.writeFileSync(`${out}/${name}.html`, traceHtml(sections));

// ---------------------------------------------------------------- 1. a ply: inherited runs recorded, else inside its context
{
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } });
  w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'turn', in: { on: bool, x: num }, out: { y: num } });
  w.compose({ id: 'turn/c', implements: 'turn', steps: [
    { name: 'check', call: 'id', when: { eq: ['$in.on', true] }, bind: { x: '$in.x' } },
    { name: 'apply', call: 'sq', when: { gt: ['check.y', 0] }, bind: { x: 'check.y' } },
    { name: 'record', call: 'id', bind: { x: 'apply.y' } },
    { name: 'forfeit', call: 'neg', when: { else: ['apply'] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['record.y', 'forfeit.y', '$in.x'] } } });
  const legal = w.run('turn', { on: true, x: 3 });
  const refused = w.run('turn', { on: true, x: -3 });
  const done = w.run('turn', { on: false, x: -3 });
  write('v06-1-ply', [
    traceToSvg(legal.trace, w.part, { title: 'v06-1a legal move: record ran because apply ran, and says so' }),
    traceToSvg(refused.trace, w.part, { title: 'v06-1b refused move: apply skipped by its own condition, forfeit runs' }),
    traceToSvg(done.trace, w.part, { title: 'v06-1c game over: everything skipped by one cause; no forfeit' }),
  ]);
  const ds = (r) => r.trace.decisions.map((d) => [d.label, d.value]);
  facts['v06-1'] = {
    legal: { y: legal.outputs.y, decisions: ds(legal) }, refused: { y: refused.outputs.y, decisions: ds(refused) }, done: { y: done.outputs.y, decisions: ds(done) },
    claims: [
      'A: children #2 id, #3 sq, #4 id; a merged amber row "◇ apply, record = true → ran read gt(#2.y=3, 0)"; grey "◇ forfeit = false → skipped read else(apply)"; y = 9 from #4.',
      'B: children #2 id, #3 neg; grey row "◇ apply = false → skipped read gt(#2.y=-3, 0)" (record merges into it); amber "◇ forfeit = true → ran read else(apply)" with an amber edge from #2 y; y = 3 from #3.',
      'C: no children; ONE grey row "◇ check, apply, record, forfeit = false → skipped read eq($in.on=false, true)"; y = -3 passthrough.',
    ],
  };
}

// ---------------------------------------------------------------- 2. which rung chose each seat; where each fill landed
{
  const w = createWorld();
  w.contract({ id: 'pick', in: { x: int }, out: { y: int } });
  w.implement({ id: 'pick/a', implements: 'pick', run: ({ x }) => ({ y: x.value + 1 }) });
  w.implement({ id: 'pick/b', implements: 'pick', run: ({ x }) => ({ y: x.value + 100 }) });
  w.contract({ id: 'game', in: { x: int }, out: { me: int, model: int, other: int } });
  w.implement({ id: 'game/1', implements: 'game', uses: ['pick#me', 'pick#model', 'pick#other'], run: ({ x }, ctx) => ({
    me: ctx.call('pick', { x }, { slot: 'me' }).y, model: ctx.call('pick', { x }, { slot: 'model' }).y, other: ctx.call('pick', { x }, { slot: 'other' }).y }) });
  w.select('pick', 'pick/a');
  w.select('pick', 'pick/a', 'model');
  const r = w.run('game', { x: 0 }, { fill: { pick: 'pick/b', 'pick#other': 'pick/a', 'pick#nobody': 'pick/b' }, allowUnusedFill: true });
  write('v06-2-rungs', [traceToSvg(r.trace, w.part, { title: 'v06-2 each seat says which rung chose it; the fill line says where each key landed', receipt: r.receipt })]);
  facts['v06-2'] = {
    chosenBy: r.trace.calls.map((c) => [c.slot, c.impl, c.chosenBy]), fillReach: r.receipt.fillReach,
    claims: [
      'Fill line: "pick → pick/b @ #2", "pick#other → pick/a @ #4", "pick#nobody → pick/b (not consulted)".',
      '#2 pick#me impl line "pick/b · by contract pick"; #3 pick#model "pick/a · by pin pick#model"; #4 pick#other is a same-run cache hit of #3 (same implementation, same input), so its line "pick/a · cached from run 1 #3" is full and "⚑ by slot pick#other" moves to its own row; nothing crosses the box edge.',
      'Root #1 game impl line has no "by" text (it was the only implementation).',
    ],
  };
}

// ---------------------------------------------------------------- 3. collected pieces name their tick; cached verdicts one per line; else stays short
{
  const w = createWorld();
  w.contract({ id: 'pos', kind: 'check', in: { v: int }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'pos/1', implements: 'pos', run: ({ v }) => ({ accepted: v.value >= 0, reason: `${v.value} ${v.value >= 0 ? '>=' : '<'} 0` }) });
  w.contract({ id: 'small', kind: 'check', in: { v: int }, out: { accepted: bool, reason: str } });
  w.implement({ id: 'small/1', implements: 'small', run: ({ v }) => ({ accepted: v.value < 100, reason: `${v.value} ${v.value < 100 ? '<' : '>='} 100 (the configured ceiling for one step)` }) });
  w.contract({ id: 'step', kind: 'tick', in: { state: int }, out: { state: int } });
  w.implement({ id: 'step/1', implements: 'step', uses: ['pos', 'small'], run: ({ state }, ctx) => { ctx.call('pos', { v: state }); ctx.call('small', { v: state }); return { state: state.value + 1 }; } });
  w.contract({ id: 'hist', in: { s: int }, out: { all: { type: 'array', items: int }, last: int } });
  w.implement({ id: 'hist/1', implements: 'hist', uses: ['step'], run: ({ s }, ctx) => {
    const d = ctx.drive('step', { state: s }, { ticks: 3, collect: ['state'] });
    return { all: d.collected.state, last: d.state };
  } });
  w.run('step', { state: 1 }, { tick: 1 });
  const r = w.run('hist', { s: 0 });
  write('v06-3-pieces-verdicts', [traceToSvg(r.trace, w.part, { title: 'v06-3 collected pieces name their tick; a cache hit lists each verdict on its own line', maxDepth: 1 })]);
  facts['v06-3'] = {
    outputs: r.outputs, cached: r.trace.calls.map((c) => [c.id, c.tick, c.cached]),
    claims: [
      '#1 hist all row labels read gather[0]←@0, gather[1]←@1, gather[2]←@2; last = 3 labelled ←@2.',
      'Children #2 step @0, a hatched cache hit @1 (made by the direct run at tick 1) and @2 (#…); the hit lists "✓ 2 cached verdicts:" then one line per verdict: "✓ pos: 1 >= 0" and "✓ small: 1 < 100 (the configured ceiling…" wrapped inside the box.',
    ],
  };
}

fs.writeFileSync(`${out}/v06-facts.json`, JSON.stringify(facts, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'claims'))]))));
