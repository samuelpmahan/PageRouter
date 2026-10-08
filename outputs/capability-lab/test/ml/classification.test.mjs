import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logisticSigmoid,
  logisticScores,
  binaryCrossEntropy,
  logisticGradient,
  fitLogisticRegression,
  fitLogisticRegressionWithTrace,
  predictLogisticRegression,
} from '../../src/ml/classification.mjs';

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};
const frozen = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};

function finiteOptimumFixture() {
  return {
    features: [[-1],[-1],[-1],[-1],[1],[1],[1],[1]],
    targets: [0,0,0,1,0,1,1,1],
  };
}

test('stable sigmoid handles literal scores including extreme signs', () => {
  close(logisticSigmoid({ score: 0 }), 0.5);
  close(logisticSigmoid({ score: Math.log(3) }), 0.75);
  assert.equal(logisticSigmoid({ score: 1000 }), 1);
  assert.equal(logisticSigmoid({ score: -1000 }), 0);
  assert.throws(() => logisticSigmoid({ score: Infinity }), /finite/i);
});

test('scores, stable logit loss, and full-batch gradient match literal fixtures', () => {
  assert.deepEqual(logisticScores({ features: [[1,2],[-1,3]], coefficients: [2,-1], intercept: 0.5 }), [0.5,-4.5]);
  assert.equal(binaryCrossEntropy({ targets: [1,0], scores: [1000,-1000] }), 0);
  close(binaryCrossEntropy({ targets: [1,0], scores: [-1000,1000] }), 1000);
  const gradient = logisticGradient({ features: [[2]], targets: [1], coefficients: [0], intercept: 0, fitIntercept: true, l2: 0 });
  assert.deepEqual(gradient, { coefficients: [-1], intercept: -0.5 });
  const penalized = logisticGradient({ features: [[0]], targets: [0], coefficients: [1], intercept: 0, l2: 0.5 });
  close(penalized.coefficients[0], 0.5);
});

test('fit converges to finite symmetric optimum and prediction returns score/probability/label', () => {
  const input = finiteOptimumFixture();
  const model = fitLogisticRegression({ ...input, learningRate: 0.5, maxIterations: 5000, tolerance: 1e-9 });
  assert.equal(model.kind, 'logisticRegression');
  assert.deepEqual(model.coefficients.length, 1);
  close(model.intercept, 0, 1e-12);
  assert.equal(model.optimizer.converged, true);
  assert.equal(model.optimizer.method, 'fullBatchGradientDescent');
  close(model.coefficients[0], Math.log(3), 2e-6);
  close(model.optimizer.finalLoss, -(Math.log(0.25) + 3 * Math.log(0.75)) / 4, 2e-6);
  const prediction = predictLogisticRegression({ model, features: [[-1],[1]] });
  assert.deepEqual(prediction.labels, [0,1]);
  close(prediction.probabilities[0], 0.25, 2e-6);
  close(prediction.probabilities[1], 0.75, 2e-6);
  close(prediction.scores[0], -Math.log(3), 2e-6);
});

test('zero initialization, threshold ties, and explicit nonconvergence are honest', () => {
  const tied = fitLogisticRegression({ features: [[1],[1]], targets: [0,0], fitIntercept: false, maxIterations: 1, learningRate: 0.1, tolerance: 0 });
  assert.equal(tied.optimizer.converged, false);
  assert.equal(tied.optimizer.iterations, 1);
  assert.deepEqual(tied.coefficients, [-0.05]);
  assert.equal(tied.intercept, 0);
  assert.equal(tied.training.initialization, 'zeros');
  const prediction = predictLogisticRegression({ model: { kind: 'logisticRegression', version: 1, coefficients: [0], intercept: 0, fitIntercept: true, threshold: 0.5, training: { sampleCount: 1, featureCount: 1, initialization: 'zeros' } }, features: [[0]] });
  assert.deepEqual(prediction.labels, [1], 'probability equal to threshold maps to class 1');
  assert.deepEqual(prediction.probabilities, [0.5]);
  assert.deepEqual(prediction.scores, [0]);
});

