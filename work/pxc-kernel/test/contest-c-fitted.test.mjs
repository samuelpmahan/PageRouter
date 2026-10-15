import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/kernel.mjs';
import { register } from '../contest/c-fitted/index.mjs';
import { regressionData, blobs } from '../contest/c-fitted/data.mjs';
import * as L from '../contest/c-fitted/lineage.mjs';

const fresh = () => { const w = createWorld({ name: 'c-fitted' }); register(w); return w; };
const LEAKY = { 'fitted.pipeline.regression': 'fitted.pipeline.regression/leaky' };
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const hand = { matrix: [[1], [1], [3], [3], [5], [0]], targets: [3, 3, 7, 7, 11, 1], groups: [1, 1, 2, 2, 3, 3], period: 3, penalty: 4 };
const drift = (() => {
  const matrix = Array.from({ length: 12 }, (_, i) => [i]);
  return { matrix, groups: matrix.map((_, i) => Math.floor(i / 3) + 1), targets: matrix.map(([x], i) => 2 + 0.75 * x + (((i * 37) % 11) - 5) / 10) };
})();

test('every contract example (derived by hand) proves; only the three deliberately wrong implementations fail, and each carries an example of its own that proves', () => {
  const w = fresh();
  const proofs = w.contracts().filter((c) => c.id.startsWith('fitted.')).flatMap((c) => w.prove(c.id));
  const failing = proofs.filter((p) => !p.ok);
  assert.deepEqual([...new Set(failing.map((p) => p.impl))].sort(), ['fitted.pipeline.regression/leaky', 'fitted.standardizer.apply/self-stats', 'fitted.standardizer.fit/sample-sd']);
  assert.deepEqual(failing.filter((p) => p.impl.endsWith('/leaky')).map((p) => p.example), [0, 1], 'leaky differs in the fitted models on example 0 and in predictions on example 1');
  assert.deepEqual(failing.filter((p) => p.impl.endsWith('/self-stats')).map((p) => p.example), [0], 'self-stats is caught by the standardizer.apply example');
  assert.deepEqual(failing.filter((p) => p.impl.endsWith('/sample-sd')).map((p) => p.example), [0], 'sample-sd is caught by the standardizer.fit example');
  // v0.3 implementation examples: the two wrong implementations state what they actually compute, and that statement proves
  const own = proofs.filter((p) => typeof p.example === 'string' && p.example.startsWith('impl:'));
  assert.deepEqual(own.map((p) => [p.impl, p.example, p.ok]).sort(), [['fitted.standardizer.apply/self-stats', 'impl:0', true], ['fitted.standardizer.fit/sample-sd', 'impl:0', true]]);
  // v0.3 examples with `fill`, and (v0.5) a `trajectory` for the tick contract, checked tick by tick inside prove: both are in the contract and prove
  assert.ok(w.contracts().find((c) => c.id === 'fitted.kmeans.step').examples.some((e) => e.trajectory?.length === 2));
  assert.equal(w.prove('fitted.kmeans.step').length, 3, 'two single-tick examples and one trajectory');
  assert.ok(w.prove('fitted.kmeans.step').every((p) => p.ok));
  const ap = w.prove('fitted.audit.pipeline');
  assert.ok(w.contracts().find((c) => c.id === 'fitted.audit.pipeline').examples.some((e) => e.fill));
  assert.deepEqual(ap.map((p) => p.ok), [true, true], 'the leaky pipeline is rejected, as an example');
  const c = w.contracts().filter((x) => x.id.startsWith('fitted.'));
  for (const k of c) assert.ok(k.examples.length >= 1, `${k.id} has an example`);
});

test('pipeline on constructed data: noise-free line is recovered exactly, noisy line beats the baseline', () => {
  const w = fresh();
  const exact = regressionData({ weights: [0.75, -1.25], intercept: 2, noise: false });
  const r = w.run('fitted.pipeline.regression', { matrix: exact.matrix, targets: exact.targets, groups: exact.groups, period: 4, penalty: 0 });
  near(r.outputs.mse, 0, 1e-18);
  assert.ok(r.outputs.baselineMse > 5);
  // map standardized coefficients back to original units and compare with the known truth
  const { means, sds } = r.outputs.standardizer; const [b0, ...bw] = r.outputs.regression.coefficients;
  near(bw[0] / sds[0], 0.75); near(bw[1] / sds[1], -1.25);
  near(b0 - bw.reduce((s, v, j) => s + (v * means[j]) / sds[j], 0), 2);
  const noisy = regressionData({ weights: [0.75, -1.25] });
  const n = w.run('fitted.pipeline.regression', { matrix: noisy.matrix, targets: noisy.targets, groups: noisy.groups, period: 4, penalty: 0 });
  assert.ok(n.outputs.mse < 0.3 && n.outputs.mse > 0, `mse ${n.outputs.mse}`);
  assert.ok(n.outputs.baselineMse > 20 * n.outputs.mse);
});

test('group split: whole groups on one side, every row covered', () => {
  const w = fresh();
  const d = regressionData({ weights: [0.75] });
  const s = w.run('fitted.split.byGroup', { groups: d.groups, period: 4 }).outputs;
  const trainGroups = new Set(s.trainRows.map((i) => d.groups[i])); const testGroups = new Set(s.testRows.map((i) => d.groups[i]));
  assert.equal([...trainGroups].filter((g) => testGroups.has(g)).length, 0);
  assert.equal(s.trainRows.length + s.testRows.length, d.groups.length);
  assert.deepEqual(s.testGroups, [4, 8]);
  assert.throws(() => w.run('fitted.split.byGroup', { groups: [1, 1, 2], period: 3 }), /too few for period/);
});

test('leakage: the pipeline uses train rows only; fitting the standardizer on all rows changes ridge predictions, not OLS predictions', () => {
  const w = fresh();
  const base = (penalty) => ({ ...drift, period: 4, penalty });
  const rc = w.run('fitted.pipeline.regression', base(2));
  const rl = w.run('fitted.pipeline.regression', base(2), { fill: LEAKY });
  assert.ok(maxDiff(rc.outputs.predictions, rl.outputs.predictions) > 0.1);
  assert.ok(rl.outputs.mse > 2 * rc.outputs.mse);
  assert.notDeepEqual(rc.outputs.standardizer, rl.outputs.standardizer);
  // ordinary least squares is invariant to per-column affine rescaling: the difference is rounding only
  const oc = w.run('fitted.pipeline.regression', base(0));
  const ol = w.run('fitted.pipeline.regression', base(0), { fill: LEAKY });
  assert.ok(maxDiff(oc.outputs.predictions, ol.outputs.predictions) < 1e-12);
  assert.notEqual(oc.refs.predictions.hash, ol.refs.predictions.hash, 'equal to 1e-12 but not the same Part');
  assert.notDeepEqual(oc.outputs.standardizer, ol.outputs.standardizer, 'the leak is still visible in the fitted standardizer');
  // trace audit: where did each fit read its rows from
  assert.ok(L.lineageFor(w).trainOnly(rc.trace));
  assert.ok(!L.lineageFor(w).trainOnly(rl.trace));
  assert.deepEqual(L.lineageFor(w).trainingRows(rl.trace).filter((r) => !r.rowsFrom.endsWith('.trainRows')).map((r) => r.contract), ['fitted.standardizer.fit']);
  // the standardizer in the clean run is exactly the train rows' statistics (train = rows 0..8)
  const xs = drift.matrix.slice(0, 9).map((r) => r[0]); const m = xs.reduce((a, b) => a + b) / 9;
  near(rc.outputs.standardizer.means[0], m);
  near(rc.outputs.standardizer.sds[0], Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / 9));
});

