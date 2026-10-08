import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMLExperiment,
  predictMLModel,
  replayMLExperiment,
  runMLExperiment,
  limits,
} from '../../src/ml/index.mjs';
import { buildWatchCalibrationDataset } from '../../src/ml/watch-data.mjs';

const regressionDataset = () => ({
  schema: 'ml-dataset.v1',
  sourceKind: 'declared-numeric-fixture',
  featureNames: ['earlyObservedRate', 'ambientTemperature', 'hiddenConfiguredFaultHz'],
  targetName: 'futureClockErrorSeconds',
  records: Array.from({ length: 12 }, (_, index) => {
    const x = index - 5;
    return {
      runId: `run-${index}`,
      conditionId: `condition-${index}`,
      features: [x, 20 + index, 10 + index],
      target: 3 + 2 * x,
    };
  }),
});

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};

test('grouped regression retains source data, holds out whole groups, and fits train-only preprocessing', () => {
  const dataset = regressionDataset();
  const before = structuredClone(dataset);
  const experiment = runMLExperiment({
    dataset,
    algorithm: 'linearRegression',
    featureNames: ['earlyObservedRate'],
    testFraction: 1 / 3,
    seed: 17,
    standardize: false,
  });
  assert.deepEqual(dataset, before, 'fitting must not mutate the caller dataset');
  assert.deepEqual(experiment.selectedFeatures.sourceFeatureNames, dataset.featureNames);
  assert.deepEqual(experiment.selectedFeatures.names, ['earlyObservedRate']);
  assert.deepEqual(experiment.selectedFeatures.indices, [0]);
  assert.equal(experiment.split.groupCount, 12);
  assert.equal(experiment.split.test.length, 4);
  assert.ok(experiment.split.train.every(record => !experiment.split.test.some(testRecord => testRecord.runId === record.runId)));
  close(experiment.model.coefficients[0], 2);
  close(experiment.model.intercept, 3);
  assert.equal(experiment.training.prediction.predictions.length, experiment.split.train.length);
  assert.equal(experiment.holdout.records.length, experiment.split.test.length);
  close(experiment.holdout.metrics.rmse, 0, 1e-10);
  assert.equal(experiment.baseline.meanModel.sampleCount, experiment.split.train.length);
  close(experiment.baseline.meanModel.mean, experiment.split.train.reduce((sum, row) => sum + row.target, 0) / experiment.split.train.length);
  assert.ok(experiment.trace.calls.some(call => call.id === 'ml.fitLinearRegression'));
  assert.ok(experiment.trace.calls.length <= limits.maxTraceCalls);
  assert.ok(experiment.trace.bytes <= limits.maxTraceBytes);
  assert.ok(experiment.training.calculationTrace.calls.some(call => call.id === 'linalg.leastSquares'));
  dataset.records[0].features[0] = 999;
  assert.notEqual(experiment.dataset.records[0].features[0], 999, 'the retained input is a snapshot, not a caller-owned mutable array');
});

test('heldout target edits change evaluation only, and replay compares full canonical results', () => {
  const dataset = regressionDataset();
  const input = {
    dataset,
    algorithm: 'linearRegression',
    featureNames: ['earlyObservedRate'],
    testFraction: 1 / 3,
    seed: 41,
    standardize: true,
  };
  const original = runMLExperiment(input);
  const edited = structuredClone(dataset);
  for (const index of original.split.testIndices) edited.records[index].target += 1000 + index;
  const changed = runMLExperiment({ ...input, dataset: edited });
  assert.deepEqual(changed.model, original.model);
  assert.deepEqual(changed.preprocessing, original.preprocessing);
  assert.deepEqual(changed.baseline, original.baseline);
  assert.deepEqual(changed.split.trainIndices, original.split.trainIndices);
  assert.notDeepEqual(changed.holdout.metrics, original.holdout.metrics);
  const movedHoldout = structuredClone(dataset);
  for (const index of original.split.testIndices) movedHoldout.records[index].features[0] += 500;
  const featureChangedHoldout = runMLExperiment({ ...input, dataset: movedHoldout });
  assert.deepEqual(featureChangedHoldout.model, original.model);
  assert.deepEqual(featureChangedHoldout.preprocessing, original.preprocessing);
  assert.deepEqual(featureChangedHoldout.baseline, original.baseline);
  const changedTrainingFeature = structuredClone(dataset);
  changedTrainingFeature.records[original.split.trainIndices[0]].features[0] += 0.5;
  const refit = runMLExperiment({ ...input, dataset: changedTrainingFeature });
  assert.notDeepEqual(refit.model, original.model, 'changing a training feature must affect a fitted model when it changes the fit');

  const replay = replayMLExperiment({ experiment: original });
  assert.equal(replay.matches, true);
  assert.deepEqual(replay.mismatches, []);
  assert.deepEqual(replay.canonicalState, replay.canonicalFresh);
  const tampered = structuredClone(original);
  tampered.sourceIdentity.kind = 'tampered-source-label';
  tampered.trace.calls[0].input.hash = '00000000';
  const rejectedReplay = replayMLExperiment({ experiment: tampered });
  assert.equal(rejectedReplay.matches, false);
  assert.ok(rejectedReplay.mismatches.includes('sourceIdentity.kind'));
  assert.ok(rejectedReplay.mismatches.some(path => path.startsWith('trace.calls.0')));
});

