import test from 'node:test';
import assert from 'node:assert/strict';
import { runMLExperiment, predictMLModel } from '../../src/ml/index.mjs';
import {
  explainLinearRegression,
  perturbLinearRegression,
  prepareExplanationFeatures,
} from '../../src/explain/regression.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from ${expected}`);
};

const pair = ([ambient, x, y], runId = 'explanation-input') => ({
  runId,
  conditionId: runId,
  features: [ambient, x, y],
});

function makeExperiment(standardize = false, featureNames = ['x', 'y']) {
  const coordinates = [
    [0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [3, 2], [2, 4],
    [5, 0], [5, 4], [8, 1], [1, 5], [3, 6], [7, 5], [6, 2],
  ];
  const dataset = {
    sourceKind: 'literal-linear-fixture',
    featureNames: ['ambient', 'x', 'y'],
    targetName: 'outcome',
    records: coordinates.map(([x, y], index) => ({
      runId: `run-${index}`,
      conditionId: `condition-${index}`,
      features: [100 + index * 13, x, y],
      target: 5 + 3 * x - 2 * y,
    })),
  };
  return runMLExperiment({
    dataset,
    algorithm: 'linearRegression',
    featureNames,
    testFraction: 0.25,
    seed: 41,
    standardize,
  });
}

test('explanation contributions reconstruct the actual predictor in original units', () => {
  const experiment = makeExperiment(false);
  const features = [1234, 4, 7];
  const beforeExperiment = structuredClone(experiment);
  const beforeFeatures = structuredClone(features);
  const explanation = explainLinearRegression({ experiment, features, baseline: [999, 1, 3] });
  assert.equal(explanation.schema, 'linear-prediction-explanation.v1');
  assert.deepEqual(explanation.sourceIdentity, experiment.sourceIdentity);
  assert.equal(explanation.reference.kind, 'explicit');
  assert.deepEqual(explanation.reference.featureValues, [1, 3]);
  close(explanation.reference.prediction, 2);
  assert.deepEqual(explanation.contributions.map(({ name, index, inputValue, referenceValue }) => ({ name, index, inputValue, referenceValue })), [
    { name: 'x', index: 1, inputValue: 4, referenceValue: 1 },
    { name: 'y', index: 2, inputValue: 7, referenceValue: 3 },
  ]);
  close(explanation.contributions[0].coefficient, 3);
  close(explanation.contributions[0].contribution, 9);
  close(explanation.contributions[1].coefficient, -2);
  close(explanation.contributions[1].contribution, -8);
  close(explanation.prediction, 3);
  close(explanation.reconstructedPrediction, 3);
  assert.equal(explanation.roundoff.withinTolerance, true);
  assert.deepEqual(experiment, beforeExperiment, 'explanation must not mutate the saved experiment');
  assert.deepEqual(features, beforeFeatures, 'explanation must not mutate raw input features');
  const actual = predictMLModel({ experiment, records: [pair(features)] }).predictions[0];
  assert.equal(explanation.prediction, actual, 'explanation uses the actual retained predictor');
});

test('training-mean and zero references are selected in source order without losing unselected fields', () => {
  const experiment = makeExperiment(false);
  const features = [500, 4, 7];
  const trainMean = experiment.split.train.reduce((sum, record) => sum + record.features[1], 0) / experiment.split.train.length;
  const trainMeanY = experiment.split.train.reduce((sum, record) => sum + record.features[2], 0) / experiment.split.train.length;
  const trainingMean = explainLinearRegression({ experiment, features });
  assert.equal(trainingMean.reference.kind, 'trainingMean');
  close(trainingMean.reference.featureValues[0], trainMean);
  close(trainingMean.reference.featureValues[1], trainMeanY);
  const zero = explainLinearRegression({ experiment, features, baseline: 'zero' });
  assert.deepEqual(zero.reference.featureValues, [0, 0]);
  const prepared = prepareExplanationFeatures({ experiment, features, baseline: [700, 1, 3] });
  assert.deepEqual(prepared.rawInput, [500, 4, 7]);
  assert.deepEqual(prepared.rawReference, [700, 1, 3]);
  assert.deepEqual(prepared.selectedInput, [4, 7]);
  assert.deepEqual(prepared.selectedReference, [1, 3]);
  assert.deepEqual(prepared.modelInput, [4, 7]);
  assert.deepEqual(prepared.modelReference, [1, 3]);
  assert.deepEqual(prepared.indices, [1, 2]);
  assert.deepEqual(prepared.names, ['x', 'y']);
  assert.deepEqual(prepared.scales, [1, 1]);
});

test('retained standardizer is converted back to original feature units without refitting', () => {
  const experiment = makeExperiment(true);
  const features = [99, 4, 7];
  const before = structuredClone(experiment);
  const explanation = explainLinearRegression({ experiment, features, baseline: [88, 1, 3] });
  close(explanation.contributions[0].coefficient, 3);
  close(explanation.contributions[1].coefficient, -2);
  close(explanation.reference.prediction, 5 + 3 * 1 - 2 * 3);
  close(explanation.reconstructedPrediction, explanation.prediction);
  assert.equal(explanation.roundoff.withinTolerance, true);
  assert.deepEqual(experiment, before);
  const actual = predictMLModel({ experiment, records: [pair(features)] }).predictions[0];
  close(explanation.prediction, actual);
  const prepared = prepareExplanationFeatures({ experiment, features, baseline: [88, 1, 3] });
  assert.deepEqual(prepared.scales, experiment.preprocessing.scales);
  assert.deepEqual(prepared.modelReference, [
    (1 - experiment.preprocessing.means[0]) / experiment.preprocessing.scales[0],
    (3 - experiment.preprocessing.means[1]) / experiment.preprocessing.scales[1],
  ]);
  assert.deepEqual(prepared.rawReference, [88, 1, 3]);
  const trainingMean = explainLinearRegression({ experiment, features });
  assert.equal(trainingMean.reference.kind, 'trainingMean');
  assert.deepEqual(trainingMean.reference.featureValues, experiment.preprocessing.means);
});

test('roundoff tolerance scales with large signed contributions that nearly cancel', () => {
  const experiment = structuredClone(makeExperiment(false));
  experiment.model.coefficients = [1e12, -1e12];
  experiment.model.intercept = 1;
  const explanation = explainLinearRegression({
    experiment,
    features: [0, 1, 1],
    baseline: [0, 0, 0],
  });
  close(explanation.prediction, 1);
  assert.deepEqual(explanation.contributions.map(item => item.contribution), [1e12, -1e12]);
  assert.equal(explanation.roundoff.withinTolerance, true);
  assert.ok(explanation.roundoff.tolerance >= 64 * Number.EPSILON * 4 * 1e12);
});

test('reordered selections use source-schema indices and full-schema explicit references', () => {
  const experiment = makeExperiment(false, ['y', 'ambient']);
  const features = [42, 3, 4];
  const prepared = prepareExplanationFeatures({ experiment, features, baseline: [111, 5, 9] });
  assert.deepEqual(prepared.indices, [2, 0]);
  assert.deepEqual(prepared.names, ['y', 'ambient']);
  assert.deepEqual(prepared.rawInput, [42, 3, 4]);
  assert.deepEqual(prepared.rawReference, [111, 5, 9]);
  assert.deepEqual(prepared.selectedInput, [4, 42]);
  assert.deepEqual(prepared.selectedReference, [9, 111]);
  assert.deepEqual(prepared.modelInput, [4, 42]);
  assert.deepEqual(prepared.modelReference, [9, 111]);
});

test('perturbations use raw-unit deltas and actual predictions with the retained model', () => {
  const experiment = makeExperiment(true);
  const features = [10, 4, 7];
  const beforeExperiment = structuredClone(experiment);
  const beforeFeatures = structuredClone(features);
  const perturbed = perturbLinearRegression({ experiment, features, changes: { x: 1, ambient: 20 } });
  assert.equal(perturbed.schema, 'linear-prediction-perturbation.v1');
  assert.deepEqual(perturbed.originalFeatures, [10, 4, 7]);
  assert.deepEqual(perturbed.changedFeatures, [30, 5, 7]);
  assert.deepEqual(perturbed.changes, [
    { name: 'x', index: 1, from: 4, to: 5, delta: 1, selected: true },
    { name: 'ambient', index: 0, from: 10, to: 30, delta: 20, selected: false },
  ]);
  close(perturbed.originalPrediction, 3);
  close(perturbed.changedPrediction, 6);
  close(perturbed.predictionDelta, 3);
  assert.equal(perturbed.modelUnchanged, true);
  assert.equal(perturbed.preprocessingRefit, false);
  assert.deepEqual(experiment, beforeExperiment);
  assert.deepEqual(features, beforeFeatures);
  const unchanged = perturbLinearRegression({ experiment, features, changes: { ambient: -10 } });
  close(unchanged.predictionDelta, 0);
  assert.deepEqual(unchanged.changedFeatures, [0, 4, 7]);
});

test('invalid artifacts, dimensions, baselines, and perturbations fail clearly', () => {
  const experiment = makeExperiment(false);
  assert.throws(() => explainLinearRegression({ experiment: { ...experiment, schema: 'wrong' }, features: [1, 2, 3] }), /schema/i);
  assert.throws(() => explainLinearRegression({ experiment: { ...experiment, config: { ...experiment.config, algorithm: 'kMeans' } }, features: [1, 2, 3] }), /linearRegression/i);
  assert.throws(() => explainLinearRegression({ experiment: { ...experiment, sourceIdentity: { ...experiment.sourceIdentity, kind: 'stale' } }, features: [1, 2, 3] }), /source identity|sourceKind/i);
  assert.throws(() => explainLinearRegression({ experiment, features: [1, 2] }), /source feature|feature count|length/i);
  assert.throws(() => explainLinearRegression({ experiment, features: [1, Infinity, 3] }), /finite/i);
  assert.throws(() => explainLinearRegression({ experiment, features: [1, 2, 3], baseline: [0, 1] }), /source feature|length/i);
  assert.throws(() => explainLinearRegression({ experiment, features: [1, 2, 3], baseline: 'holdoutMean' }), /baseline/i);
  assert.throws(() => explainLinearRegression({ experiment: { ...experiment, model: { ...experiment.model, coefficients: [1] } }, features: [1, 2, 3] }), /coefficient|feature count|dimension/i);
  assert.throws(() => perturbLinearRegression({ experiment, features: [1, 2, 3], changes: {} }), /at least one|change/i);
  assert.throws(() => perturbLinearRegression({ experiment, features: [1, 2, 3], changes: { missing: 1 } }), /unknown|source feature/i);
  assert.throws(() => perturbLinearRegression({ experiment, features: [1, 2, 3], changes: { x: Infinity } }), /finite/i);
  assert.throws(() => perturbLinearRegression({ experiment, features: [Number.MAX_VALUE * 0.75, 2, 3], changes: { ambient: Number.MAX_VALUE * 0.75 } }), /finite|overflow/i);
});

test('artifact fingerprint traversal rejects cycles, excessive depth, and oversized retained data', () => {
  const input = [1, 2, 3];
  const cyclic = makeExperiment(false);
  const loop = {};
  loop.self = loop;
  cyclic.dataset.extra = loop;
  assert.throws(() => explainLinearRegression({ experiment: cyclic, features: input }), /cycle|cyclic/i);

  const deep = makeExperiment(false);
  let nested = 'leaf';
  for (let index = 0; index < 80; index += 1) nested = { next: nested };
  deep.dataset.extra = nested;
  assert.throws(() => explainLinearRegression({ experiment: deep, features: input }), /depth|bounded/i);

  const oversized = makeExperiment(false);
  oversized.dataset.extra = 'x'.repeat(4 * 1024 * 1024 + 1);
  assert.throws(() => explainLinearRegression({ experiment: oversized, features: input }), /size|byte|bound/i);

  const oversizedArtifact = makeExperiment(false);
  oversizedArtifact.extra = 'x'.repeat(8 * 1024 * 1024 + 1);
  assert.throws(() => explainLinearRegression({ experiment: oversizedArtifact, features: input }), /size|byte|bound/i);
});
