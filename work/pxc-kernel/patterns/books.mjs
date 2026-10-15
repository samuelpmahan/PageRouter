// Three flip books, first written by hand (19, 27 and 31 lines, no pass/fail), now written on patterns/flipbook.mjs.
// Each one now says only what is particular to it: what to run, how to draw a state, how to label a step.
// Run: node patterns/books.mjs  → patterns/out/book-*.png contact sheets, and a non-zero exit if any frame breaks the promise.
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg } from '../src/view.mjs';
import { shoot, problems, callSteps, tickSteps } from './flipbook.mjs';
import { register as registerNumeric } from '../contest/a-numeric/index.mjs';
import { register as registerGame, driveMatch } from '../contest/e-game/index.mjs';

const books = {};

// 1. A kernel run, one call at a time.
{
  const w = createWorld(); registerNumeric(w);
  const r = w.run('lin.leastSquares', { matrix: [[1, 0], [1, 1], [1, 2]], vector: [1, 3, 5] }, { cache: false });
  books['book-1-run'] = { title: 'lin.leastSquares, one call at a time', steps: callSteps(r.trace), render: (t) => traceToSvg(t, w.part, { valueChars: 30 }) };
}

// 2. A drive, one tick at a time.
{
  const w = createWorld(); registerGame(w);
  const d = driveMatch(w, 'center-corners', 'first-empty');
  const s = 90;
  const board = ({ board: cells }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${3 * s + 20}" height="${3 * s + 20}">${[1, 2].map((i) =>
    `<line x1="${10 + i * s}" y1="10" x2="${10 + i * s}" y2="${10 + 3 * s}" stroke="#55605c" stroke-width="3"/><line x1="10" y1="${10 + i * s}" x2="${10 + 3 * s}" y2="${10 + i * s}" stroke="#55605c" stroke-width="3"/>`).join('')}${cells.map((c, i) => {
    const x = 10 + (i % 3) * s + s / 2; const y = 10 + Math.floor(i / 3) * s + s / 2;
    return c === 1 ? `<path d="M${x - 26},${y - 26} L${x + 26},${y + 26} M${x + 26},${y - 26} L${x - 26},${y + 26}" stroke="#1b1d1c" stroke-width="9" stroke-linecap="round"/>`
      : c === 2 ? `<circle cx="${x}" cy="${y}" r="28" fill="none" stroke="#1b1d1c" stroke-width="9"/>` : '';
  }).join('')}</svg>`;
  const moveLabel = (st, r) => { const m = st.moves.at(-1); return `+ ${m.player === 1 || m.mark === 'X' ? 'X' : 'O'} at cell ${m.cell ?? m} (tick ${r.tick}, run ${r.runId})${st.status !== 'ongoing' ? ` · ${/^[XO]$/.test(st.status) ? `${st.status} wins` : st.status}` : ''}`; };
  books['book-2-game'] = { title: 'center-corners (X) against first-empty (O), one move at a time', render: board,
    steps: [{ label: 'empty board', state: { board: Array(9).fill(0) } }, ...tickSteps(d.receipts, w.part, { label: moveLabel })] };
}

// 3. One picture, one visual layer at a time.
{
  const num = { type: 'number' }; const bool = { type: 'boolean' };
  const w = createWorld();
  w.contract({ id: 'neg', in: { x: num }, out: { y: num } }); w.implement({ id: 'neg/1', implements: 'neg', run: ({ x }) => ({ y: -x.value }) });
  w.contract({ id: 'sq', in: { x: num }, out: { y: num } }); w.implement({ id: 'sq/1', implements: 'sq', run: ({ x }) => ({ y: x.value ** 2 }) });
  w.contract({ id: 'id', in: { x: num }, out: { y: num } }); w.implement({ id: 'id/1', implements: 'id', run: ({ x }) => ({ y: x }) });
  w.contract({ id: 'turn', in: { on: bool, x: num }, out: { y: num } });
  w.compose({ id: 'turn/c', implements: 'turn', steps: [
    { name: 'check', call: 'id', when: { eq: ['$in.on', true] }, bind: { x: '$in.x' } },
    { name: 'apply', call: 'sq', when: { gt: ['check.y', 0] }, bind: { x: 'check.y' } },
    { name: 'record', call: 'id', bind: { x: 'apply.y' } },
    { name: 'forfeit', call: 'neg', when: { else: ['apply'] }, bind: { x: '$in.x' } },
  ], returns: { y: { first: ['record.y', 'forfeit.y', '$in.x'] } } });
  const r = w.run('turn', { on: true, x: 3 });
  const edge = (kind) => [`.e-${kind}`, `.dot-${kind}`, `.arrow-${kind}`];
  books['book-3-layers'] = { title: 'one trace picture, one visual layer at a time', picture: traceToSvg(r.trace, w.part), layers: [
    { label: 'boxes (every call, its values and decisions)', points: { layer: 'boxes' } },
    { label: '+ green: the caller\'s inputs', points: { layer: 'input' }, hide: edge('input') },
    { label: '+ blue: an earlier call\'s output into a later call', points: { layer: 'call' }, hide: edge('call') },
    { label: '+ purple: where each output came from', points: { layer: 'out' }, hide: edge('out') },
    { label: '+ amber: what each decision read', points: { layer: 'dec' }, hide: edge('dec') },
  ] };
}

let failed = 0;
for (const [name, book] of Object.entries(books)) {
  const report = shoot(book, `patterns/out/${name}`, { width: 760 });
  const bad = problems(report);
  failed += bad.length;
  console.log(`${name}: ${report.length} frames, ${bad.length ? bad.join('; ') : 'every frame adds, nothing earlier moves'}`);
}
process.exit(failed ? 1 : 0);
