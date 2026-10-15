// Render contest C (fitted models) from real runs (kernel v0.4). Usage: node verify/render-c-fitted.mjs [outDir]
// Every new picture has its claims written into c-fitted-facts.json under `claims` BEFORE the PNG is looked at.
import fs from 'node:fs';
import path from 'node:path';
import { createWorld } from '../src/kernel.mjs';
import { traceToSvg, traceHtml, driveToSvg } from '../src/view.mjs';
import { register } from '../contest/c-fitted/index.mjs';
import { regressionData, blobs } from '../contest/c-fitted/data.mjs';
import { regressionSvg, clusterSvg, lineageSvg } from '../contest/c-fitted/view.mjs';
import * as L from '../contest/c-fitted/lineage.mjs';

const outDir = process.argv[2] ?? 'verify/out';
fs.mkdirSync(outDir, { recursive: true });
const w = createWorld({ name: 'c-fitted' });
register(w);
const LW = L.lineageFor(w); // round 4: lineage reads x-role annotations from this world's contracts
const LEAKY = { 'fitted.pipeline.regression': 'fitted.pipeline.regression/leaky' };
const write = (name, ...svgs) => fs.writeFileSync(path.join(outDir, `c-fitted-${name}.html`), traceHtml(svgs));
const facts = {};

// ---- 1. the hand-checkable pipeline run (ridge example), full trace and a folded copy of the same trace
const hand = { matrix: [[1], [1], [3], [3], [5], [0]], targets: [3, 3, 7, 7, 11, 1], groups: [1, 1, 2, 2, 3, 3], period: 3, penalty: 4 };
const clean = w.run('fitted.pipeline.regression', hand);
const leaky = w.run('fitted.pipeline.regression', hand, { fill: LEAKY });
write('1-pipeline', traceToSvg(clean.trace, w.part, { title: 'C1  fitted.pipeline.regression (train-only), 6 rows, ridge penalty 4: full trace', valueChars: 70 }));
write('1b-pipeline-folded', traceToSvg(clean.trace, w.part, { title: 'C1b  same run, maxDepth 1 (children of each step hidden)', maxDepth: 1, valueChars: 70 }));
write('5-pipeline-leaky-folded', traceToSvg(leaky.trace, w.part, { title: 'C5  same inputs, fill = pipeline/leaky (standardizer fitted on all rows), maxDepth 1', maxDepth: 1, valueChars: 70 }));
write('1c-lineage-clean', lineageSvg({ title: 'C1c  model lineage read from the C1 trace: train-only pipeline', fits: L.lineageFor(w).trainingRows(clean.trace), pairs: L.lineageFor(w).fitApplyPairs(clean.trace) }));
write('5b-lineage-leaky', lineageSvg({ title: 'C5b  model lineage read from the leaky pipeline trace', fits: L.lineageFor(w).trainingRows(leaky.trace), pairs: L.lineageFor(w).fitApplyPairs(leaky.trace) }));
facts.hand = { clean: clean.outputs, leaky: leaky.outputs, pairs: L.lineageFor(w).fitApplyPairs(clean.trace), trainingRows: L.lineageFor(w).trainingRows(clean.trace), leakyTrainingRows: L.lineageFor(w).trainingRows(leaky.trace) };

// ---- 2. one-feature plot: interleaved groups, OLS and baseline lines mapped back to original x via kernel runs
const d = regressionData({ weights: [0.75], intercept: 2 });
const pipe = (data, penalty, fill) => w.run('fitted.pipeline.regression', { matrix: data.matrix, targets: data.targets, groups: data.groups, period: 4, penalty }, fill ? { fill } : {});
const lineOf = (run, xs, label, color, dash) => {
  const grid = xs.map((x) => [x]);
  const z = w.run('fitted.standardizer.apply', { model: run.outputs.standardizer, matrix: grid });
  const y = w.run('fitted.linear.apply', { model: run.outputs.regression, matrix: z.outputs.matrix });
  return { label, color, dash, points: xs.map((x, i) => ({ x, y: y.outputs.values[i] })) };
};
const split = w.run('fitted.split.byGroup', { groups: d.groups, period: 4 }).outputs;
const pick = (rows) => rows.map((i) => ({ x: d.matrix[i][0], y: d.targets[i] }));
const ols = pipe(d, 0);
const xs = [Math.min(...d.matrix.map((r) => r[0])), Math.max(...d.matrix.map((r) => r[0]))];
const trainMean = w.run('fitted.constant.fit', { values: split.trainRows.map((i) => d.targets[i]) }).outputs.model.value;
write('2-regression-plot', regressionSvg({
  title: 'C2  one feature, groups interleaved along x: train / test / fitted lines',
  train: pick(split.trainRows), test: pick(split.testRows),
  lines: [
    { label: `truth: y = 2 + 0.75 x`, color: '#8a948f', dash: '2 4', points: xs.map((x) => ({ x, y: 2 + 0.75 * x })) },
    lineOf(ols, xs, 'OLS fitted on standardized train', '#1b1d1c'),
    { label: `baseline: train mean ${trainMean.toFixed(3)}`, color: '#b0302a', dash: '7 4', points: xs.map((x) => ({ x, y: trainMean })) },
  ],
  notes: [`test groups ${split.testGroups.join(', ')}`, `OLS test MSE ${ols.outputs.mse.toFixed(4)}`, `baseline test MSE ${ols.outputs.baselineMse.toFixed(4)}`],
}));
facts.plot = { split, olsMse: ols.outputs.mse, baselineMse: ols.outputs.baselineMse, trainMean, coefficients: ols.outputs.regression, standardizer: ols.outputs.standardizer };

