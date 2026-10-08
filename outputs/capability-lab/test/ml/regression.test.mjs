import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import { capabilities as linalgCapabilities } from '../../src/linalg/index.mjs';
import {
  capabilities,
  fitLinearRegression,
  predictLinearRegression,
} from '../../src/ml/regression.mjs';

const identityFixture = () => ({
  features: [[1, 0], [0, 1]],
  targets: [2, 3],
  fitIntercept: false,
});

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from ${expected}`);
};

test('least-squares fit retains literal coefficients and predicts known rows', () => {
  const fit = fitLinearRegression(identityFixture());
  assert.deepEqual(fit.model, {
    kind: 'linearRegression',
    version: 1,
    coefficients: [2, 3],
    intercept: 0,
    featureCount: 2,
    sampleCount: 2,
    fitIntercept: false,
    solver: 'linalg.leastSquares',
  });
  assert.deepEqual(fit.diagnostics, {
    rank: 2,
    predictions: [2, 3],
    residuals: [0, 0],
    residualNorm: 0,
  });
  assert.deepEqual(predictLinearRegression({ model: fit.model, features: [[2, 0], [0, -1], [1, 1]] }), {
    predictions: [4, -3, 5],
  });
});

test('intercept fit matches an independent affine fixture', () => {
  const fit = fitLinearRegression({
    features: [[0], [1], [2], [3]],
    targets: [1, 3, 5, 7],
  });
  assert.equal(fit.model.fitIntercept, true);
  assert.equal(fit.model.sampleCount, 4);
  close(fit.model.intercept, 1);
  close(fit.model.coefficients[0], 2);
  const predictions = predictLinearRegression({ model: fit.model, features: [[-1], [4]] }).predictions;
  close(predictions[0], -1);
  close(predictions[1], 9);
  assert.equal(fit.diagnostics.rank, 2);
});

test('fit and prediction preserve input records and the retained model has no targets', () => {
  const input = identityFixture();
  const before = structuredClone(input);
  const fit = fitLinearRegression(input);
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(fit.model, 'targets'), false);
  const predictionInput = { model: fit.model, features: [[3, 4]] };
  const predictionBefore = structuredClone(predictionInput);
  predictLinearRegression(predictionInput);
  assert.deepEqual(predictionInput, predictionBefore);
});

test('underdetermined, rank-deficient, ragged, nonfinite, and mismatched inputs are rejected', () => {
  assert.throws(() => fitLinearRegression({ features: [[1, 2]], targets: [3], fitIntercept: false }), /rows|underdetermined|leastSquares/i);
  assert.throws(() => fitLinearRegression({ features: [[1, 1], [2, 2], [3, 3]], targets: [1, 2, 3], fitIntercept: false }), /rank-deficient/i);
  assert.throws(() => fitLinearRegression({ features: [[1], [2, 3]], targets: [1, 2] }), /rectangular|same feature/i);
  assert.throws(() => fitLinearRegression({ features: [[Number.NaN]], targets: [1] }), /finite/i);
  assert.throws(() => fitLinearRegression({ features: [[1], [2]], targets: [1] }), /length/i);
  const model = fitLinearRegression({ features: [[1]], targets: [2], fitIntercept: false }).model;
  assert.throws(() => predictLinearRegression({ model, features: [[1, 2]] }), /feature count|columns/i);
  assert.throws(() => predictLinearRegression({ model: { ...model, coefficients: [Infinity] }, features: [[1]] }), /finite/i);
});

test('work is bounded by rows, columns, and total matrix cells', () => {
  const features = Array.from({ length: 1_600 }, (_, row) => Array.from({ length: 64 }, (_, column) => row + column));
  const targets = Array(features.length).fill(1);
  assert.throws(() => fitLinearRegression({ features, targets, fitIntercept: false }), /bound|cells/i);
});

test('descriptor examples are literal and trainer/predictor trace declared linalg calls', () => {
  const registry = createRegistry([...linalgCapabilities, ...capabilities], { source: 'ml-regression-tests', version: '1' });
  for (const descriptor of capabilities) {
    assert.ok(descriptor.examples.length > 0, `${descriptor.id} declares a static fixture`);
    for (const example of descriptor.examples) {
      assert.deepEqual(registry.execute(descriptor.id, example.input).result, example.expected);
    }
  }
  const fit = registry.execute('ml.fitLinearRegression', identityFixture());
  assert.equal(fit.trace.calls[0].id, 'linalg.leastSquares');
  assert.ok(fit.trace.calls[0].calls.length > 0, 'leastSquares exposes its nested QR/substitution calls');
  const prediction = registry.execute('ml.predictLinearRegression', {
    model: fit.result.model,
    features: [[4, 5], [6, 7]],
  });
  assert.deepEqual(prediction.trace.calls.map(call => call.id), ['linalg.dot', 'linalg.dot']);
  assert.deepEqual(prediction.result, { predictions: [23, 33] });
});
