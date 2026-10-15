// One picture per v0.5 concept, all from real runs. Claims are printed to v05-facts.json before the PNGs are looked at.
import fs from 'node:fs';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, traceHtml } from '../src/view.mjs';

const out = process.argv[2] ?? 'verify/out';
fs.mkdirSync(out, { recursive: true });
const num = { type: 'number' };
const int = { type: 'integer' };
const str = { type: 'string' };
const facts = {};
const write = (name, sections) => fs.writeFileSync(`${out}/${name}.html`, traceHtml(sections));

function base() {
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } });
  w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } });
  w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } });
  w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  return w;
}

// ---------------------------------------------------------------- 1. inherited skips and else
{
  const w = base();
  w.contract({ id: 'f', in: { x: num }, out: { y: num } });
  w.compose({ id: 'f/c', implements: 'f', steps: [
    { name: 'flip', call: 'neg', when: { lt: ['$in.x', 0] }, bind: { x: '$in.x' } },
    { name: 'sqr', call: 'sq', bind: { x: 'flip.y' } },
    { name: 'again', call: 'neg', bind: { x: 'sqr.y' } },
    { name: 'keep', call: 'id', when: { else: ['flip'] }, bind: { x: '$in.x' } },
  ], returns: { y: { one: ['again.y', 'keep.y'] } } });
  const neg = w.run('f', { x: -3 });
  const pos = w.run('f', { x: 3 });
  w.contract({ id: 'kind', in: { k: str, x: num }, out: { y: num } });
  w.compose({ id: 'kind/c', implements: 'kind', steps: [
    { name: 'a', call: 'neg', when: { eq: ['$in.k', { literal: 'neg' }] }, bind: { x: '$in.x' } },
    { name: 'b', call: 'sq', when: { eq: ['$in.k', { literal: 'sq' }] }, bind: { x: '$in.x' } },
    { name: 'other', call: 'id', when: { else: ['a', 'b'] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['a.y', 'b.y', 'other.y'] } } });
  const k = w.run('kind', { k: 'zzz', x: 3 });
  write('v05-1-inherit-else', [
    traceToSvg(neg.trace, w.part, { title: 'v05-1a f(-3): flip ran, sqr and again inherit it, keep is its else' }),
    traceToSvg(pos.trace, w.part, { title: 'v05-1b f(3): one cause skips flip, sqr, again; else runs keep' }),
    traceToSvg(k.trace, w.part, { title: "v05-1c kind('zzz'): a three-way otherwise" }),
  ]);
  facts['v05-1'] = {
    neg: { y: neg.outputs.y, calls: neg.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: neg.trace.decisions.map((d) => [d.label, d.value]) },
    pos: { y: pos.outputs.y, calls: pos.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: pos.trace.decisions.map((d) => [d.label, d.value]) },
    kind: { y: k.outputs.y, decisions: k.trace.decisions.map((d) => [d.label, d.value]) },
    claims: [
      'A: children #2 neg, #3 sq, #4 neg; y = -9 via a purple bracket from #4; one amber row "◇ flip = true → ran read lt($in.x=-3, 0)" and one grey row "◇ keep = false → skipped read else(flip: lt($in.x=-3, 0))".',
      'B: one child #2 id; ONE grey row "◇ flip, sqr, again = false → skipped read lt($in.x=3, 0)"; an amber row "◇ keep = true → ran read else(flip: …)"; y = 3 from #2.',
      'C: one child id; two grey rows for a and b reading eq($in.k="zzz", "neg") and eq($in.k="zzz", "sq") with the literal strings visible; an amber row for other reading else(a: …; b: …), wrapped inside the box.',
    ],
  };
}

// ---------------------------------------------------------------- 2. collect and at: a selection draws only what it selects
{
  const w = createWorld();
  w.contract({ id: 'step', kind: 'tick', in: { state: int }, out: { state: int, out: int } });
  w.implement({ id: 'step/1', implements: 'step', run: ({ state }) => ({ state: state.value + 1, out: state.value * 10 }) });
  w.contract({ id: 'hist', in: { s: int }, out: { last: int, third: int, all: { type: 'array', items: int } } });
  w.implement({ id: 'hist/1', implements: 'hist', uses: ['step'], run: ({ s }, ctx) => {
    const d = ctx.drive('step', { state: s }, { ticks: 8, collect: ['out'] });
    return { last: ctx.at(d.collected.out, 7), third: ctx.at(d.collected.out, 2), all: d.collected.out };
  } });
  const r = w.run('hist', { s: 0 });
  write('v05-2-selection', [traceToSvg(r.trace, w.part, { title: 'v05-2 collect over 8 ticks; at(…, 7) and at(…, 2) draw one edge each' })]);
  facts['v05-2'] = {
    outputs: r.outputs,
    lastFrom: r.trace.out.last.from,
    claims: [
      '#1 hist has eight children "#2 step @0" … "#9 step @7".',
      'Row "last = 70": exactly one dashed purple bracket, from #9 out (tick 7), labelled [7], not a wall of pieces.',
      'Row "third = 20": exactly one dashed purple bracket, from #4 out (tick 2), labelled [2], in a lane of its own that no solid bracket covers.',
      'Row "all = [0,10,…,70]": eight labels gather[0]…gather[7] (eight distinct sources, so nothing groups) and eight brackets, one per tick call, each in its own lane.',
      'A drive row "⟳ step: 8 ticks, 0–7 stopped by ticks".',
    ],
  };
}

// ---------------------------------------------------------------- 3. long expressions and errors wrap; the fill line; specificity
{
  const w = createWorld();
  w.contract({ id: 'pick', in: { x: int }, out: { y: int } });
  w.implement({ id: 'pick/a', implements: 'pick', run: ({ x }) => ({ y: x.value + 1 }) });
  w.implement({ id: 'pick/b', implements: 'pick', run: ({ x }) => ({ y: x.value + 100 }) });
  w.contract({ id: 'game', in: { x: int, mode: str }, out: { me: int, model: int } });
  w.compose({ id: 'game/c', implements: 'game', steps: [
    { name: 'me', call: 'pick', slot: 'me', when: { and: [{ ne: ['$in.mode', { literal: 'spectate' }] }, { ge: ['$in.x', 0] }, { lt: ['$in.x', 1000] }, { ne: ['$in.mode', { literal: 'replay-only' }] }] }, bind: { x: '$in.x' } },
    { name: 'model', call: 'pick', slot: 'model', bind: { x: '$in.x' } },
  ], returns: { me: { first: ['me.y', { literal: -1 }] }, model: 'model.y' } });
  w.select('pick', 'pick/a');
  w.select('pick', 'pick/a', 'model');
  const fill = { pick: 'pick/b', 'game/pick#model': 'pick/b' };
  const r = w.run('game', { x: 5, mode: 'play' }, { fill: { pick: 'pick/b' } });
  const r2 = w.run('game', { x: 5, mode: 'play' }, { fill, cache: false });
  w.contract({ id: 'boom', in: { x: int }, out: { y: int } });
  w.implement({ id: 'boom/1', implements: 'boom', run: (_, ctx) => ctx.fault('the scheduler refused this assignment because the integrator queue is already at its configured limit of three pending merges', 'QUEUE_FULL') });
  let err;
  try { w.run('boom', { x: 1 }); } catch (e) { err = e; }
  write('v05-3-wrap-fill', [
    traceToSvg(r.trace, w.part, { title: "v05-3a fill { pick: pick/b }: the pinned model seat keeps pick/a", receipt: r.receipt }),
    traceToSvg(r2.trace, w.part, { title: 'v05-3b a path fill reaches the model seat on purpose', receipt: r2.receipt }),
    traceToSvg(err.trace, w.part, { title: 'v05-3c a long fault message wraps inside its box' }),
  ]);
  facts['v05-3'] = {
    a: { outputs: r.outputs, fillConsulted: r.receipt.fillConsulted },
    b: { outputs: r2.outputs, fillConsulted: r2.receipt.fillConsulted },
    claims: [
      'A: purple line under the title "fill: pick → pick/b"; #2 pick#me reads pick/b, #3 pick#model reads pick/a; me = 105, model = 6.',
      'A: the decision row for me prints and(ne($in.mode="play", "spectate"), ge($in.x=5, 0), …) broken over several lines, all inside the box.',
      'B: fill line lists both keys, neither marked "(not consulted)"; #3 pick#model reads pick/b; model = 105.',
      'C: #1 boom header red; "✗ QUEUE_FULL:" then the whole message, unquoted, wrapped over several lines inside the box, ending "pending merges".',
    ],
  };
}

fs.writeFileSync(`${out}/v05-facts.json`, JSON.stringify(facts, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'claims'))]))));