test('fit then apply: the trace names the fit that made the model, and a gathered model keeps the origin of each field', () => {
  const w = fresh();
  const r = w.run('fitted.pipeline.regression', hand);
  const pairs = L.lineageFor(w).fitApplyPairs(r.trace);
  assert.deepEqual(pairs.map((p) => [p.applyContract, p.slot, p.fitContract]), [
    ['fitted.standardizer.apply', 'train', 'fitted.standardizer.fit'], ['fitted.standardizer.apply', 'test', 'fitted.standardizer.fit'],
    ['fitted.linear.apply', null, 'fitted.linear.fit'], ['fitted.constant.apply', null, 'fitted.constant.fit']]);
  assert.ok(pairs.every((p) => p.origin === 'call' && !p.crossRun));
  const [a1, a2] = pairs; assert.equal(a1.fit, a2.fit, 'train and test standardization share one fit');
  // linear.apply reads the model through a path projection (at 'coefficients')
  const lin = r.trace.calls.find((n) => n.contract === 'fitted.linear.apply');
  assert.equal(lin.calls[1].in.vector.from.kind, 'at');
  assert.deepEqual(lin.calls[1].in.vector.from.path, ['coefficients']);
  // round 2: every model is built with gather, so no model output is `computed` any more
  for (const c of ['fitted.constant.fit', 'fitted.linear.fit', 'fitted.standardizer.fit']) {
    assert.equal(r.trace.calls.find((n) => n.contract === c).out.model.from.kind, 'gather', c);
  }
  const linFit = r.trace.calls.find((n) => n.contract === 'fitted.linear.fit');
  const lo = L.fieldOrigins(r.trace, linFit);
  assert.deepEqual(lo.map((o) => [o.path.join('.'), o.kind, o.contract]), [['kind', 'literal', null], ['coefficients', 'call', 'lin.leastSquares']]);
  const stdFit = r.trace.calls.find((n) => n.contract === 'fitted.standardizer.fit');
  const so = L.fieldOrigins(r.trace, stdFit);
  assert.deepEqual(so.map((o) => [o.path.join('.'), o.contract]), [['kind', null], ['means.0', 'stat.mean'], ['sds.0', 'stat.standardDeviation']]);
  const constFit = r.trace.calls.find((n) => n.contract === 'fitted.constant.fit');
  assert.deepEqual(L.fieldOrigins(r.trace, constFit).map((o) => [o.path.join('.'), o.contract]), [['kind', null], ['value', 'stat.mean']]);
  // slot names are in the trace
  assert.deepEqual(r.trace.calls.filter((n) => n.slot).map((n) => `${n.contract}#${n.slot}`), [
    'fitted.rows.select#train', 'fitted.rows.select#test', 'fitted.values.select#train', 'fitted.values.select#test',
    'fitted.standardizer.apply#train', 'fitted.standardizer.apply#test', 'fitted.error.mse#model', 'fitted.error.mse#baseline']);
});

test('a model applied in a later run names its producing fit through the cross-run edge', () => {
  const w = fresh();
  const f1 = w.run('fitted.linear.fit', { matrix: [[0], [1], [2], [3]], targets: [1, 3, 5, 7], penalty: 0 });
  // by Ref: the edge exists in the kernel
  const later = w.run('fitted.linear.apply', { model: f1.refs.model, matrix: [[4]] });
  near(later.outputs.values[0], 9);
  assert.deepEqual(later.trace.in.model.from, { kind: 'run', run: f1.receipt.runId, from: { kind: 'call', call: 1, port: 'model' } });
  const [pair] = L.lineageFor(w).fitApplyPairs(later.trace, later.receipt.runId);
  assert.equal(pair.crossRun, true); assert.equal(pair.fitRun, f1.receipt.runId); assert.equal(pair.fit, 1); assert.equal(pair.fitContract, 'fitted.linear.fit');
  // the edge also survives a pipeline: the `regression` output of a pipeline run resolves to call #20 inside that run
  const pipe = w.run('fitted.pipeline.regression', hand);
  const viaPipe = w.run('fitted.linear.apply', { model: pipe.refs.regression, matrix: [[3], [-2]] });
  assert.deepEqual(viaPipe.outputs.values, [8, 3]);
  const [pp] = L.lineageFor(w).fitApplyPairs(viaPipe.trace, viaPipe.receipt.runId);
  assert.deepEqual([pp.fitRun, pp.fit, pp.fitContract], [pipe.receipt.runId, 20, 'fitted.linear.fit']);
  // a Ref from a cache hit still resolves: the second identical fit is cached, its output comes from `cached`
  const f2 = w.run('fitted.linear.fit', { matrix: [[0], [1], [2], [3]], targets: [1, 3, 5, 7], penalty: 0 });
  assert.equal(f2.trace.cached, true);
  const via2 = w.run('fitted.linear.apply', { model: f2.refs.model, matrix: [[4]] });
  assert.equal(L.lineageFor(w).fitApplyPairs(via2.trace, via2.receipt.runId)[0].fitRun, f2.receipt.runId);
  // by plain value: no edge, the model is a root input again
  const plain = w.run('fitted.linear.apply', { model: f1.outputs.model, matrix: [[4]] });
  assert.deepEqual(plain.trace.in.model.from, { kind: 'input', call: 0, port: 'model' });
  assert.equal(L.lineageFor(w).fitApplyPairs(plain.trace, plain.receipt.runId)[0].fit, null);
  // ...and only then is the hash scan still needed
  const found = L.lineageFor(w).producersAcrossRuns(f1.refs.model.hash);
  assert.deepEqual(found.map((f) => f.run), [f1.receipt.runId, f2.receipt.runId, ...found.slice(2).map((f) => f.run)].slice(0, found.length));
  assert.ok(found.some((f) => f.run === f1.receipt.runId));
});

test('stale model: an edge answers "fitted on exactly this data?" without a scan; equal models stay indistinguishable by hash', () => {
  const w = fresh();
  const X1 = [[0], [1], [2], [3]]; const y1 = [1, 3, 5, 7];
  const m1 = w.run('fitted.linear.fit', { matrix: X1, targets: y1, penalty: 0 });
  const hashesOf = (X, y) => ({ matrix: w.run('fitted.rows.select', { matrix: X, rows: [0] }).trace.in.matrix.hash, targets: w.run('fitted.values.select', { values: y, rows: [0] }).trace.in.values.hash });
  const use = w.run('fitted.linear.apply', { model: m1.refs.model, matrix: [[4]] });
  const U = (X, y) => L.lineageFor(w).stalenessOfApply(use.trace, hashesOf(X, y), use.receipt.runId);
  assert.deepEqual(U(X1, y1), { known: true, fitRun: m1.receipt.runId, fitCall: 1, differs: [], fresh: true });
  // new data with an outlier row: the model the apply holds is stale, and the verdict names the two ports that differ
  const X2 = [...X1, [4]]; const y2 = [...y1, 20];
  const stale = U(X2, y2);
  assert.equal(stale.fresh, false); assert.deepEqual(stale.differs.sort(), ['matrix', 'targets']);
  const m2 = w.run('fitted.linear.fit', { matrix: X2, targets: y2, penalty: 0 });
  assert.notEqual(m2.refs.model.hash, m1.refs.model.hash);
  // new data on the same line: the refit is the identical Part, so the hash alone has two producers; the edge still tells which one this apply holds
  const X3 = [...X1, [4]]; const y3 = [...y1, 9];
  const m3 = w.run('fitted.linear.fit', { matrix: X3, targets: y3, penalty: 0 });
  assert.equal(m3.refs.model.hash, m1.refs.model.hash, 'same coefficients: the model Part carries no memory of its data');
  assert.equal(L.lineageFor(w).producersAcrossRuns(m1.refs.model.hash).length, 2);
  assert.equal(U(X1, y1).fresh, true, 'this apply holds run 1\'s model, fitted on X1');
  assert.equal(U(X3, y3).fresh, false, 'but not one fitted on the longer data, even though the Parts are equal');
  // scan fallback for a plain-value model: unknown vs known
  assert.equal(L.lineageFor(w).staleness('deadbeefdeadbeef', hashesOf(X1, y1)).known, false);
  assert.equal(L.lineageFor(w).staleness(m1.refs.model.hash, hashesOf(X1, y1)).fresh, true);
});

