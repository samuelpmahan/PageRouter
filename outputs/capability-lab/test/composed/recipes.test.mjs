import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import { capabilities as statisticsCapabilities } from '../../src/statistics/index.mjs';
import { capabilities as linalgCapabilities } from '../../src/linalg/index.mjs';
import { capabilities as composedCapabilities } from '../../src/composed/index.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};
const registry = createRegistry(
  [...statisticsCapabilities, ...linalgCapabilities, ...composedCapabilities],
  { source: 'capability-lab', version: '1' },
);

test('PCA scores compose covariance, eigensystem, centering, and projections over a 2D fixture', () => {
  const observations = [[-2, 0], [-1, 0], [1, 0], [2, 0], [0, -1], [0, 1]];
  const execution = registry.execute('composed.pcaScores', { observations, denominator: 'sample' });
  const { covarianceMatrix, eigenvalues, scores } = execution.result;
  close(covarianceMatrix[0][0], 2);
  close(covarianceMatrix[0][1], 0);
  close(covarianceMatrix[1][0], 0);
  close(covarianceMatrix[1][1], 0.4);
  close(eigenvalues[0], 2);
  close(eigenvalues[1], 0.4);
  assert.deepEqual(scores, observations);
  assert.equal(registry.get('composed.covarianceMatrix').order, 1);
  assert.equal(registry.get('composed.principalComponents').order, 2);
  assert.equal(registry.get('composed.pcaScores').order, 3);
  const tracedIds = [];
  const collect = (node) => { for (const call of node.calls) { tracedIds.push(call.id); collect(call); } };
  collect(execution.trace);
  assert.ok(tracedIds.includes('statistics.covariance'));
  assert.ok(tracedIds.includes('linalg.symmetricEigen'));
  assert.ok(tracedIds.includes('linalg.dot'));
});

test('standardized Euclidean profiles return hand-checkable scores and distances', () => {
  const execution = registry.execute('composed.standardizedEuclideanProfiles', {
    observations: [[1, 2], [3, 4], [5, 6]], denominator: 'sample',
  });
  const { zScores, distances } = execution.result;
  assert.deepEqual(zScores, [[-1, -1], [0, 0], [1, 1]]);
  close(distances[0], Math.sqrt(2));
  close(distances[1], 0);
  close(distances[2], Math.sqrt(2));
});

test('regression diagnostics compose least squares with prediction and residual statistics', () => {
  const execution = registry.execute('composed.regressionDiagnostics', {
    matrix: [[1, 0], [1, 1], [1, 2]], vector: [1, 3, 5],
  });
  execution.result.coefficients.forEach((value, index) => close(value, [1, 2][index]));
  execution.result.predictions.forEach((value, index) => close(value, [1, 3, 5][index]));
  execution.result.residuals.forEach((value) => close(value, 0));
  close(execution.result.residualMean, 0);
  close(execution.result.residualPopulationVariance, 0);
  close(execution.result.solverResidualNorm, 0);
  assert.equal(execution.result.rank, 2);
});

test('cross-domain recipes reject shape mismatch and constant-column standardization', () => {
  assert.throws(() => registry.execute('composed.pcaScores', {
    observations: [[1, 2], [3]], denominator: 'sample',
  }), /same number of features|rectangular/i);
  assert.throws(() => registry.execute('composed.regressionDiagnostics', {
    matrix: [[1, 0], [1, 1]], vector: [1],
  }), /same number of rows|same length/i);
  assert.throws(() => registry.execute('composed.standardizedEuclideanProfiles', {
    observations: [[1, 2], [1, 4], [1, 6]], denominator: 'sample',
  }), /zero variance|constant/i);
});

test('PCA refuses to use an explicitly unconverged eigensystem', () => {
  assert.throws(() => registry.execute('composed.principalComponents', {
    observations: [[1, 0, 1], [0, 1, 0], [-1, -1, -1]],
    denominator: 'sample', maxIterations: 1,
  }), /unconverged.*1 iterations/i);
});

test('changed observations produce different evidence and the changed run replays exactly', () => {
  const observations = [[-2, 0], [-1, 0], [1, 0], [2, 0], [0, -1], [0, 1]];
  const original = registry.execute('composed.pcaScores', { observations, denominator: 'sample' });
  const changed = registry.execute('composed.pcaScores', {
    observations: observations.map(([x, y]) => [x, y * 3]), denominator: 'sample',
  });
  assert.notEqual(original.replay.resultCanonical, changed.replay.resultCanonical);
  assert.equal(registry.replay(changed).matches, true);
});
