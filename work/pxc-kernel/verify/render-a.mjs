// Render contest A traces so each EXPLAIN.md claim can be checked against a picture.
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, traceHtml } from '../src/view.mjs';
import { register } from '../contest/a-numeric/index.mjs';

const outDir = process.argv[2] ?? 'verify/out';
fs.mkdirSync(outDir, { recursive: true });
const w = createWorld({ name: 'a' });
register(w);

const z = w.run('stat.zScores', { values: [2, 4, 6] });
const ls = w.run('lin.leastSquares', { matrix: [[1, 0], [1, 1], [1, 2], [1, 3]], vector: [1, 3, 5, 7] });
const lsAgain = w.run('lin.leastSquares', { matrix: [[1, 0], [1, 1], [1, 2], [1, 3]], vector: [1, 3, 5, 7] });
const wel = w.run('stat.zScores', { values: [2, 4, 6] }, { cache: false, fill: { 'stat.variance': 'stat.variance/welford' } });

const svgs = {
  'a1-zscores': traceToSvg(z.trace, w.part, { title: 'A1  stat.zScores([2,4,6]) — composed, default fill' }),
  'a2-leastsquares': traceToSvg(ls.trace, w.part, { title: 'A2  lin.leastSquares — normal equations, first run' }),
  'a3-leastsquares-cached': traceToSvg(lsAgain.trace, w.part, { title: 'A3  lin.leastSquares — identical second run' }),
  'a4-zscores-welford': traceToSvg(wel.trace, w.part, { title: 'A4  stat.zScores([2,4,6]) — fill stat.variance = welford, cache off' }),
};
for (const [name, svg] of Object.entries(svgs)) {
  fs.writeFileSync(path.join(outDir, `${name}.html`), traceHtml([svg]));
}
fs.writeFileSync(path.join(outDir, 'a-facts.json'), JSON.stringify({
  zScores: z.outputs, leastSquares: ls.outputs, cachedSecondRun: lsAgain.trace.cached,
  welfordImpl: wel.trace.calls[1].calls[0].impl, stats: w.stats(),
}, null, 1));
console.log(Object.keys(svgs).join(' '));