// ---- 3. k-means: fit, then predict through the kernel, colour by assigned cluster
const pts = blobs();
const km = w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed: 11 });
const pr = w.run('fitted.kmeans.predict', { model: km.outputs.model, matrix: pts });
write('3-kmeans', clusterSvg({
  title: 'C3  k-means, k = 2, seed 11: colour and shape = predicted cluster, X = centroid',
  points: pts, labels: pr.outputs.labels, centroids: km.outputs.model.centroids,
  notes: [`iterations ${km.outputs.iterations}`, `converged ${km.outputs.converged}`, `${pts.length} points`],
}));
write('3b-kmeans-trace', traceToSvg(km.trace, w.part, { title: 'C3b  kmeans.fit (seed 11): init, then ctx.drive (@0 @1 @2) with collect' }));
facts.kmeansTrace = { drives: km.trace.drives, history: km.outputs.history.length, historyFrom: km.trace.out.history.from.pieces.map((p) => p.from.call), claims: [
  'R4 #1 kmeans.fit: rows model, iterations = 3, converged = true, history = 3 states; a drive row `⟳ fitted.kmeans.step: 3 ticks, 0-2 stopped by until` (or similar wording) inside #1.',
  'R4 children: #2 init, #3 step @0, #6 step @1, #9 step @2 (was #3 #7 #11 in round 3: no more `same` node); each step has only assign and update children, #9 only assign.',
  'R4 decision rows: on #3 and #6 one row `labels unchanged? = false` with `ran update, skipped keep centroids`; on #9 `= true`, `ran keep centroids, skipped update`; each row names the test, eq(...), with amber edges to both operands (the assign labels and the state labels).',
  'R4 history: three purple brackets from the history row of #1 to the state rows of #3, #6, #9; the converged row bracket goes to #9 converged.',
  'R4 model rows: `gather[centroids][0]<-...` target-source labels, still pointing at #9 state with the sort swap (0 from centroids.1, 1 from centroids.0).'],
  calls: km.trace.calls.map((c) => `#${c.id} ${c.contract}${c.tick !== undefined ? ` @${c.tick}` : ''}`), decisions: L.decisionsOf(km.trace), converged: km.trace.out.converged.from };
facts.kmeans = { model: km.outputs.model, iterations: km.outputs.iterations, converged: km.outputs.converged, labels: pr.outputs.labels, randomDraws: km.receipt.randomDraws };

// ---- 4. leakage: ordinary least squares is unchanged, ridge is not. Test group sits beyond the train range.
const drift = { matrix: Array.from({ length: 12 }, (_, i) => [i]), groups: Array.from({ length: 12 }, (_, i) => Math.floor(i / 3) + 1) };
drift.targets = drift.matrix.map(([x], i) => 2 + 0.75 * x + (((i * 37) % 11) - 5) / 10);
const dsplit = w.run('fitted.split.byGroup', { groups: drift.groups, period: 4 }).outputs;
const dx = [0, 11];
const dp = (penalty, fill) => pipe(drift, penalty, fill);
const rc = dp(2); const rl = dp(2, LEAKY); const oc = dp(0); const ol = dp(0, LEAKY);
const maxDiff = (a, b) => Math.max(...a.outputs.predictions.map((p, i) => Math.abs(p - b.outputs.predictions[i])));
write('4-leakage-plot', regressionSvg({
  title: 'C4  leakage: standardizer fitted on train only vs on all rows, ridge penalty 2',
  train: dsplit.trainRows.map((i) => ({ x: drift.matrix[i][0], y: drift.targets[i] })),
  test: dsplit.testRows.map((i) => ({ x: drift.matrix[i][0], y: drift.targets[i] })),
  lines: [
    lineOf(rc, dx, 'ridge, standardizer on train', '#1f8a4c'),
    lineOf(rl, dx, 'ridge, standardizer on ALL rows', '#b0302a', '3 3'),
  ],
  notes: [
    `ridge test MSE, train-only: ${rc.outputs.mse.toFixed(3)}`, `ridge test MSE, leaky: ${rl.outputs.mse.toFixed(3)}`,
    `ridge max prediction diff: ${maxDiff(rc, rl).toFixed(4)}`, `OLS max prediction diff: ${maxDiff(oc, ol).toExponential(1)}`,
  ],
}));
facts.leakage = { ridgeMaxDiff: maxDiff(rc, rl), olsMaxDiff: maxDiff(oc, ol), olsPredictionHashesEqual: oc.refs.predictions.hash === ol.refs.predictions.hash,
  ridgeMse: [rc.outputs.mse, rl.outputs.mse], testRows: dsplit.testRows };