test('default options and caller mutations normalize into an immutable replayable recipe', () => {
  const dataset = regressionDataset();
  const modelConfig = { fitIntercept: true };
  const experiment = runMLExperiment({ dataset, algorithm: 'linearRegression', featureNames: ['earlyObservedRate'], modelConfig });
  assert.equal(experiment.config.groupBy, 'conditionId');
  assert.equal(experiment.config.testFraction, 0.2);
  assert.equal(experiment.config.seed, 0);
  assert.equal(experiment.config.standardize, true);
  assert.equal(experiment.config.modelConfig.fitIntercept, true);
  dataset.records[0].features[0] = -10000;
  dataset.records[0].target = 99999;
  modelConfig.fitIntercept = false;
  assert.equal(experiment.dataset.records[0].features[0], regressionDataset().records[0].features[0]);
  assert.equal(experiment.config.modelConfig.fitIntercept, true);
  assert.equal(replayMLExperiment({ experiment }).matches, true);
});

test('known hidden-fault and target features are rejected instead of silently selected', () => {
  const dataset = regressionDataset();
  for (const featureNames of [
    ['hiddenConfiguredFaultHz'],
    ['futureClockErrorSeconds'],
  ]) {
    assert.throws(() => runMLExperiment({
      dataset,
      algorithm: 'linearRegression',
      featureNames,
      testFraction: 1 / 3,
      seed: 2,
    }), /known target|identifier|future|hidden|configured-fault/i);
  }
});