test('a model of the wrong family is refused at run time, but assembly lint cannot see it', () => {
  const w = fresh();
  assert.throws(() => w.run('fitted.standardizer.apply', { model: { kind: 'linear', coefficients: [1, 2] }, matrix: [[1]] }), (e) => e.code === 'INPUT_SCHEMA' && /kind not in enum/.test(e.message));
  w.contract({ id: 'x.miswired', in: { matrix: { type: 'array', minItems: 1, items: { type: 'array', minItems: 1, items: { type: 'number' } } }, targets: { type: 'array', minItems: 1, items: { type: 'number' } } }, out: { matrix: { type: 'array', minItems: 1, items: { type: 'array', minItems: 1, items: { type: 'number' } } } } });
  assert.doesNotThrow(() => w.compose({ id: 'x.miswired/1', implements: 'x.miswired', steps: [
    { name: 'fit', call: 'fitted.linear.fit', bind: { matrix: '$in.matrix', targets: '$in.targets', penalty: { literal: 0 } } },
    { name: 'z', call: 'fitted.standardizer.apply', bind: { model: 'fit.model', matrix: '$in.matrix' } },
  ], returns: { matrix: 'z.matrix' } }), 'lint compares only top-level type: object vs object');
  assert.throws(() => w.run('x.miswired', { matrix: [[1], [2], [3]], targets: [1, 2, 3] }), (e) => e.code === 'INPUT_SCHEMA');
});

test('standardizer: fit on train columns only; constant column refused; apply to unseen rows uses train statistics', () => {
  const w = fresh();
  const f = w.run('fitted.standardizer.fit', { matrix: [[1, 0], [3, 4]] });
  assert.deepEqual(f.outputs.model, { kind: 'standardizer', means: [2, 2], sds: [1, 2] });
  const a = w.run('fitted.standardizer.apply', { model: f.outputs.model, matrix: [[10, 10]] });
  assert.deepEqual(a.outputs.matrix, [[8, 4]]);
  assert.throws(() => w.run('fitted.standardizer.fit', { matrix: [[1, 5], [2, 5]] }), /column 1 is constant/);
});

test('k-means: separable data gives the same sorted centroids for every seed; cap reports non-convergence; predict agrees with assign', () => {
  const w = fresh();
  const pts = blobs();
  const models = [1, 2, 3, 4, 5, 6].map((seed) => w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed }));
  for (const m of models) { assert.ok(m.outputs.converged); near(m.outputs.model.centroids[0][0], 1, 1e-9); }
  assert.ok(new Set(models.map((m) => m.outputs.iterations)).size > 1, 'iteration count depends on the seed');
  assert.equal(new Set(models.map((m) => m.refs.model.hash)).size, 1, 'but the model Part does not');
  const capped = w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 1 }, { seed: 1 });
  assert.equal(capped.outputs.converged, false); assert.equal(capped.outputs.iterations, 1);
  const labels = w.run('fitted.kmeans.predict', { model: models[0].outputs.model, matrix: pts }).outputs.labels;
  assert.deepEqual(labels, pts.map((p) => (p[0] < 4.5 ? 0 : 1)));
  assert.throws(() => w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 5 }), (e) => e.code === 'SEED_REQUIRED');
  const rep = w.replay(models[0].receipt);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
});

test('seeded randomness is never served from cache: every seed gets its own draw, and replay is exact', () => {
  const w = createWorld({ name: 'seed-cache' });
  w.contract({ id: 'r.draw', in: {}, out: { v: { type: 'number' } } });
  w.implement({ id: 'r.draw/1', implements: 'r.draw', run: (_, ctx) => ({ v: ctx.random() }) });
  const a = w.run('r.draw', {}, { seed: 1 });
  const b = w.run('r.draw', {}, { seed: 2 });
  assert.equal(b.trace.cached, false);
  assert.equal(b.receipt.randomDraws, 1);
  assert.notEqual(a.outputs.v, b.outputs.v, 'seed 2 draws its own value');
  assert.equal(w.replay(b.receipt).exact, true);
  // in this domain: no pure:false is declared on k-means any more; the kernel marks it, and its ancestors, impure by itself
  const w2 = fresh();
  assert.equal(w2.implementations().find((i) => i.id === 'fitted.kmeans.fit/lloyd').pure, true);
  const pts = blobs();
  const k1 = w2.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed: 1 });
  const k1again = w2.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed: 1 });
  const k2 = w2.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed: 2 });
  assert.deepEqual([k1.trace.cached, k1again.trace.cached, k2.trace.cached], [false, false, false]);
  assert.equal(k1.receipt.impure, true);
  assert.equal(k1again.receipt.randomDraws, k1.receipt.randomDraws);
  assert.equal(k2.receipt.randomDraws > 0, true);
  // the cached children (assign, update) are still reusable when their inputs repeat: only the random subtree is excluded
  assert.ok(k1again.trace.calls.some((n) => n.cached), 'assign/update calls with identical inputs are cache hits');
});

test('slots: one fill key injects a wrong implementation at the test call site only, the trace names the call site, and a typo in the slot name is BAD_FILL (v0.2 accepted it)', () => {
  const w = fresh();
  const honest = w.run('fitted.pipeline.regression', hand);
  const leak = w.run('fitted.pipeline.regression', hand, { fill: { 'fitted.standardizer.apply#test': 'fitted.standardizer.apply/self-stats' } });
  const applies = (r) => r.trace.calls.filter((n) => n.contract === 'fitted.standardizer.apply').map((n) => [n.slot, n.impl]);
  assert.deepEqual(applies(honest), [['train', 'fitted.standardizer.apply/columns'], ['test', 'fitted.standardizer.apply/columns']]);
  assert.deepEqual(applies(leak), [['train', 'fitted.standardizer.apply/columns'], ['test', 'fitted.standardizer.apply/self-stats']]);
  assert.deepEqual(leak.outputs.predictions, [6, 4]); // test z = +1, -1 from the test rows' own statistics
  assert.equal(leak.outputs.mse, 17);
  assert.equal(honest.outputs.mse, 6.5);
  // provenance still says the model was passed: the edge from fit #7 reaches apply#test unchanged. Passed is not used.
  const [, test] = L.lineageFor(w).fitApplyPairs(leak.trace);
  assert.equal(test.slot, 'test'); assert.equal(test.fit, 7);
  assert.ok(L.lineageFor(w).trainOnly(leak.trace), 'the provenance audit is blind to an implementation that ignores its model');
  // v0.3: a slot nothing declares and nothing consulted is a typo. The pipeline compositions declare train/test through their steps' `slot`.
  assert.throws(() => w.run('fitted.pipeline.regression', hand, { fill: { 'fitted.standardizer.apply#tset': 'fitted.standardizer.apply/self-stats' } }),
    (e) => e.code === 'BAD_FILL' && /tset/.test(e.message) && e.receipt.status === 'failed');
  assert.doesNotThrow(() => w.run('fitted.pipeline.regression', hand, { fill: { 'fitted.standardizer.apply#test': 'fitted.standardizer.apply/self-stats' } }), 'the declared spelling is fine');
});