// ---- 6. the same linear model applied in a later run, passed as a Ref: the kernel records the cross-run edge
const X = [[0], [1], [2], [3]]; const y = [1, 3, 5, 7];
const f1 = w.run('fitted.linear.fit', { matrix: X, targets: y, penalty: 0 });
const later = w.run('fitted.linear.apply', { model: f1.refs.model, matrix: [[4]] });
const plain = w.run('fitted.linear.apply', { model: f1.outputs.model, matrix: [[4]] });
const viaPipe = w.run('fitted.linear.apply', { model: clean.refs.regression, matrix: [[3], [-2]] });
write('6-apply-later-run', traceToSvg(later.trace, w.part, { title: `C6  fitted.linear.apply in run ${later.receipt.runId}, model Ref from run ${f1.receipt.runId}` }),
  traceToSvg(plain.trace, w.part, { title: `C6b  run ${plain.receipt.runId}: plain value, no edge` }));
const pairsLater = L.lineageFor(w).fitApplyPairs(later.trace, later.receipt.runId);
const pairsPlain = L.lineageFor(w).fitApplyPairs(plain.trace, plain.receipt.runId);
const pairsPipe = L.lineageFor(w).fitApplyPairs(viaPipe.trace, viaPipe.receipt.runId);
const innerRef = w.ref(clean.receipt.runId, 7, 'model'); // v0.3: the standardizer fit INSIDE the pipeline run, addressed by call id
const viaInner = w.run('fitted.standardizer.apply', { model: innerRef, matrix: [[5], [0]] });
const pairsInner = L.lineageFor(w).fitApplyPairs(viaInner.trace, viaInner.receipt.runId);
write('6c-lineage-cross-run', lineageSvg({ title: 'C6c  lineage across runs, read by following edges (no scan of runs()); row 4 is a world.ref to an inner call',
  fits: [{ run: f1.receipt.runId, fit: 1, contract: 'fitted.linear.fit', note: 'run called directly by the caller' }, { run: clean.receipt.runId, fit: 20, contract: 'fitted.linear.fit', note: 'inside the pipeline run (C1)' },
    { run: clean.receipt.runId, fit: 7, contract: 'fitted.standardizer.fit', note: 'inside the pipeline run (C1), by world.ref(run, 7, model)' },
    { run: null, fit: '', contract: '(no fit found)', note: 'plain-value model: chain ends at a root input' }],
  pairs: [{ ...pairsLater[0], applyRun: later.receipt.runId }, { ...pairsPipe[0], applyRun: viaPipe.receipt.runId }, { ...pairsPlain[0], applyRun: plain.receipt.runId }, { ...pairsInner[0], applyRun: viaInner.receipt.runId }] }));
facts.later = { pairsLater, pairsPipe, pairsPlain, pairsInner, cleanRun: clean.receipt.runId, laterRun: later.receipt.runId, f1Run: f1.receipt.runId, scan: L.lineageFor(w).producersAcrossRuns(f1.refs.model.hash).map((q) => q.run) };

// ---- 7. a model built with gather: fit traces, every field has a bracket to the call that made it
const fit1 = w.run('fitted.linear.fit', { matrix: [[1], [1], [3], [3]], targets: [3, 3, 7, 7], penalty: 4 }, { cache: false });
write('7-model-gather', traceToSvg(fit1.trace, w.part, { title: 'C7  fitted.linear.fit (ridge 4), composition with {gather} model', maxDepth: 1, valueChars: 70 }));
const stdFit = w.run('fitted.standardizer.fit', { matrix: [[1, 0], [3, 4]] }, { cache: false });
write('7b-standardizer-gather', traceToSvg(stdFit.trace, w.part, { title: 'C7b  fitted.standardizer.fit: model = ctx.gather{kind, means, sds}, 2 columns', valueChars: 70 }));
facts.gather = { linear: L.fieldOrigins(fit1.trace, fit1.trace), standardizer: L.fieldOrigins(stdFit.trace, stdFit.trace) };

// ---- 8. the audit as a kernel check
const audOk = w.run('fitted.audit.pipeline', hand, { cache: false });
const audBad = w.run('fitted.audit.pipeline', hand, { cache: false, fill: LEAKY });
write('8-audit-check', traceToSvg(audOk.trace, w.part, { title: 'C8  fitted.audit.pipeline (check), train-only pipeline: accepted', maxDepth: 1, valueChars: 80 }),
  traceToSvg(audBad.trace, w.part, { title: 'C8b  same check, fill pipeline = leaky: rejected', maxDepth: 1, valueChars: 110 }));
facts.audit = { ok: audOk.outputs, bad: audBad.outputs, verdicts: audBad.receipt.verdicts };

