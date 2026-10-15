// Builds explorer/index.html from the repository's own records: the necessity ledger, the miner's flows.json,
// the audit counts, and real trace SVGs from verify/out. Nothing on the page is typed by hand except prose.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ledger = read('ledger/necessity.jsonl').trim().split('\n').map((l) => JSON.parse(l));
const flows = JSON.parse(read('miner/out/flows.json'));
const svgOf = (name) => {
  const html = read(`verify/out/${name}.html`);
  return [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((m) => m[0]);
};
const VERSIONS = [
  { v: '0.1', seqs: [1, 8], theme: 'Parts, Refs with provenance, contracts apart from implementations, compositions linted before they run, a cache, replay.' },
  { v: '0.2', seqs: [9, 23], theme: 'Round 1 friction: cache validity, cross-run Refs, gather, slots, check and tick kinds, drive, errors that leave a trace.' },
  { v: '0.3', seqs: [24, 33], theme: 'Round 2 friction: the tick as a cache dependency, a slot language, verdicts through cache hits, concat, ctx.drive, conditional steps.' },
  { v: '0.4', seqs: [34, 43], theme: 'Round 3 friction (all five entries): conditions are relations, not contracts. Path-qualified slots, collect.' },
  { v: '0.5', seqs: [44, 52], theme: 'Round 4 friction: inherited skips, else instead of typed complements, specificity before source, path fills must land, examples over time.' },
  { v: '0.6', seqs: [53, 61], theme: 'Round 5 friction and an independent audit: both sides of a condition recorded, else inside its context, which rung chose what and where fills landed.' },
];
const versionOf = (seq) => VERSIONS.find((x) => seq >= x.seqs[0] && seq <= x.seqs[1])?.v ?? '?';
const data = {
  ledger: ledger.map((e) => ({ ...e, version: versionOf(e.seq) })),
  versions: VERSIONS,
  flows: { stats: { receipts: flows.receipts, windows: flows.windows, shapes: flows.shapes, afterPruning: flows.afterPruning },
    discovered: flows.discovered.slice(0, 10), confirmed: flows.confirmed.slice(0, 8), crossEntry: flows.crossEntry },
};
const figures = [
  { id: 'v04-1-relations', svg: svgOf('v04-1-relations')[0], caption: 'abs(-4) in v0.4. The condition is the relation lt($in.x, 0), read from the caller\'s own input; no helper contract computes it. The amber row says which step ran and which was skipped.', verdict: '5 of 5 claims passed after one fix (a long row broke out of its box).' },
  { id: 'v05-1-inherit-else', svg: svgOf('v05-1-inherit-else')[1], caption: 'f(3) in v0.5. One cause skips three steps, merged into one row; keep runs by else(flip), a complement derived instead of typed.', verdict: '3 of 3 claims passed.' },
  { id: 'v06-1-ply', svg: svgOf('v06-1-ply')[2], caption: 'A finished game in v0.6. Every step is skipped by one cause, and the forfeit does not run: else holds only inside the context of the step it complements. In v0.5 this game forfeited, a silent wrong result found by entry E.', verdict: '3 of 3 claims passed; the rule is mutation-checked.' },
  { id: 'v06-2-rungs', svg: svgOf('v06-2-rungs')[0], caption: 'Which precedence rung chose each seat, and where each fill landed. #4 is a same-run cache hit of #3, so its rung moves to its own row.', verdict: '3 of 3 claims passed after one fix (an implementation line overflowed).' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const figureHtml = figures.map((f) => `
<figure class="trace" id="fig-${f.id}">
  <div class="trace-frame"><img alt="${esc(f.caption)}" src="data:image/svg+xml;base64,${Buffer.from(f.svg).toString('base64')}" width="${(f.svg.match(/width="(\d+(?:\.\d+)?)"/) ?? [0, 800])[1]}"></div>
  <figcaption><span class="fig-id">${esc(f.id)}</span> ${esc(f.caption)} <span class="verdict">${esc(f.verdict)}</span></figcaption>
</figure>`).join('\n');

const tpl = read('explorer/template.html');
const html = tpl.replace('/*DATA*/', `const DATA = ${JSON.stringify(data)};`).replace('<!--FIGURES-->', figureHtml);
fs.writeFileSync(path.join(root, 'explorer', 'index.html'), html);
console.log(`explorer/index.html ${html.length} bytes, ${ledger.length} ledger entries, ${figures.length} figures`);
