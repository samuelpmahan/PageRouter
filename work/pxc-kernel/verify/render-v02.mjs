// One picture per v0.2 concept, all from real runs.
import fs from 'node:fs';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, driveToSvg, traceHtml } from '../src/view.mjs';

const out = process.argv[2] ?? 'verify/out';
fs.mkdirSync(out, { recursive: true });
const num = { type: 'number' };
const vec = { type: 'array', items: num };
const w = createWorld({ name: 'v02' });

w.contract({ id: 'leaf', in: { x: num }, out: { y: num } });
w.implement({ id: 'leaf/double', implements: 'leaf', run: ({ x }) => ({ y: x.value * 2 }) });
w.implement({ id: 'leaf/square', implements: 'leaf', run: ({ x }) => ({ y: x.value ** 2 }) });
w.contract({ id: 'atLeast', kind: 'check', in: { value: num, floor: num }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } } });
w.implement({ id: 'atLeast/1', implements: 'atLeast', run: ({ value, floor }) => ({
  accepted: value.value >= floor.value, reason: `${value.value} ${value.value >= floor.value ? '>=' : '<'} ${floor.value}` }) });
w.contract({ id: 'duel', in: { x: num }, out: { a: num, b: num, pair: vec, aWins: { type: 'boolean' } } });
w.implement({ id: 'duel/1', implements: 'duel', uses: ['leaf', 'atLeast'], run: ({ x }, ctx) => {
  const a = ctx.call('leaf', { x }, { slot: 'A' }).y;
  const b = ctx.call('leaf', { x }, { slot: 'B' }).y;
  const v = ctx.call('atLeast', { value: a, floor: b });
  return { a, b, pair: ctx.gather([a, b]), aWins: v.accepted };
} });
const duel = w.run('duel', { x: 3 }, { fill: { 'leaf#A': 'leaf/double', 'leaf#B': 'leaf/square' } });

w.contract({ id: 'split', in: { v: vec }, out: { a: num, b: num } });
w.implement({ id: 'split/1', implements: 'split', run: ({ v }, ctx) => ({ a: ctx.at(v, 0), b: ctx.at(v, 1) }) });
w.contract({ id: 'swap', in: { v: vec }, out: { v: vec } });
w.compose({ id: 'swap/composed', implements: 'swap', steps: [{ name: 's', call: 'split', bind: { v: '$in.v' } }], returns: { v: { gather: ['s.b', 's.a'] } } });
const sw = w.run('swap', { v: [10, 20] });
const sw2 = w.run('swap', { v: sw.refs.v });

w.contract({ id: 'count', kind: 'tick', in: { state: { type: 'integer' } }, out: { state: { type: 'integer' } } });
w.implement({ id: 'count/mod16', implements: 'count', run: ({ state }) => ({ state: (state.value + 1) % 16 }) });
const drive = w.drive('count', { state: 13 }, { ticks: 6 });

w.contract({ id: 'divide', in: { a: num, b: num }, out: { q: num } });
w.implement({ id: 'divide/1', implements: 'divide', run: ({ a, b }) => { if (b.value === 0) throw new Error('division by zero'); return { q: a.value / b.value }; } });
w.contract({ id: 'ratio', in: { a: num, b: num }, out: { q: num } });
w.implement({ id: 'ratio/1', implements: 'ratio', uses: ['divide'], run: (i, ctx) => ({ q: ctx.call('divide', i).q }) });
let errTrace = null;
try { w.run('ratio', { a: 1, b: 0 }); } catch (e) { errTrace = e.trace; }

const pages = {
  'v02-1-slots-check-gather': traceToSvg(duel.trace, w.part, { title: 'V1  duel(x=3): leaf#A = double, leaf#B = square in one run; check; gather' }),
  'v02-2-gather-crossrun': [traceToSvg(sw.trace, w.part, { title: 'V2a  swap([10,20]) — composition returns gather[s.b, s.a]' }),
    traceToSvg(sw2.trace, w.part, { title: `V2b  swap(output of run ${sw.receipt.runId}) — input arrives as a cross-run Ref` })],
  'v02-3-drive': driveToSvg(drive.receipts, w.part, { title: 'V3  drive(count mod 16) from state 13 for 6 ticks', describe: (s) => `state ${s}` }),
  'v02-4-error': traceToSvg(errTrace, w.part, { title: 'V4  ratio(1, 0): the throw leaves a trace' }),
};
for (const [name, svg] of Object.entries(pages)) fs.writeFileSync(`${out}/${name}.html`, traceHtml([svg].flat()));
fs.writeFileSync(`${out}/v02-facts.json`, JSON.stringify({ duel: duel.outputs, verdicts: duel.receipt.verdicts, swap: [sw.outputs, sw2.outputs], driveStates: drive.receipts.map((r) => w.part(r.outputs.state)), driveRuns: drive.receipts.map((r) => r.runId), stats: w.stats() }, null, 1));
console.log(Object.keys(pages).join(' '));