// ---- 9. slot fill: the wrong implementation at one call site
const slotRun = w.run('fitted.pipeline.regression', hand, { cache: false, fill: { 'fitted.standardizer.apply#test': 'fitted.standardizer.apply/self-stats' } });
write('9-slot-fill', traceToSvg(slotRun.trace, w.part, { title: 'C9  fill {fitted.standardizer.apply#test: self-stats}: only the #test call site changes', maxDepth: 1, valueChars: 70 }));
const audBlind = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.standardizer.apply#test': 'fitted.standardizer.apply/self-stats' } });
facts.slot = { predictions: slotRun.outputs.predictions, mse: slotRun.outputs.mse, honestMse: clean.outputs.mse, auditAccepts: audBlind.outputs.accepted, provenanceTrainOnly: L.lineageFor(w).trainOnly(slotRun.trace) };

// ---- 10. k-means as a drive over ticks
const init = w.run('fitted.kmeans.init', { matrix: pts, k: 2 }, { seed: 11 });
const dr = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { until: (o) => o.converged, maxTicks: 50, cache: false });
const drCached = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { until: (o) => o.converged, maxTicks: 50 }); // v0.3: every tick is a hit on the entries ctx.drive made inside kmeans.fit (seed 11 above)
const drFirst = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { ticks: 2, cache: false });
const drRest = w.drive('fitted.kmeans.step', { matrix: pts, state: drFirst.state }, { until: (o) => o.converged, maxTicks: 50, startTick: 2, cache: false });
const fmtC = (st) => st.centroids.map((c) => `(${c.map((v) => Number(v.toFixed(1))).join(',')})`).join(' ');
write('10-kmeans-drive', driveToSvg(dr.receipts, w.part, { title: 'C10  k-means as a world.drive, cache off: one run per tick', describe: (st) => fmtC(st), colW: 190 }),
  traceToSvg(dr.receipts[1].trace, w.part, { title: 'C10b  tick 1 alone (cache off)', valueChars: 70 }),
  driveToSvg(drCached.receipts, w.part, { title: 'C10c  same drive, cache on', describe: (st) => fmtC(st), colW: 190 }),
  driveToSvg(drFirst.receipts, w.part, { title: 'C10d  the same fit in two drives: first 2 ticks', describe: (st) => fmtC(st), colW: 190 }),
  driveToSvg(drRest.receipts, w.part, { title: 'C10e  resumed with startTick 2', describe: (st) => fmtC(st), colW: 190 }));
facts.resume = { first: drFirst.receipts.map((r) => r.tick), rest: drRest.receipts.map((r) => r.tick), claims: ['C10d: two cells labelled tick 0 and tick 1; C10e: ONE cell labelled tick 2, `<- run` of the last cell of C10d, state (8,6.9) (1,0.9) (it converged on that tick).'] };
facts.driveCached = { ticks: drCached.ticks, cached: drCached.receipts.map((r) => r.trace.cached), cachedFrom: drCached.receipts.map((r) => r.trace.cachedFrom), kmFitCalls: km.trace.calls.map((c) => `#${c.id} ${c.contract}${c.tick !== undefined ? ` @${c.tick}` : ''}`),
  claims: ['C10: three cells tick 0/1/2, each with a run number and a violet ← run of its predecessor, states (6.1,5.1) (0.5,1) then (8,6.9) (1,0.9) twice; the cells say nothing about cache.',
    'C10b: one box #1 fitted.kmeans.step with tick tag, NOT hatched, children assign / same / update visible, decision row.',
    'C10c: the same three cells, each labelled cached.'] };
facts.drive = { ticks: dr.ticks, final: dr.final, init: init.outputs.state, inputFroms: dr.receipts.map((r) => r.trace.in.state.from) };