test('classifier, clustering, and PCA retain fitted models and predict without refitting', () => {
  const classification = {
    schema: 'ml-dataset.v1', sourceKind: 'binary-fixture',
    featureNames: ['signal'], targetName: 'classLabel',
    records: Array.from({ length: 20 }, (_, index) => ({
      runId: `class-run-${index}`, conditionId: `class-condition-${index}`,
      features: [index - 10], target: index >= 10 ? 1 : 0,
    })),
  };
  const classifier = runMLExperiment({
    dataset: classification, algorithm: 'logisticRegression', featureNames: ['signal'],
    testFraction: 0.2, seed: 3, standardize: false,
    modelConfig: { learningRate: 0.2, maxIterations: 2000, tolerance: 1e-8 },
  });
  assert.equal(classifier.model.kind, 'logisticRegression');
  assert.equal(classifier.holdout.metrics.count, 4);
  assert.ok(classifier.training.calculationTrace.calls.some(call => call.operationId === 'ml.logisticGradient'));
  assert.deepEqual(predictMLModel({ experiment: classifier, records: classifier.holdout.records }), classifier.holdout.prediction);
  const evaluated = evaluateMLExperiment({ experiment: classifier, records: classifier.holdout.records });
  assert.deepEqual(evaluated.metrics, classifier.holdout.metrics);
  assert.ok(evaluated.trace.calls.some(call => call.id === 'ml.predictLogisticRegression'));
  const unlabeledRecords = classifier.holdout.records.map(({ target, ...record }) => record);
  assert.deepEqual(predictMLModel({ experiment: classifier, records: unlabeledRecords }), classifier.holdout.prediction,
    'prediction must not require or read target values');

  const cloud = {
    schema: 'ml-dataset.v1', sourceKind: 'two-cluster-fixture',
    featureNames: ['x', 'y'],
    records: Array.from({ length: 12 }, (_, index) => {
      const local = index % 6;
      const offset = index < 6 ? 0 : 10;
      return { runId: `cloud-${index}`, conditionId: `point-${index}`, features: [offset + local % 3, offset + Math.floor(local / 3)] };
    }),
  };
  const clusters = runMLExperiment({
    dataset: cloud, algorithm: 'kMeans', featureNames: ['x', 'y'],
    testFraction: 1 / 3, seed: 9, standardize: false,
    modelConfig: { k: 2, maxIterations: 100, tolerance: 1e-12 },
  });
  assert.equal(clusters.model.kind, 'kmeans');
  assert.ok(clusters.training.calculationTrace.calls.some(call => call.id === 'linalg.distance'));
  assert.equal(clusters.holdout.prediction.assignments.length, clusters.holdout.records.length);
  assert.ok(clusters.holdout.prediction.squaredDistances.every(value => value >= 0));

  const pca = runMLExperiment({
    dataset: cloud, algorithm: 'pca', featureNames: ['x', 'y'],
    testFraction: 1 / 3, seed: 9, standardize: false,
    modelConfig: { components: 1 },
  });
  assert.equal(pca.model.kind, 'pca');
  assert.ok(pca.training.calculationTrace.calls.some(call => call.id === 'composed.covarianceMatrix'));
  assert.equal(pca.model.directions.length, 1);
  assert.equal(pca.holdout.prediction.projected.length, pca.holdout.records.length);
  assert.deepEqual(predictMLModel({ experiment: pca, records: pca.holdout.records }), pca.holdout.prediction);
  const newRows = [{ runId: 'new-run', conditionId: 'new-condition', features: [100, 50] }];
  const projected = predictMLModel({ experiment: pca, records: newRows }).projected[0];
  const centered = newRows[0].features.map((value, index) => value - pca.model.means[index]);
  const expectedProjected = pca.model.directions.map(direction => direction.reduce((sum, value, index) => sum + value * centered[index], 0));
  for (let index = 0; index < projected.length; index += 1) close(projected[index], expectedProjected[index]);
});

test('actual watch calibration features exclude configured fault and compare to analytical baseline', () => {
  const dataset = buildWatchCalibrationDataset({ seed: 11 });
  assert.equal(dataset.sourceKind, 'synthetic-watch');
  assert.deepEqual(dataset.featureNames, ['earlyObservedMechanicalHz']);
  assert.equal(dataset.targetName, 'horizonClockErrorSeconds');
  assert.ok(dataset.records.every(record => record.observations && !record.features.includes(dataset.provenance.hiddenHz)));
  const experiment = runMLExperiment({
    dataset, algorithm: 'linearRegression', featureNames: ['earlyObservedMechanicalHz'],
    testFraction: 0.25, seed: 11, standardize: false,
  });
  assert.ok(experiment.baseline.analyticalModel);
  assert.ok(experiment.holdout.baselines.analytical);
  assert.equal(experiment.holdout.records.length, experiment.holdout.metrics.count);
});

test('explicit experiment limits reject oversized trace/data requests and missing labels', () => {
  const dataset = regressionDataset();
  assert.throws(() => runMLExperiment({ dataset: { ...dataset, records: dataset.records.slice(0, 1) }, algorithm: 'linearRegression' }), /records.*2|dataset/i);
  assert.throws(() => runMLExperiment({ dataset, algorithm: 'unknown' }), /algorithm/i);
  assert.throws(() => runMLExperiment({ dataset, algorithm: 'linearRegression', callback() {} }), /unknown.*callback/i);
  assert.throws(() => runMLExperiment({ dataset: { ...dataset, records: dataset.records.map(({ target, ...record }) => record) }, algorithm: 'linearRegression', featureNames: ['earlyObservedRate'] }), /target/i);
  const cyclic = regressionDataset();
  cyclic.provenance = { self: cyclic };
  assert.throws(() => runMLExperiment({ dataset: cyclic, algorithm: 'linearRegression' }), /cycle/i);
  const deep = regressionDataset();
  let nested = deep;
  for (let index = 0; index < 70; index += 1) nested = nested.provenance = {};
  assert.throws(() => runMLExperiment({ dataset: deep, algorithm: 'linearRegression' }), /depth 64/i);
});