test('check: the audit is a verdict inside the run; a leaky pipeline is rejected with a reason naming the numbers', () => {
  const w = fresh();
  const ok = w.run('fitted.audit.pipeline', hand);
  assert.deepEqual(ok.outputs, { accepted: true, reason: 'standardizer matches the statistics of the 4 rows given' });
  assert.deepEqual(ok.receipt.verdicts.map((v) => [v.contract, v.accepted]), [['fitted.audit.pipeline', true], ['fitted.audit.standardizer', true]]);
  assert.equal(ok.trace.kind, 'check');
  const bad = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.pipeline.regression': 'fitted.pipeline.regression/leaky' } });
  assert.equal(bad.outputs.accepted, false);
  assert.equal(bad.outputs.reason, 'column 0: model has mean 2.16667 sd 1.67498, the rows have mean 2 sd 1');
  assert.deepEqual(bad.receipt.verdicts.map((v) => v.accepted), [false, false]);
  // the check sees Parts, not provenance: it also rejects a model that arrived with no edge at all
  const stray = w.run('fitted.audit.standardizer', { model: { kind: 'standardizer', means: [0], sds: [1] }, matrix: [[1], [1], [3], [3]] });
  assert.equal(stray.outputs.accepted, false);
  // and it is blind to the self-stats slot fill: the fitted standardizer is right, only one apply ignored it
  const blind = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.standardizer.apply#test': 'fitted.standardizer.apply/self-stats' } });
  assert.equal(blind.outputs.accepted, true);
});

test('tick kind: k-means as a fold over ticks gives the same centroids as the loop, and every tick replays alone in a fresh world', () => {
  const w = fresh();
  const pts = blobs();
  const init = w.run('fitted.kmeans.init', { matrix: pts, k: 2 }, { seed: 11 });
  const d = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { until: (out) => out.converged, maxTicks: 50 });
  const loop = w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 50 }, { seed: 11 });
  const sorted = [...d.final.state.centroids].sort((a, b) => a[0] - b[0]);
  sorted.forEach((c, i) => c.forEach((v, j) => near(v, loop.outputs.model.centroids[i][j], 1e-12)));
  assert.equal(d.ticks, loop.outputs.iterations, 'one tick per assignment, as in the loop');
  // the state chain: tick 0 starts from the init run, tick k from tick k-1
  assert.deepEqual(d.receipts[0].trace.in.state.from.kind, 'run');
  assert.equal(d.receipts[0].trace.in.state.from.run, init.receipt.runId);
  assert.equal(d.receipts[1].trace.in.state.from.run, d.receipts[0].runId);
  // replay one tick alone in a fresh world
  const w2 = fresh();
  const rep = w2.replay(d.receipts[1]);
  assert.equal(rep.exact, true, rep.mismatches.join('\n'));
  // the initial centroids are paths into the input rows, in the init trace
  const o = L.fieldOrigins(init.trace, init.trace, 'state');
  assert.equal(o[0].path.join('.'), 'centroids.0');
  assert.deepEqual([o[0].kind, o[0].port, o[0].within.length], ['input', 'matrix', 1], 'a path [row] into the matrix input');
  assert.equal(o.find((x) => x.path[0] === 'labels').kind, 'literal');
});


// =================================================================== round 3 (kernel v0.3)