test('trace returns bounded initial/final source-linked calculations, not per-row logs', () => {
  const input = { ...finiteOptimumFixture(), learningRate: 0.5, maxIterations: 5000, tolerance: 1e-9 };
  const result = fitLogisticRegressionWithTrace(input);
  assert.deepEqual(result.model, fitLogisticRegression(input));
  assert.equal(result.trace.kind, 'logisticTrainingTrace');
  assert.deepEqual(result.trace.calls.map((call) => [call.sourceId, call.phase]), [
    ['src/ml/classification.mjs#logisticScores','initial'], ['ml.binaryCrossEntropy','initial'], ['src/ml/classification.mjs#objectiveParts','initial'], ['src/ml/classification.mjs#gradientFromScores','initial'],
    ['src/ml/classification.mjs#logisticScores','final'], ['ml.binaryCrossEntropy','final'], ['src/ml/classification.mjs#objectiveParts','final'], ['src/ml/classification.mjs#gradientFromScores','final'],
  ]);
  assert.equal(result.trace.calls[0].outputSummary.count, input.features.length);
  assert.equal(result.trace.calls[0].dependencies[0].sourceId, 'linalg.matvec');
  assert.equal(result.trace.calls[0].outputSummary.minimum, 0);
  close(result.trace.calls[4].outputSummary.minimum, -Math.log(3), 1e-7);
  assert.equal(result.trace.calls[1].outputSummary.loss, 0.6931471805599453);
  assert.equal(result.trace.calls[2].outputSummary.l2Penalty, 0);
  const regularized = fitLogisticRegressionWithTrace({ ...input, l2: 0.5 });
  const finalBce = regularized.trace.calls.find((call) => call.sourceId === 'ml.binaryCrossEntropy' && call.phase === 'final').outputSummary.loss;
  const finalObjective = regularized.trace.calls.find((call) => call.operationId === 'ml.regularizedObjective' && call.phase === 'final').outputSummary;
  assert.ok(finalObjective.objective > finalBce);
  assert.equal(finalObjective.objective, regularized.model.optimizer.finalLoss);
  const incomplete = fitLogisticRegressionWithTrace({ features: [[1],[1]], targets: [0,0], fitIntercept: false, maxIterations: 2, learningRate: 0.1, tolerance: 0 });
  assert.equal(incomplete.model.optimizer.converged, false);
  assert.equal(incomplete.trace.aggregate.gradientEvaluations, 3);
  assert.equal(incomplete.trace.aggregate.omittedIntermediateGradientEvaluations, 1);
  const offset = fitLogisticRegressionWithTrace({ features: [[0],[0]], targets: [1,1], maxIterations: 1, learningRate: 0.1, tolerance: 0 });
  const finalScores = offset.trace.calls.find((call) => call.operationId === 'ml.logisticScores' && call.phase === 'final');
  close(finalScores.outputSummary.minimum, 0.05);
  close(finalScores.outputSummary.maximum, 0.05);
  assert.equal(result.trace.calls[3].dependencies[0].sourceId, 'linalg.dot');
  assert.equal(result.trace.calls[3].dependencies[1].sourceId, 'ml.logisticSigmoid');
  assert.equal(result.trace.aggregate.lossEvaluations, 2);
  assert.equal(result.trace.aggregate.gradientEvaluations, result.model.optimizer.iterations + 2);
  assert.equal(result.trace.aggregate.logisticScoreEvaluations, result.trace.aggregate.gradientEvaluations);
  assert.equal(result.trace.aggregate.matvecEvaluations, result.trace.aggregate.logisticScoreEvaluations);
  assert.ok(JSON.stringify(result.trace).length < 10_000);
  assert.equal(Object.hasOwn(result.trace, 'features'), false);
});

test('prediction reads only model and features, and fit/predict preserve caller inputs', () => {
  const input = frozen(finiteOptimumFixture());
  const before = structuredClone(input);
  const model = fitLogisticRegression({ ...input, maxIterations: 5 });
  assert.deepEqual(input, before);
  const predictionInput = frozen({ model, features: [[-2],[2]] });
  const predictionBefore = structuredClone(predictionInput);
  predictLogisticRegression(predictionInput);
  assert.throws(() => predictLogisticRegression({ ...predictionInput, targets: [0,1] }), /unknown.*prediction.*targets/i);
  assert.deepEqual(predictionInput, predictionBefore);
  assert.equal(Object.hasOwn(model, 'targets'), false);
});

test('binary labels, dimensions, finite values, model shape, and work bounds are enforced', () => {
  assert.throws(() => fitLogisticRegression({ features: [[0],[1]], targets: [0,2] }), /0 or 1|binary/i);
  assert.throws(() => fitLogisticRegression({ features: [[0],[1,2]], targets: [0,1] }), /same.*feature|rectangular/i);
  assert.throws(() => fitLogisticRegression({ features: [[0]], targets: [] }), /same length|match/i);
  assert.throws(() => fitLogisticRegression({ features: [[NaN]], targets: [1] }), /finite/i);
  assert.throws(() => fitLogisticRegression({ features: [[0]], targets: [1], learningRate: 0 }), /learningRate/i);
  assert.throws(() => fitLogisticRegression({ features: [[0]], targets: [1], maxIterations: 10001 }), /maxIterations|iteration/i);
  const boundedFeatures = Array.from({ length: 101 }, (_, index) => [index]);
  const boundedTargets = boundedFeatures.map((_, index) => index % 2);
  assert.throws(() => fitLogisticRegression({ features: boundedFeatures, targets: boundedTargets, maxIterations: 10000 }), /work|bound/i);
  assert.throws(() => predictLogisticRegression({ model: { schema: 'wrong' }, features: [[1]] }), /model.*version/i);
  assert.throws(() => predictLogisticRegression({ model: { kind: 'logisticRegression', version: 1, coefficients: [1], intercept: 0, fitIntercept: true, threshold: 0.5, training: { sampleCount: 1, featureCount: 1, initialization: 'zeros' } }, features: [[1,2]] }), /feature count|dimension/i);
  assert.throws(() => predictLogisticRegression({ model: { kind: 'logisticRegression', version: 1, coefficients: [1], intercept: 0, fitIntercept: true, threshold: 0.5, training: { sampleCount: 1, featureCount: 2, initialization: 'zeros' } }, features: [[1]] }), /training.*featureCount/i);
});
