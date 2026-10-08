import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import { capabilities as linalgCapabilities } from '../../src/linalg/index.mjs';
import { capabilities as statisticsCapabilities } from '../../src/statistics/index.mjs';
import { capabilities as composedCapabilities } from '../../src/composed/index.mjs';
import { fitPCA, fitPCAWithTrace, transformPCA, pcaCapabilities } from '../../src/ml/pca.mjs';

const registry = () => createRegistry(
  [...statisticsCapabilities, ...linalgCapabilities, ...composedCapabilities, ...pcaCapabilities],
  { source: 'ml-pca-tests', version: '1' },
);

function flattenCalls(calls, into = []) {
  for (const call of calls) {
    into.push(call.id);
    flattenCalls(call.calls ?? [], into);
  }
  return into;
}

test('fit PCA retains training means and returns the literal diagonal covariance axes', () => {
  const features = [[8, 20], [10, 20], [12, 20]];
  const before = structuredClone(features);
  const model = fitPCA({ features });

  assert.equal(model.kind, 'pca');
  assert.equal(model.featureCount, 2);
  assert.deepEqual(model.means, [10, 20]);
  assert.deepEqual(model.directions, [[1, 0], [0, 1]]);
  assert.deepEqual(model.eigenvalues, [4, 0]);
  assert.deepEqual(model.explainedVarianceRatio, [1, 0]);
  assert.equal(model.components, 2);
  assert.equal(model.sampleCount, 3);
  assert.equal(model.converged, true);
  assert.deepEqual(features, before);
});

test('PCA transform centers holdout rows with the fitted training mean only', () => {
  const model = fitPCA({ features: [[8, 20], [10, 20], [12, 20]] });
  const before = structuredClone(model);
  const projection = transformPCA({ model, features: [[14, 21], [0, 0]] });
  assert.deepEqual(projection.projected, [[4, 1], [-10, -20]]);
  assert.deepEqual(model, before);
});

test('PCA selects leading directions and reports ratios against full variance', () => {
  const model = fitPCA({ features: [[1, 2], [3, 6], [5, 10]], components: 1 });
  assert.equal(model.components, 1);
  assert.equal(model.directions.length, 1);
  assert.ok(Math.abs(model.eigenvalues[0] - 20) < 1e-10);
  assert.ok(Math.abs(model.directions[0][0] - 1 / Math.sqrt(5)) < 1e-10);
  assert.ok(Math.abs(model.directions[0][1] - 2 / Math.sqrt(5)) < 1e-10);
  assert.deepEqual(model.explainedVarianceRatio, [1]);
});

test('zero-variance PCA remains finite and defines every explained ratio as zero', () => {
  const model = fitPCA({ features: [[5, 9], [5, 9], [5, 9]] });
  assert.deepEqual(model.means, [5, 9]);
  assert.deepEqual(model.eigenvalues, [0, 0]);
  assert.deepEqual(model.explainedVarianceRatio, [0, 0]);
  assert.ok(model.directions.flat().every(Number.isFinite));
});

test('PCA refuses to return directions when the Jacobi eigensolver does not converge', () => {
  const features = [[0, 0, 0], [1, 2, 3], [2, 0, 1], [-1, 3, 1]];
  assert.throws(() => fitPCA({ features, maxIterations: 1 }), /converg/i);
});

test('PCA rejects too few rows, bad dimensions, non-finite values, and invalid options', () => {
  assert.throws(() => fitPCA({ features: [[1, 2]] }), /at least two|2 rows|contain 2/i);
  assert.throws(() => fitPCA({ features: [[1, 2], [3]] }), /rectangular|same feature/i);
  assert.throws(() => fitPCA({ features: [[1, Infinity], [2, 3]] }), /finite/i);
  assert.throws(() => fitPCA({ features: [[1, 2], [3, 4]], components: 3 }), /components|feature/i);
  assert.throws(() => fitPCA({ features: [[1, 2], [3, 4]], tolerance: -1 }), /tolerance/i);
  assert.throws(() => transformPCA({ model: fitPCA({ features: [[1, 2], [3, 4]] }), features: [[1]] }), /feature count|columns/i);
});

test('PCA descriptors execute their declared covariance, mean, eigensolver, and projection calls', () => {
  const run = registry();
  const fit = run.execute('ml.fitPCA', { features: [[8, 20], [10, 20], [12, 20]] });
  const calls = flattenCalls(fit.trace.calls);
  for (const required of ['composed.covarianceMatrix', 'statistics.mean', 'linalg.symmetricEigen', 'statistics.covariance', 'linalg.transpose']) {
    assert.ok(calls.includes(required), `missing actual PCA dependency call ${required}`);
  }
  assert.deepEqual(fit.result, fitPCA({ features: [[8, 20], [10, 20], [12, 20]] }));

  const projection = run.execute('ml.transformPCA', { model: fit.result, features: [[14, 21]] });
  const projectionCalls = flattenCalls(projection.trace.calls);
  assert.ok(projectionCalls.includes('linalg.vectorSubtract'));
  assert.ok(projectionCalls.includes('linalg.dot'));
  assert.deepEqual(projection.result.projected, [[4, 1]]);
});

test('PCA fit trace preserves real dependency IDs in a bounded JSON-safe summary', () => {
  const { model, trace } = fitPCAWithTrace({ features: [[8, 20], [10, 20], [12, 20]] });
  assert.deepEqual(model, fitPCA({ features: [[8, 20], [10, 20], [12, 20]] }));
  assert.equal(trace.schema, 'ml.training-trace.v1');
  assert.ok(trace.bytes <= 4_096);
  assert.ok(trace.calls.some(call => call.id === 'composed.covarianceMatrix' && call.stage === 'sample-covariance'));
  assert.ok(trace.calls.some(call => call.id === 'statistics.mean' && call.count === 2));
  assert.ok(trace.calls.some(call => call.id === 'linalg.symmetricEigen' && call.stage === 'covariance-eigendecomposition'));
  assert.equal(trace.bytes, new TextEncoder().encode(JSON.stringify(trace)).byteLength);
  assert.deepEqual(JSON.parse(JSON.stringify(trace)), trace);
});

test('PCA transform rejects forged non-orthogonal or inconsistent fitted directions', () => {
  const model = fitPCA({ features: [[8, 20], [10, 20], [12, 20]] });
  assert.throws(() => transformPCA({ model: { ...model, directions: [[1, 0], [1, 0]] }, features: [[10, 20]] }), /orthogonal/i);
  assert.throws(() => transformPCA({ model: { ...model, eigenvalues: [0, 4] }, features: [[10, 20]] }), /descending/i);
  assert.throws(() => transformPCA({ model: { ...model, eigenvalues: [4, 2], explainedVarianceRatio: [0.7, 0.4] }, features: [[10, 20]] }), /cannot exceed/i);
  assert.throws(() => transformPCA({ model: { ...model, eigenvalues: [4, 2], explainedVarianceRatio: [0.6, 0.2] }, features: [[10, 20]] }), /proportional/i);
});