test('v0.6 branching: the ridge guard is written once on aug, betaRidge inherits its run or its skip, betaPlain is `else: [aug]`; BOTH sides leave the same three rows (v0.5 left two when ridge ran)', () => {
  const w = fresh();
  assert.equal(w.contracts().some((c) => c.id === 'fitted.penalty.isRidge'), false, 'no contract exists only to emit a boolean');
  const X = [[0], [1], [2], [3]]; const y = [1, 3, 5, 7];
  const ols = w.run('fitted.linear.fit', { matrix: X, targets: y, penalty: 0 });
  assert.deepEqual(ols.trace.calls.map((c) => c.contract), ['fitted.matrix.withIntercept', 'lin.leastSquares'], 'no augment node and no boolean node for penalty 0');
  assert.deepEqual(L.decisionsOf(ols.trace).map((d) => [d.label, d.value, d.ran, d.skipped]), [['aug', false, null, 'aug'], ['betaRidge', false, null, 'betaRidge'], ['betaPlain', true, 'betaPlain', null]]);
  // the inherited skip records the ORIGINAL cause (aug's own test), not a new one
  assert.deepEqual(ols.trace.decisions[1].from, ols.trace.decisions[0].from);
  // the penalty relation is written once in the composition's source (the else is derived, nothing is retyped as `le`)
  const src = readFileSync(new URL('../contest/c-fitted/index.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("id: 'fitted.linear.fit/leastSquares'"), src.indexOf("id: 'fitted.linear.apply'"));
  assert.equal((block.match(/\$in\.penalty', 0\]/g) ?? []).length, 1, 'one relation on the penalty');
  assert.equal((block.match(/le: \[/g) ?? []).length, 0, 'no typed complement');
  // the decision's provenance names every operand: the penalty input and the literal 0
  assert.deepEqual(ols.trace.decisions[0].from, { kind: 'test', op: 'gt', args: [{ kind: 'input', call: 1, port: 'penalty' }, { kind: 'literal', value: 0 }] });
  // betaPlain's condition is derived: op `else`, naming aug and carrying aug's cause as its operand
  assert.equal(ols.trace.decisions[2].from.op, 'else');
  assert.deepEqual(ols.trace.decisions[2].from.steps, ['aug']);
  assert.deepEqual(ols.trace.decisions[2].from.args[0], ols.trace.decisions[0].from);
  const ridge = w.run('fitted.linear.fit', { matrix: X, targets: y, penalty: 3 });
  assert.deepEqual(ridge.trace.calls.map((c) => c.contract), ['fitted.matrix.withIntercept', 'fitted.ridge.augment', 'lin.leastSquares']);
  // v0.6: a step that ran because what it reads ran records `ran` with the producer's cause, so the ridge side has the same three rows as the plain side
  assert.deepEqual(L.decisionsOf(ridge.trace).map((d) => [d.label, d.value, d.ran, d.skipped]), [['aug', true, 'aug', null], ['betaRidge', true, 'betaRidge', null], ['betaPlain', false, null, 'betaPlain']]);
  assert.deepEqual(ridge.trace.decisions[1].from, ridge.trace.decisions[0].from, 'the inherited run carries aug\'s own cause');
  assert.deepEqual(ridge.trace.decisions.map((d) => d.label), ols.trace.decisions.map((d) => d.label), 'both sides of the condition leave the same rows');
  // every child was chosen by the only implementation (no fill, no select at a slot)
  assert.deepEqual(ridge.trace.calls.map((c) => c.chosenBy.rung), ['only implementation', 'only implementation', 'only implementation']);
  // exactly one alternative produced the coefficients, and the model's field points at that call
  assert.deepEqual(L.fieldOrigins(ols.trace, ols.trace).map((o) => [o.path.join('.'), o.kind, o.contract]), [['kind', 'literal', null], ['coefficients', 'call', 'lin.leastSquares']]);
  near(ols.outputs.model.coefficients[0], 1); near(ols.outputs.model.coefficients[1], 2);
  assert.equal(w.replay(ridge.receipt).exact, true);
  assert.equal(w.replay(ols.receipt).exact, true);
  const p = w.run('fitted.pipeline.regression', hand, { cache: false });
  assert.deepEqual(L.decisionsOf(p.trace).map((d) => [d.call, d.contract, d.label, d.value]), [[20, 'fitted.linear.fit', 'aug', true], [20, 'fitted.linear.fit', 'betaRidge', true], [20, 'fitted.linear.fit', 'betaPlain', false]]);
  // `one` refuses an overlap that `first` would hide: two guards that are both true
  w.contract({ id: 'x.both', in: { v: { type: 'number' } }, out: { v: { type: 'number' } } });
  w.contract({ id: 'x.inc', in: { v: { type: 'number' } }, out: { v: { type: 'number' } } });
  w.implement({ id: 'x.inc/1', implements: 'x.inc', run: ({ v }) => ({ v: v.value + 1 }) });
  w.compose({ id: 'x.both/one', implements: 'x.both', steps: [
    { name: 'a', call: 'x.inc', when: { gt: ['$in.v', 0] }, bind: { v: '$in.v' } },
    { name: 'b', call: 'x.inc', when: { ge: ['$in.v', 0] }, bind: { v: '$in.v' } },
  ], returns: { v: { one: ['a.v', 'b.v'] } } });
  assert.throws(() => w.run('x.both', { v: 2 }), (e) => e.code === 'AMBIGUOUS_BRANCH');
  assert.equal(w.run('x.both', { v: 0 }).outputs.v, 1, 'only b is live at 0');
});

test('v0.5 inherited skip (was FRICTION v0.4 guard restated, where the unguarded betaRidge failed ASSEMBLY_LINT): betaRidge needs no guard of its own, and `one` refuses overlap at assembly; a resumed tick is a cache hit on the uninterrupted drive', () => {
  const w = fresh();
  w.contract({ id: 'y.fit', in: { matrix: { type: 'array' }, targets: { type: 'array' }, penalty: { type: 'number' } }, out: { coefficients: { type: 'array' } } });
  const steps = (extra) => [
    { name: 'x1', call: 'fitted.matrix.withIntercept', bind: { matrix: '$in.matrix' } },
    { name: 'aug', call: 'fitted.ridge.augment', when: { gt: ['$in.penalty', 0] }, bind: { matrix: 'x1.matrix', vector: '$in.targets', penalty: '$in.penalty' } },
    { name: 'betaRidge', call: 'lin.leastSquares', ...extra, bind: { matrix: 'aug.matrix', vector: 'aug.vector' } },
    { name: 'betaPlain', call: 'lin.leastSquares', when: { else: ['aug'] }, bind: { matrix: 'x1.matrix', vector: '$in.targets' } },
  ];
  const returns = { coefficients: { one: ['betaRidge.coefficients', 'betaPlain.coefficients'] } };
  // the scenario that failed ASSEMBLY_LINT in v0.4 (betaRidge reads aug and has no `when`) now assembles and runs
  w.compose({ id: 'y.fit/inherit', implements: 'y.fit', steps: steps({}), returns });
  const X = [[0], [1], [2], [3]]; const y = [1, 3, 5, 7];
  const plain = w.run('y.fit', { matrix: X, targets: y, penalty: 0 });
  assert.equal(plain.outputs.coefficients.length, 2);
  assert.deepEqual(plain.trace.calls.map((c) => c.contract), ['fitted.matrix.withIntercept', 'lin.leastSquares']);
  assert.equal(w.run('y.fit', { matrix: X, targets: y, penalty: 3 }).trace.calls.length, 3);
  // `one` now fails at assembly when one alternative's condition implies another's, but only STRUCTURALLY: {and: [A, B]} implies A.
  const over = (id, whenB) => w.compose({ id, implements: 'y.over', steps: [
    { name: 'x1', call: 'fitted.matrix.withIntercept', bind: { matrix: '$in.matrix' } },
    { name: 'a', call: 'lin.leastSquares', when: { gt: ['$in.penalty', 0] }, bind: { matrix: 'x1.matrix', vector: '$in.targets' } },
    { name: 'b', call: 'lin.leastSquares', when: whenB, bind: { matrix: 'x1.matrix', vector: '$in.targets' } },
  ], returns: { coefficients: { one: ['a.coefficients', 'b.coefficients'] } } });
  w.contract({ id: 'y.over', in: { matrix: { type: 'array' }, targets: { type: 'array' }, penalty: { type: 'number' } }, out: { coefficients: { type: 'array' } } });
  assert.throws(() => over('y.over/and', { and: [{ gt: ['$in.penalty', 0] }, { lt: ['$in.penalty', 5] }] }), (e) => e.code === 'ASSEMBLY_LINT', 'and(A, B) implies A: an assembly error now');
  // FRICTION: gt(penalty, 0) implies ge(penalty, 0) arithmetically, but the lint does not know it, so this overlap still waits for the run
  over('y.over/ge', { ge: ['$in.penalty', 0] });
  assert.throws(() => w.run('y.over', { matrix: [[0], [1]], targets: [1, 2], penalty: 2 }, { fill: { 'y.over': 'y.over/ge' } }), (e) => e.code === 'AMBIGUOUS_BRANCH');
  // the clock does not enter the cache key of a tick that never reads it: tick 2 of a resumed drive hits the entry the whole drive made
  const pts = blobs();
  const init = w.run('fitted.kmeans.init', { matrix: pts, k: 2 }, { seed: 11 });
  const whole = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { until: (o) => o.converged, maxTicks: 50 });
  const first = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { ticks: 2 });
  const rest = w.drive('fitted.kmeans.step', { matrix: pts, state: first.state }, { until: (o) => o.converged, maxTicks: 50, startTick: 2 });
  assert.deepEqual(first.receipts.map((r) => !!r.trace.cachedFrom), [true, true]);
  assert.deepEqual(rest.receipts.map((r) => !!r.trace.cachedFrom), [true]);
  assert.equal(whole.ticks, 3);
});

test('v0.5 path fill must land (was FRICTION v0.4 path fill, where a chain no call took was accepted and did nothing): a typo in a contract or slot and a chain that never occurs are all BAD_FILL; the live chain is rejected with no pin', () => {
  const w = fresh();
  const SD = 'fitted.standardizer.fit/sample-sd';
  assert.throws(() => w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.pipeline.regression/fitted.standardizer.fitt': SD } }), (e) => e.code === 'BAD_FILL');
  assert.throws(() => w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.pipeline.regression#nope/fitted.standardizer.fit': SD } }), (e) => e.code === 'BAD_FILL');
  // both contracts exist, but error.mse never calls standardizer.fit: v0.4 accepted this and the audit said true; v0.5 says the path did not land
  assert.throws(() => w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.error.mse/fitted.standardizer.fit': SD } }), (e) => e.code === 'BAD_FILL' && /reached no call/.test(e.message));
  assert.equal(w.run('fitted.audit.pipeline', hand).outputs.accepted, true);
  // the live chain is rejected, with no pin, and the receipt says which fill key was used
  const live = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.pipeline.regression/fitted.standardizer.fit': SD } });
  assert.equal(live.outputs.accepted, false);
  assert.deepEqual(live.receipt.fillConsulted, ['fitted.pipeline.regression/fitted.standardizer.fit']);
});

test('v0.6 landing: a flat slot key no call took is accepted by default (fillReach is empty for it), landing "all" refuses it, landing "none" lets a path miss, and typos fail in every mode; an inherited run is recorded', () => {
  const w = fresh();
  const SD = 'fitted.standardizer.fit/sample-sd';
  // the pipeline has no `#reference` seat (only the audit does), the key is declared by the audit refit's `uses`, so it is valid and unused
  const flat = w.run('fitted.pipeline.regression', hand, { fill: { 'fitted.standardizer.fit#reference': SD }, cache: false });
  assert.equal(flat.outputs.mse, 6.5, 'nothing changed');
  assert.deepEqual(flat.receipt.fillReach, { 'fitted.standardizer.fit#reference': [] }, 'the receipt says which calls the key reached: none');
  const star = w.run('fitted.pipeline.regression', hand, { fill: { 'fitted.standardizer.fit#*': SD }, cache: false });
  assert.equal(star.outputs.mse, 6.5);
  assert.deepEqual(star.receipt.fillReach, { 'fitted.standardizer.fit#*': [] });
  // landing 'all' says what an experiment that aims means: every key must land (v0.5 needed a hand check of fillConsulted)
  for (const fill of [{ 'fitted.standardizer.fit#reference': SD }, { 'fitted.standardizer.fit#*': SD }]) {
    assert.throws(() => w.run('fitted.pipeline.regression', hand, { fill, landing: 'all', cache: false }), (e) => e.code === 'BAD_FILL');
  }
  // landing 'none': a path that no call took may miss (a sweep with one table over several runs)
  const miss = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.error.mse/fitted.standardizer.fit': SD }, landing: 'none' });
  assert.equal(miss.outputs.accepted, true);
  assert.deepEqual(miss.receipt.fillReach, { 'fitted.error.mse/fitted.standardizer.fit': [] });
  // typos fail in every mode
  for (const landing of ['path', 'all', 'none']) {
    assert.throws(() => w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.standardizer.fit#refrence': SD }, landing, cache: false }), (e) => e.code === 'BAD_FILL');
    assert.throws(() => w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.pipeline.regression/fitted.standardizer.fitt': SD }, landing, cache: false }), (e) => e.code === 'BAD_FILL');
  }
  // the same intention spelled as a path that reaches no call is an error by default
  assert.throws(() => w.run('fitted.pipeline.regression', hand, { fill: { 'fitted.pipeline.regression/fitted.standardizer.fit#reference': SD }, cache: false }), (e) => e.code === 'BAD_FILL');
  // v0.6: an inherited run is recorded, so the ridge trace answers "why did betaRidge run?" and the plain trace "why did it not?"
  const ridge = w.run('fitted.linear.fit', { matrix: [[0], [1], [2], [3]], targets: [1, 3, 5, 7], penalty: 3 });
  const plain = w.run('fitted.linear.fit', { matrix: [[0], [1], [2], [3]], targets: [1, 3, 5, 7], penalty: 0 });
  assert.equal(ridge.trace.decisions.find((d) => d.label === 'betaRidge').ran, 'betaRidge');
  assert.equal(plain.trace.decisions.find((d) => d.label === 'betaRidge').skipped, 'betaRidge');
});

test('v0.3 concat: augmented rows keep a path into the input rows; only the penalty rows are computed', () => {
  const w = fresh();
  const r = w.run('fitted.ridge.augment', { matrix: [[1, 5], [1, 6]], vector: [7, 8], penalty: 4 });
  assert.deepEqual(r.outputs, { matrix: [[1, 5], [1, 6], [0, 2]], vector: [7, 8, 0] });
  const pieces = r.trace.out.matrix.from.pieces;
  assert.deepEqual(pieces.map((p) => [p.path[0], p.from.kind, p.from.kind === 'at' ? p.from.of.kind : null, p.from.kind === 'at' ? p.from.path[0] : null]), [[0, 'at', 'input', 0], [1, 'at', 'input', 1], [2, 'computed', null, null]]);
  assert.deepEqual(r.trace.out.vector.from.pieces.map((p) => p.from.kind), ['at', 'at', 'computed']);
});

test('v0.4 ctx.drive + ctx.test: k-means fit is init + a drive; each tick has its relation as the decision (no helper contract), the drive records why it stopped, and collect gives a per-tick history', () => {
  const w = fresh();
  const pts = blobs();
  const km = w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed: 11 });
  assert.equal(w.contracts().some((c) => c.id === 'fitted.labels.same'), false, 'the helper contract is gone');
  assert.deepEqual(km.trace.calls.map((c) => [c.contract, c.tick ?? null]), [['fitted.kmeans.init', null], ['fitted.kmeans.step', 0], ['fitted.kmeans.step', 1], ['fitted.kmeans.step', 2]]);
  assert.equal(km.outputs.iterations, 3); assert.equal(km.outputs.converged, true);
  // each tick's decision names both branches, and its provenance is the eq(...) relation with both operands
  const dec = L.decisionsOf(km.trace);
  assert.deepEqual(dec.map((d) => [d.tick, d.label, d.value, d.ran, d.skipped]), [
    [0, 'labels unchanged?', false, 'update', 'keep centroids'], [1, 'labels unchanged?', false, 'update', 'keep centroids'], [2, 'labels unchanged?', true, 'keep centroids', 'update']]);
  assert.ok(dec.every((d) => d.fromCall === 'test'));
  const last = km.trace.calls[3];
  assert.equal(last.decisions[0].from.op, 'eq'); assert.equal(last.decisions[0].from.args.length, 2);
  assert.deepEqual(km.trace.calls.filter((c) => c.tick !== undefined).map((c) => c.calls.map((k) => k.contract.split('.').pop())), [['assign', 'update'], ['assign', 'update'], ['assign']], 'update is not called on the converged tick, and no node exists for the comparison');
  // `converged` is the relation's own Ref, forwarded through the tick and the fit
  assert.equal(km.trace.out.converged.from.kind, 'call'); assert.equal(km.trace.out.converged.from.call, last.id);
  assert.equal(last.out.converged.from.kind, 'test');
  // node.drives records the count and why it stopped (v0.4); a capped fit says maxTicks, a converged one says until
  assert.deepEqual(km.trace.drives, [{ contract: 'fitted.kmeans.step', slot: null, startTick: 0, ticks: 3, stopped: 'until', calls: [3, 6, 9] }]);
  const capped = w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 1 }, { seed: 1 });
  assert.deepEqual([capped.outputs.iterations, capped.outputs.converged, capped.trace.drives[0].stopped], [1, false, 'maxTicks']);
  // collect: one history Ref, each element pointing at its tick's call
  assert.equal(km.outputs.history.length, 3);
  assert.deepEqual(km.trace.out.history.from.pieces.map((p) => [p.path[0], p.from.kind, p.from.call, p.from.port]), [[0, 'call', 3, 'state'], [1, 'call', 6, 'state'], [2, 'call', 9, 'state']]);
  assert.deepEqual(km.outputs.history.map((h) => h.centroids.map((c) => c.map((v) => Number(v.toFixed(3))))), [[[6.1, 5.08], [0.5, 1]], [[8, 6.886], [1, 0.943]], [[8, 6.886], [1, 0.943]]], 'history: the state after each tick (the unsorted order the drive kept)');
  // the model's centroids are paths into the LAST tick's state (the sort is visible: centroid 0 comes from row 1)
  const o = L.fieldOrigins(km.trace, km.trace);
  assert.deepEqual(o.map((x) => [x.path.join('.'), x.kind, x.call, x.within?.join('.') ?? '']), [['kind', 'literal', null, ''], ['centroids.0', 'call', 9, 'centroids.1'], ['centroids.1', 'call', 9, 'centroids.0']]);
  // same seed again: the fit is impure (ctx.random) so it is not cached, but the tick children are
  const again = w.run('fitted.kmeans.fit', { matrix: pts, k: 2, maxIterations: 20 }, { seed: 11 });
  assert.equal(again.trace.cached, false);
  assert.deepEqual(again.trace.calls.filter((c) => c.tick !== undefined).map((c) => c.cached), [true, true, true]);
  assert.deepEqual(again.trace.drives.map(({ calls, ...rest }) => [rest, calls.length]), km.trace.drives.map(({ calls, ...rest }) => [rest, calls.length]), 'a drive over cache hits still records its ticks (the call ids differ: a hit is one node)');
  assert.equal(w.replay(km.receipt).exact, true);
});

test('v0.4 startTick: a world.drive resumed from an earlier drive continues the clock, and the two halves give the same state as one drive', () => {
  const w = fresh();
  const pts = blobs();
  const init = w.run('fitted.kmeans.init', { matrix: pts, k: 2 }, { seed: 11 });
  const whole = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { until: (o) => o.converged, maxTicks: 50, cache: false });
  const first = w.drive('fitted.kmeans.step', { matrix: pts, state: init.refs.state }, { ticks: 2, cache: false });
  const rest = w.drive('fitted.kmeans.step', { matrix: pts, state: first.state }, { until: (o) => o.converged, maxTicks: 50, startTick: 2, cache: false });
  assert.deepEqual(first.receipts.map((r) => r.tick), [0, 1]);
  assert.deepEqual(rest.receipts.map((r) => r.tick), [2], 'the resumed drive says tick 2, not tick 0');
  assert.deepEqual(rest.final.state, whole.final.state);
  assert.equal(first.ticks + rest.ticks, whole.ticks);
  assert.equal(w.replay(rest.receipts[0]).exact, true, 'a resumed tick replays alone');
});

test('v0.5 specificity (was v0.3 slot declaration, where a contract-wide fill blinded the audit): the slot select at #reference pins the audit refit against a contract fill; a typo in the slot is BAD_FILL, a call without the slot is UNDECLARED_SLOT; the audit is blind only if the reference slot itself is filled wrong', () => {
  const w = fresh();
  const WRONG = { 'fitted.standardizer.fit': 'fitted.standardizer.fit/sample-sd' };
  // v0.5 specificity: the slot select at #reference is a pin. A contract-wide fill breaks the pipeline's fit (an unslotted seat) but no longer reaches the
  // audit's reference, so the audit rejects with no pin from the caller (v0.4: accepted, blind)
  const sweep = w.run('fitted.audit.pipeline', hand, { fill: WRONG, cache: false });
  assert.equal(sweep.outputs.accepted, false, 'the pinned reference keeps `columns` under a contract-wide fill');
  assert.equal(sweep.outputs.reason, 'column 0: model has mean 2 sd 1.1547, the rows have mean 2 sd 1');
  assert.deepEqual(sweep.receipt.fillConsulted, ['fitted.standardizer.fit']);
  // v0.6: fillReach answers "which calls did the contract fill choose" (was a walk over the trace): exactly the pipeline's fit, and the reference seat says it was chosen by its pin
  const fitCalls = []; L.walk(sweep.trace, (n) => { if (n.contract === 'fitted.standardizer.fit') fitCalls.push(n); });
  assert.deepEqual(sweep.receipt.fillReach['fitted.standardizer.fit'], fitCalls.filter((n) => !n.slot).map((n) => n.id));
  assert.deepEqual(fitCalls.map((n) => [n.slot, n.chosenBy.rung]).sort(), [[null, 'contract fill'], ['reference', 'slot select']]);
  // landing 'all' on the audit alone: the contract key reaches nothing there (the reference is pinned), so an experiment that aims is refused
  assert.throws(() => w.run('fitted.audit.standardizer', { model: { kind: 'standardizer', means: [2], sds: [1.1547005383792515] }, matrix: [[1], [1], [3], [3]] }, { fill: WRONG, landing: 'all', cache: false }), (e) => e.code === 'BAD_FILL');
  // `contract#*` reaches every SLOTTED seat on purpose: here only the reference is slotted, so the pipeline fit stays honest and the audit rejects the other way round
  const star = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.standardizer.fit#*': 'fitted.standardizer.fit/sample-sd' }, cache: false });
  assert.equal(star.outputs.accepted, false);
  assert.deepEqual(star.receipt.fillConsulted, ['fitted.standardizer.fit#*']);
  // the audit is blind only when the experimenter breaks the reference ON PURPOSE too: a slot fill beats the slot select
  const blind = w.run('fitted.audit.pipeline', hand, { fill: { ...WRONG, 'fitted.standardizer.fit#reference': 'fitted.standardizer.fit/sample-sd' }, cache: false });
  assert.equal(blind.outputs.accepted, true, 'both the pipeline fit and the reference were broken the same way, deliberately');
  assert.deepEqual([...blind.receipt.fillConsulted].sort(), ['fitted.standardizer.fit', 'fitted.standardizer.fit#reference']);
  // a pin at the slot still works as a pin when the contract is swept AND the slot is filled honestly
  const pinned = w.run('fitted.audit.pipeline', hand, { fill: { ...WRONG, 'fitted.standardizer.fit#reference': 'fitted.standardizer.fit/columns' }, cache: false });
  assert.equal(pinned.outputs.accepted, false);
  assert.equal(pinned.outputs.reason, 'column 0: model has mean 2 sd 1.1547, the rows have mean 2 sd 1');
  // v0.4 path fill: name the chain instead of pinning the reference. Only fits made beneath the pipeline are broken; the audit's refit is untouched
  const byPath = w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.pipeline.regression/fitted.standardizer.fit': 'fitted.standardizer.fit/sample-sd' } });
  assert.equal(byPath.outputs.accepted, false, 'a path fill breaks the pipeline fit only, so the audit sees the difference with no pin');
  assert.equal(byPath.outputs.reason, 'column 0: model has mean 2 sd 1.1547, the rows have mean 2 sd 1');
  // typo in the slot
  assert.throws(() => w.run('fitted.audit.pipeline', hand, { fill: { 'fitted.standardizer.fit#refrence': 'fitted.standardizer.fit/columns' } }), (e) => e.code === 'BAD_FILL' && /refrence/.test(e.message));
  // an implementation that declares only the slot may not call without it
  w.implement({ id: 'fitted.audit.standardizer/noslot', implements: 'fitted.audit.standardizer', uses: ['fitted.standardizer.fit#reference'],
    run: ({ matrix }, ctx) => { ctx.call('fitted.standardizer.fit', { matrix }); return { accepted: true, reason: 'unreachable' }; } });
  assert.throws(() => w.run('fitted.audit.standardizer', { model: { kind: 'standardizer', means: [2], sds: [1] }, matrix: [[1], [3]] }, { fill: { 'fitted.audit.standardizer': 'fitted.audit.standardizer/noslot' } }),
    (e) => e.code === 'UNDECLARED_SLOT');
  // and the trace shows the call site
  const ok = w.run('fitted.audit.standardizer', { model: { kind: 'standardizer', means: [2], sds: [1] }, matrix: [[1], [1], [3], [3]] }, { cache: false });
  assert.deepEqual(ok.trace.calls.map((c) => `${c.contract}#${c.slot}`), ['fitted.standardizer.fit#reference']);
});

test('v0.3 cached verdicts: an audit under a cache hit is still in receipt.verdicts, marked cached with the run and call it came from', () => {
  const w = fresh();
  const first = w.run('fitted.audit.pipeline', hand);
  assert.deepEqual(first.receipt.verdicts.map((v) => [v.contract, v.accepted, Boolean(v.cached)]), [['fitted.audit.pipeline', true, false], ['fitted.audit.standardizer', true, false]]);
  // identical run: the root is a cache hit and both verdicts are carried (v0.2 returned none)
  const second = w.run('fitted.audit.pipeline', hand);
  assert.equal(second.trace.cached, true);
  assert.deepEqual(second.receipt.verdicts.map((v) => [v.contract, v.accepted, v.cached]), [['fitted.audit.pipeline', true, true], ['fitted.audit.standardizer', true, true]]);
  assert.ok(second.receipt.verdicts.every((v) => v.cachedFrom.run === first.receipt.runId));
  // change only the penalty: the pipeline reruns, the audit of the standardizer is a cache hit INSIDE a computed run, and its verdict is still reported
  const third = w.run('fitted.audit.pipeline', { ...hand, penalty: 2 });
  assert.equal(third.trace.cached, false);
  const hit = third.trace.calls.find((c) => c.contract === 'fitted.audit.standardizer');
  assert.equal(hit.cached, true);
  assert.deepEqual(third.receipt.verdicts.map((v) => [v.contract, v.accepted, Boolean(v.cached)]), [['fitted.audit.pipeline', true, false], ['fitted.audit.standardizer', true, true]]);
  // the same, for a leak: a rejected verdict under a cache hit is still a rejection
  const leak = w.run('fitted.audit.pipeline', hand, { fill: LEAKY });
  const leak2 = w.run('fitted.audit.pipeline', hand, { fill: LEAKY });
  assert.equal(leak2.trace.cached, true);
  assert.deepEqual(leak2.receipt.verdicts.map((v) => [v.accepted, v.cached]), [[false, true], [false, true]]);
  assert.equal(leak.outputs.reason, leak2.outputs.reason);
});

test('v0.3 addressing: world.ref names an INNER call of a pipeline run, and the later apply resolves to that fit through the edge; world.node reads a cache hit\'s original gather pieces', () => {
  const w = fresh();
  const pipe = w.run('fitted.pipeline.regression', hand, { cache: false });
  // the standardizer fit is call #7 inside the pipeline run; no output port of the pipeline exposes it under that name (it does expose `standardizer`)
  const inner = w.ref(pipe.receipt.runId, 7, 'model');
  assert.equal(inner.hash, pipe.refs.standardizer.hash);
  const later = w.run('fitted.standardizer.apply', { model: inner, matrix: [[5], [0]] });
  assert.deepEqual(later.outputs.matrix, [[3], [-2]]);
  const [pair] = L.lineageFor(w).fitApplyPairs(later.trace, later.receipt.runId);
  assert.deepEqual([pair.crossRun, pair.fitRun, pair.fit, pair.fitContract], [true, pipe.receipt.runId, 7, 'fitted.standardizer.fit']);
  assert.deepEqual(w.node(pipe.receipt.runId, 7).in.matrix.hash, pipe.trace.calls[5].in.matrix.hash);
  assert.throws(() => w.ref(pipe.receipt.runId, 9999, 'model'), (e) => e.code === 'NO_SUCH_CALL');
  // N4: a cached fit's own out.from is still `cached`, but cachedFrom + world.node recovers the gather pieces
  const f1 = w.run('fitted.linear.fit', { matrix: [[0], [1], [2], [3]], targets: [1, 3, 5, 7], penalty: 0 });
  const f2 = w.run('fitted.linear.fit', { matrix: [[0], [1], [2], [3]], targets: [1, 3, 5, 7], penalty: 0 });
  assert.equal(f2.trace.out.model.from.kind, 'cached');
  assert.deepEqual(L.fieldOrigins(f2.trace, f2.trace), [{ path: [], kind: 'cached' }], 'without the world: nothing to read');
  assert.deepEqual(L.fieldOrigins(f2.trace, f2.trace, 'model', w), L.fieldOrigins(f1.trace, f1.trace), 'with the world: the original node answers');
});

test('v0.4 x-role: lineage reads port annotations, not names. An annotated pair with names that match nothing is found and its leak is caught; an UNannotated pair is still invisible, but trainOnly now says null (unknown), not true', () => {
  const w = fresh();
  const vals = { type: 'array', minItems: 1, items: { type: 'number' } };
  const build = (suffix, annotate) => {
    const A = (schema, r) => (annotate ? { ...schema, 'x-role': r } : schema);
    const model = { type: 'object', required: ['kind', 'shift'], properties: { kind: { type: 'string', enum: ['shift'] }, shift: { type: 'number' } } };
    w.contract({ id: `x.shift${suffix}.learn`, in: { values: A(vals, 'data') }, out: { model: A(model, 'model') } });
    w.implement({ id: `x.shift${suffix}.learn/mean`, implements: `x.shift${suffix}.learn`, uses: ['stat.mean'], run: ({ values }, ctx) => ({ model: ctx.gather({ kind: ctx.literal('shift'), shift: ctx.call('stat.mean', { values }).value }) }) });
    w.contract({ id: `x.shift${suffix}.use`, in: { model: A(model, 'model'), values: vals }, out: { values: vals } });
    w.implement({ id: `x.shift${suffix}.use/sub`, implements: `x.shift${suffix}.use`, run: ({ model: m, values }) => ({ values: values.value.map((v) => v - m.value.shift) }) });
    w.contract({ id: `x.shift${suffix}.both`, in: { train: vals, test: vals }, out: { values: vals } });
    w.compose({ id: `x.shift${suffix}.both/c`, implements: `x.shift${suffix}.both`, steps: [
      { name: 'm', call: `x.shift${suffix}.learn`, bind: { values: '$in.test' } }, // DELIBERATE leak: learns from the test values
      { name: 'u', call: `x.shift${suffix}.use`, bind: { model: 'm.model', values: '$in.test' } },
    ], returns: { values: 'u.values' } });
    return w.run(`x.shift${suffix}.both`, { train: [1, 2, 3], test: [10, 12] });
  };
  const Lw = () => L.lineageFor(w); // roles are read from the contracts registered so far
  const bare = build('A', false);
  assert.deepEqual(bare.outputs.values, [-1, 1]);
  assert.equal(bare.trace.calls[1].in.model.from.kind, 'call', 'the kernel recorded the edge all the same');
  assert.deepEqual(Lw().fitApplyPairs(bare.trace), [], 'no annotation, no pair');
  assert.deepEqual(Lw().trainingRows(bare.trace), []);
  assert.equal(Lw().trainOnly(bare.trace), null, 'round 3 answered true here; round 4 answers unknown because it recognised no fit');
  // the same scenario with x-role on four ports: the pair and the leak are found, with names that match nothing
  const marked = build('B', true);
  const pairs = Lw().fitApplyPairs(marked.trace);
  assert.deepEqual(pairs.map((p) => [p.applyContract, p.fitContract, p.origin]), [['x.shiftB.use', 'x.shiftB.learn', 'call']]);
  assert.deepEqual(Lw().trainingRows(marked.trace).map((r) => [r.contract, r.rowsFrom]), [['x.shiftB.learn', 'none: all rows (input)']]);
  assert.equal(Lw().trainOnly(marked.trace), false, 'the leak is caught');
  // and what the kernel's world.contracts() exposes is the annotation itself
  assert.equal(w.contracts().find((c) => c.id === 'x.shiftB.learn').out.model['x-role'], 'model');
  assert.equal(w.contracts().find((c) => c.id === 'x.shiftA.learn').out.model['x-role'], undefined);
});

test('v0.4 x-role covers k-means: the fit that contains a drive is a fit by role, and its training rows are audited; the tick state needs no role of its own', () => {
  const w = fresh();
  const km = w.run('fitted.kmeans.fit', { matrix: blobs(), k: 2, maxIterations: 20 }, { seed: 11 });
  const Lw = L.lineageFor(w);
  assert.deepEqual(Lw.trainingRows(km.trace), [{ fit: 1, contract: 'fitted.kmeans.fit', rowsFrom: 'none: all rows (input)' }], 'round 3: [] (k-means was not in the FITS table)');
  const pred = w.run('fitted.kmeans.predict', { model: km.refs.model, matrix: blobs() });
  const [pair] = Lw.fitApplyPairs(pred.trace, pred.receipt.runId);
  assert.deepEqual([pair.fitContract, pair.fitRun, pair.crossRun], ['fitted.kmeans.fit', km.receipt.runId, true], 'kmeans.predict is found by its role, and the pairing crosses runs');
  // the roles in play, read from the contracts
  assert.deepEqual([...Lw.roles.fit.keys()].sort(), ['fitted.constant.fit', 'fitted.kmeans.fit', 'fitted.linear.fit', 'fitted.standardizer.fit']);
  assert.deepEqual([...Lw.roles.select.keys()].sort(), ['fitted.rows.select', 'fitted.values.select']);
  // targets of the regression are audited too now (a data port by role); the clean pipeline still passes, the leaky one fails on the standardizer only
  const clean = w.run('fitted.pipeline.regression', hand, { cache: false });
  assert.deepEqual(Lw.trainingRows(clean.trace).map((r) => [r.contract, r.rowsFrom]), [['fitted.standardizer.fit', 'fitted.split.byGroup.trainRows'], ['fitted.linear.fit', 'fitted.split.byGroup.trainRows'], ['fitted.constant.fit', 'fitted.split.byGroup.trainRows']]);
});