// ---- 11. (v0.3) a cache hit that carries a verdict, expanded into its original subtree
{
  const wv = createWorld({ name: 'c-fitted-v03' }); register(wv);
  const first = wv.run('fitted.audit.pipeline', hand);
  const second = wv.run('fitted.audit.pipeline', { ...hand, penalty: 2 });
  const third = wv.run('fitted.audit.standardizer', { model: wv.ref(first.receipt.runId, 2, 'standardizer'), matrix: [[1], [1], [3], [3]] }); // same model and rows as run 1's call #55
  const expand = (n) => wv.node(n.cachedFrom.run, n.cachedFrom.call);
  write('11-cached-verdict-ghost', traceToSvg(first.trace, wv.part, { title: `C11a  run ${first.receipt.runId}: audit.pipeline, penalty 4`, maxDepth: 1, valueChars: 70 }),
    traceToSvg(second.trace, wv.part, { title: `C11b  run ${second.receipt.runId}: penalty 2, audit hit carries a verdict`, maxDepth: 1, expand, valueChars: 70 }),
    traceToSvg(third.trace, wv.part, { title: `C11c  run ${third.receipt.runId}: the audit alone, a root cache hit, expanded`, expand, valueChars: 70 }));
  const hitNode = second.trace.calls.find((c) => c.contract === 'fitted.audit.standardizer');
  facts.cachedVerdict = { firstRun: first.receipt.runId, secondRun: second.receipt.runId, hit: { id: hitNode.id, cachedFrom: hitNode.cachedFrom, verdicts: hitNode.verdicts },
    secondCalls: second.trace.calls.map((c) => `#${c.id} ${c.contract}${c.slot ? `#${c.slot}` : ''} cached=${c.cached}`), receiptVerdicts: second.receipt.verdicts.map((v) => ({ contract: v.contract, accepted: v.accepted, cached: Boolean(v.cached), cachedFrom: v.cachedFrom ?? null })),
    claims: [
      'A: root #1 fitted.audit.pipeline has a green header (check ✓), children #2 fitted.pipeline.regression, #N fitted.split.byGroup, #N+1 fitted.rows.select#train, #N+2 fitted.audit.standardizer, none hatched. (WRONG in the first look: #53 split and #54 select ARE hatched, they reuse the pipeline\'s own calls inside the same run)',
      'B: #2 fitted.pipeline.regression is NOT hatched (penalty differs, so it recomputed). The split, the rows.select#train and the audit.standardizer boxes ARE hatched with "cached from run 1 #<n>".',
      'B: the audit.standardizer box is green (check ✓) with a row naming one cached verdict, "standardizer matches the statistics of the 4 rows given".',
      'B: beneath the audit.standardizer box there are faded dashed ghost boxes labelled (run 1): fitted.standardizer.fit#reference and its children transpose, mean, standardDeviation. (First look: NOT drawn, maxDepth 1 hides them; so C11c draws the audit alone with no maxDepth)',
      'C: run 3 is fitted.audit.standardizer called alone on the same model and rows; it is ONE hatched root #1 "cached from run 1 #55", green check, a cached-verdict row, and beneath it faded dashed ghost boxes (run 1): fitted.standardizer.fit#reference, lin.transpose, stat.mean, stat.standardDeviation, stat.variance.',
      'Receipt B: 2 verdicts, audit.pipeline computed and audit.standardizer cached from run 1.',
    ] };
}

// ---- 12. (v0.4, v0.5 else + inherited skip) ridge and plain least squares as {one} alternatives chosen by relations on the input; no helper contract
{
  const wv = createWorld({ name: 'c-fitted-branch' }); register(wv);
  const X = [[1], [1], [3], [3]]; const yy = [3, 3, 7, 7];
  const ols = wv.run('fitted.linear.fit', { matrix: X, targets: yy, penalty: 0 }, { cache: false });
  const rdg = wv.run('fitted.linear.fit', { matrix: X, targets: yy, penalty: 4 }, { cache: false });
  write('12-ols-or-ridge-decision', traceToSvg(ols.trace, wv.part, { title: 'C12a  linear.fit, penalty 0: plain least squares', maxDepth: 1, valueChars: 70 }),
    traceToSvg(rdg.trace, wv.part, { title: 'C12b  same inputs, penalty 4: ridge', maxDepth: 1, valueChars: 70 }));
  facts.branch = { ols: { coefficients: ols.outputs.model.coefficients, calls: ols.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: L.decisionsOf(ols.trace), decisionFroms: ols.trace.decisions.map((d) => d.from) },
    ridge: { coefficients: rdg.outputs.model.coefficients, calls: rdg.trace.calls.map((c) => `#${c.id} ${c.contract}`), decisions: L.decisionsOf(rdg.trace) },
    helperContractsLeft: wv.contracts().filter((c) => /isRidge|labels\.same/.test(c.id)).length,
    guardCounts: (() => { const src = fs.readFileSync(new URL('../contest/c-fitted/index.mjs', import.meta.url), 'utf8'); const blk = src.slice(src.indexOf("id: 'fitted.linear.fit/leastSquares'"), src.indexOf("id: 'fitted.linear.apply'")); return { penaltyRelationsWritten: (blk.match(/\$in\.penalty', 0\]/g) ?? []).length, typedComplements: (blk.match(/le: \[/g) ?? []).length, elseUsed: (blk.match(/else: \[/g) ?? []).length }; })(),
    claims: [
      'R5 A (penalty 0): #1 linear.fit has two child boxes #2 withIntercept and #3 lin.leastSquares, ids as in round 4. Decision rows: ONE merged grey row `aug, betaRidge = false -> skipped` (betaRidge skipped by inheritance, original cause gt) reading gt($in.penalty, 0), and an amber row `betaPlain = true -> ran` whose read line names `else` and `aug`. coefficients [1, 2].',
      'R5 B (penalty 4): three children #2 withIntercept, #3 ridge.augment, #4 lin.leastSquares. Only TWO decision rows: `aug = true -> ran` (gt($in.penalty, 0)) and `betaPlain = false -> skipped` (else over aug). No row for betaRidge, it ran by inheritance. coefficients [3, 1].',
      'R5: the literal 0 in gt($in.penalty, 0) keeps its value in the expression, and the penalty operand shows its short value (0 in A, 4 in B).',
    ] };
}

// ---- 13. (v0.5) specificity: a slot select is a pin. A contract-wide fill no longer reaches the audit's reference seat, so it no longer
// blinds the audit; the audit is blind only when the experimenter fills the reference slot itself. Drawn on the audit alone (small) with the
// receipt's fill line, then the two fits of a path-filled full run, then the full audit under a contract-wide fill.
{
  const wv = createWorld({ name: 'c-fitted-pin' }); register(wv);
  const SD = 'fitted.standardizer.fit/sample-sd';
  const WRONG = { 'fitted.standardizer.fit': SD };
  const rows = [[1], [1], [3], [3]];
  const modelFromWrong = wv.run('fitted.standardizer.fit', { matrix: rows }, { fill: WRONG, cache: false }).outputs.model; // what the broken fit produced: sd sqrt(4/3), not 1
  const sweepAlone = wv.run('fitted.audit.standardizer', { model: modelFromWrong, matrix: rows }, { cache: false, fill: WRONG });
  const blindAlone = wv.run('fitted.audit.standardizer', { model: modelFromWrong, matrix: rows }, { cache: false, fill: { 'fitted.standardizer.fit#reference': SD } });
  // path fill: break the fit made BENEATH the pipeline only, in a full audit run, and draw just the two fit calls
  const pathRun = wv.run('fitted.audit.pipeline', hand, { cache: false, fill: { 'fitted.pipeline.regression/fitted.standardizer.fit': SD } });
  // v0.6: the call the path key chose is read from receipt.fillReach; the other fit (the pinned #reference) is the one NO key of this run reached
  const reached = pathRun.receipt.fillReach['fitted.pipeline.regression/fitted.standardizer.fit'];
  const fitsIn = []; L.walk(pathRun.trace, (n) => { if (n.contract === 'fitted.standardizer.fit' && (reached.includes(n.id) || n.chosenBy.rung === 'slot select')) fitsIn.push(n); });
  const pathFits = fitsIn.map((n, i) => traceToSvg(n, wv.part, { title: `C13${'cd'[i]}  call #${n.id} ${n.contract}${n.slot ? `#${n.slot}` : ''}, path fill`, maxDepth: 1, valueChars: 80 }));
  const sweepFull = wv.run('fitted.audit.pipeline', hand, { cache: false, fill: WRONG });
  write('13-slot-pin',
    traceToSvg(sweepAlone.trace, wv.part, { title: 'C13a  audit alone, fill {standardizer.fit: sample-sd}: the pinned reference keeps columns, rejected', maxDepth: 1, valueChars: 80, receipt: sweepAlone.receipt }),
    traceToSvg(blindAlone.trace, wv.part, { title: 'C13b  audit alone, fill {standardizer.fit#reference: sample-sd}: the reference slot itself filled wrong, accepted', maxDepth: 1, valueChars: 80, receipt: blindAlone.receipt }),
    ...pathFits,
    traceToSvg(sweepFull.trace, wv.part, { title: 'C13e  full audit.pipeline run under the contract-wide fill: reaches the pipeline fit, not the pinned reference', maxDepth: 1, valueChars: 80, receipt: sweepFull.receipt }));
  facts.pathFill = { outputs: pathRun.outputs, fits: fitsIn.map((n) => `#${n.id} ${n.contract}${n.slot ? `#${n.slot}` : ''} ${n.impl}`), fillReach: pathRun.receipt.fillReach, chosenBy: fitsIn.map((n) => `#${n.id} ${n.chosenBy.rung}${n.chosenBy.key ? ' ' + n.chosenBy.key : ''}`),
    claims: ['C13c and C13d are the two standardizer.fit calls of ONE audit.pipeline run filled with only {fitted.pipeline.regression/fitted.standardizer.fit: sample-sd}: #8 (inside the pipeline) impl line reads fitted.standardizer.fit/sample-sd (denominator "sample", value 1.1547); the call with slot #reference (#55, inside the audit) reads fitted.standardizer.fit/columns (denominator "population", value 1). The run is rejected: accepted = false, no pin was needed. Same ids as round 4.'] };
  facts.pin = { model: modelFromWrong,
    sweepAlone: { outputs: sweepAlone.outputs, fit: sweepAlone.trace.calls.map((n) => `#${n.id} ${n.contract}#${n.slot} ${n.impl} by ${n.chosenBy.rung}`), fillReach: sweepAlone.receipt.fillReach },
    blindAlone: { outputs: blindAlone.outputs, fit: blindAlone.trace.calls.map((n) => `#${n.id} ${n.contract}#${n.slot} ${n.impl} by ${n.chosenBy.rung}`), fillReach: blindAlone.receipt.fillReach },
    sweepFull: { outputs: sweepFull.outputs, fillReach: sweepFull.receipt.fillReach },
    claims: [
      'R5 A (13a): root #1 fitted.audit.standardizer is RED (check x), accepted = false, reason starts "column 0: model has mean 2 sd 1.1547". The #2 fitted.standardizer.fit#reference box reads fitted.standardizer.fit/columns (the pin held under a contract-wide fill). The fill line under the title names fitted.standardizer.fit -> .../sample-sd and marks it (not consulted), because in the audit alone no seat takes a contract fill.',
      'R5 B (13b): root header GREEN (check ok), accepted = true. The #2 fit#reference box reads fitted.standardizer.fit/sample-sd. The fill line names fitted.standardizer.fit#reference -> .../sample-sd with NO (not consulted) mark.',
      'R5 E (13e): full audit.pipeline run, root red (check x), accepted = false; the fill line names fitted.standardizer.fit -> .../sample-sd with NO (not consulted) mark (the pipeline fit consulted it); child boxes include the audit.standardizer.',
    ] };
}

// ---- 14. (v0.3) concat: the augmented rows keep a path into the input rows
{
  const wv = createWorld({ name: 'c-fitted-concat' }); register(wv);
  const aug = wv.run('fitted.ridge.augment', { matrix: [[1, 5], [1, 6]], vector: [7, 8], penalty: 4 }, { cache: false });
  write('14-augment-concat', traceToSvg(aug.trace, wv.part, { title: 'C14  augment, concat', valueChars: 70 }));
  facts.concat = { outputs: aug.outputs, matrixPieces: aug.trace.out.matrix.from.pieces, vectorPieces: aug.trace.out.vector.from.pieces,
    claims: [
      'One box #1 fitted.ridge.augment. Output row `matrix` = [[1,5],[1,6],[0,2]] carries labels gather[0]←[0] and gather[1]←[1] (a path back into the input matrix) and a bare gather[2] for the computed row. (First look: there is no word `computed`; the bare label is the only sign)',
      'Output row `vector` = [7,8,0] carries the same three-label shape. No purple bracket in the right gutter, because there is no child call to bracket to.',
    ] };
}

// Round 6 claims, written before the PNGs were looked at. Every claim gets a PASS or FAIL in EXPLAIN.md.
facts.round6 = { claims: [
  '12A (penalty 0): rows `aug, betaRidge = false -> skipped` (merged, one cause) and `betaPlain = true -> ran`; the betaPlain expression prints SHORT as `else(aug)` (its cause is an edge, not text inside the row).',
  '12B (penalty 4): v0.6 records the inherited run, so B ALSO has the same steps: `aug, betaRidge = true -> ran` (merged into one row) and `betaPlain = false -> skipped`. Both pictures show two rows, naming the same three steps.',
  '12, 7, 1b #20: boxes chosen by the only implementation show NO rung text on the implementation line (the rung appears only for a non-default choice).',
  '13a: the #2 `fitted.standardizer.fit#reference` box says it was chosen by a pin (slot select) on its implementation line or on a flag row; the fill line under the title still marks the contract key (not consulted) and shows no reach (`@ #ids`) for it.',
  '13b: fill line `fitted.standardizer.fit#reference -> .../sample-sd @ #2`; the #2 box says chosen by slot fill.',
  '13c: #8 says chosen by path fill (the key text may be cut, then it is on a flag row); 13d: #55 reference says slot select; ids as round 5.',
  '13e: fill line `fitted.standardizer.fit -> .../sample-sd @ #8` (the pipeline fit, reached by the contract fill) and the audit.standardizer #54 is red with its check mark in the header.',
  '3b: #1 `history` labels read gather[0]<-@0 gather[1]<-@1 gather[2]<-@2 (collected pieces name their tick); the #3, #6, #9 steps each have a decision row `labels unchanged? = ... ran ..., skipped ...`; no `else`; the drive row is unchanged.',
  '3b and 1 (crowded right margin): every purple bracket from a box in the gutter has its OWN vertical lane: no two brackets share a lane (checked by cropping and enlarging).',
  '11b: the cached verdict of #41 is ONE line (`1 cached verdict:` then one `check: sentence` line, cut with an ellipsis if too long), not three wrapped lines.',
  '8 and 8b and 11: the verdict mark (check ✓ or ✗) stays in the header of every check box, including the cached #41 and #54.',
  '1b and 5 and 9 #20/#23: decision rows now `aug, betaRidge = true -> ran` and `betaPlain = false -> skipped read else(aug)`; the amber decision lanes are separate from the data lanes in the right gutter.',
  '10b: tick box rows unchanged; no rung text (only implementation).',
  '2, 3, 4, 6, 6c, 1c, 5b, 7b, 14, 10 strips: unchanged from round 5.',
] };
// Verdicts recorded AFTER looking at every re-shot PNG (index-matched to the claims above). side = which of claim / picture / kernel was wrong.
facts.round6.verdicts = [
  { n: 1, verdict: 'PASS', side: null, note: '12A: merged row `aug, betaRidge = false -> skipped`, `betaPlain = true -> ran`, betaPlain prints `else(aug)` short with its cause as an edge.' },
  { n: 2, verdict: 'PASS', side: null, note: '12B: `aug, betaRidge = true -> ran` merged, `betaPlain = false -> skipped`; same three steps as 12A (v0.5 had two).' },
  { n: 3, verdict: 'PASS', side: null, note: 'No rung text on 12, 7, 1b #20 boxes (only implementation).' },
  { n: 4, verdict: 'PASS', side: null, note: '13a: #2 is chosen by a pin (slot select) on a flag row; fill line marks the contract key not consulted, no reach.' },
  { n: 5, verdict: 'PASS', side: null, note: '13b: reach `@ #2`, chosen by slot fill.' },
  { n: 6, verdict: 'PASS', side: 'kernel view (post-hoc defect)', note: '13c/13d ids and rungs as claimed. UNCLAIMED defect seen afterwards: the `by path fitted.pipeline.regression/fitted.standardizer.fit` flag row in 13c runs past the right edge of its box (kernel view issue, not my claim).' },
  { n: 7, verdict: 'PASS', side: null, note: '13e: `fitted.standardizer.fit -> .../sample-sd @ #8`; #54 red with its mark in the header.' },
  { n: 8, verdict: 'PASS', side: null, note: '3b: history labels gather[0]<-@0 gather[1]<-@1 gather[2]<-@2; decision rows on #3 #6 #9; no else.' },
  { n: 9, verdict: 'PASS', side: null, note: '3b and 1: every gutter bracket has its own lane (zoom crops, six distinct lanes in 1b).' },
  { n: 10, verdict: 'FAIL', side: 'claim and the kernel wording ("one line per cached verdict" means one entry)', note: '11b: I said ONE line. The picture shows one verdict ENTRY (one per cached verdict) wrapped over three text lines, and its sentence is now complete rather than cut. The round-5 truncation nit is fixed; my guess about the line count was wrong.' },
  { n: 11, verdict: 'PASS', side: null, note: '8, 8b, 11: the mark stays in every check header including cached #41 and #54.' },
  { n: 12, verdict: 'PASS', side: null, note: '1b, 5, 9: `aug, betaRidge = true -> ran`, `betaPlain = false -> skipped read else(aug)`; amber lanes separate from data lanes.' },
  { n: 13, verdict: 'PASS', side: null, note: '10b unchanged, no rung text.' },
  { n: 14, verdict: 'PASS', side: null, note: '2, 3, 4, 6, 6c, 1c, 5b, 7b, 14, 10 unchanged from round 5 (all opened, all PASS).' },
];
// Observations written AFTER looking, never claimed beforehand.
facts.round6.unclaimed = [
  'Leaky 5 and 8b: flag rows `by contract` appear where a contract fill chose the implementation; I had not claimed a flag row there (picture shows what the kernel records, not wrong).',
  'Picture 9: a flag row `by slot ...apply#test` appears; unclaimed, correct.',
  '1c and 5b and 6c (my own lineage renderer): the edge label (`68f13db5`, `38060895`) is crossed by its own curve; cosmetic, my renderer, not claimed.',
  'C3: the `centroid 1 (8.00, 6.89)` label touches the lower-left stroke of its X marker; cosmetic, my renderer, unchanged since round 3.',
];
// Round 5 claims for the pictures whose code did not change but whose reading may (written before the PNGs were looked at)
facts.round5 = { claims: [
  '1b and 1 and 9 and 5: call ids exactly as round 4 (#2 split, #3 #4 select, #5 #6 values select, #7 standardizer.fit, #12 #16 apply, #20 linear.fit, #37 linear.apply, #42 mse#model, #45 constant.fit, #47 constant.apply, #48 mse#baseline), because the same calls run; #20 shows TWO decision rows, `aug = true -> ran` (amber) and `betaPlain = false -> skipped` (grey), no betaRidge row.',
  '3b: same boxes and ids as round 4 (#2 init, #3 #6 #9 steps). The decision row on each step still names `labels unchanged?` with ran and skipped branch names, and the read line carries short operand values (the label vectors shortened) or is unchanged; this is my guess, may be wrong. The drive row says stopped by until (the last tick ended it, not the cap).',
  '7: #1 fitted.linear.fit (ridge 4) has the model bracket ending at #4 coefficients and TWO decision rows (aug ran, betaPlain skipped).',
  '14 and 1 #22 `ridge.augment`: output labels unchanged (pieces x4 passthrough gather[4] in 1; gather[0]<-[0] ... in 14): nothing in this domain is an `at` into a gathered value drawn from a wall, so the v0.5 view change should not alter them (a guess).',
  '10: unchanged strips; 10b `#1 fitted.kmeans.step tick` has children assign and update; the long read line now breaks onto a second line inside the box.',
  '8 and 11: unchanged ids (#54 audit.standardizer, 11b #41 hit).',
] };
fs.writeFileSync(path.join(outDir, 'c-fitted-facts.json'), JSON.stringify(facts, null, 1));
console.log('wrote c-fitted renders');
