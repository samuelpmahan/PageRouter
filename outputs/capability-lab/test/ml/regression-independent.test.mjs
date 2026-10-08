import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLinearRegression, predictLinearRegression } from '../../src/ml/regression.mjs';
import { fitMeanBaseline, fitStandardizer, predictMeanBaseline, regressionMetrics, selectFeatures, splitByGroup, transformStandardizer } from '../../src/ml/data.mjs';
import { buildWatchCalibrationDataset, predictAnalyticalWatchBaseline } from '../../src/ml/watch-data.mjs';
import { applyWatchAction, createWatchRun } from '../../src/watches/index.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
};

test('independent literal regression fixture recovers known intercept and coefficients', () => {
  // Hand-built from y = 5 + 2*x0 - 3*x1.
  const trainingFeatures = [[0, 0], [1, 0], [0, 1], [2, -1]];
  const trainingTargets = [5, 7, 2, 12];
  const fitted = fitLinearRegression({ features: trainingFeatures, targets: trainingTargets });
  assert.equal(fitted.model.kind, 'linearRegression');
  assert.equal(fitted.model.version, 1);
  close(fitted.model.intercept, 5);
  close(fitted.model.coefficients[0], 2);
  close(fitted.model.coefficients[1], -3);
  const predictions = predictLinearRegression({ model: fitted.model, features: [[3, 2], [-1, 4]] });
  close(predictions.predictions[0], 5);
  close(predictions.predictions[1], -9);
});

test('holdout labels and future rows do not enter fitted coefficients or preprocessing', () => {
  const trainFeatures = [[0], [1], [2], [3]];
  const trainTargets = [1, 3, 5, 7];
  const heldoutFeatures = [[4], [5]];
  const scaler = fitStandardizer({ features: trainFeatures });
  const scaledTrain = transformStandardizer({ model: scaler, features: trainFeatures }).features;
  const modelA = fitLinearRegression({ features: scaledTrain, targets: trainTargets }).model;
  const modelB = fitLinearRegression({ features: transformStandardizer({ model: scaler, features: trainFeatures }).features, targets: [...trainTargets] }).model;
  const heldoutTargetsA = [9, 11], heldoutTargetsB = [-1e9, 1e9];
  assert.deepEqual(modelA, modelB);
  assert.deepEqual(scaler, fitStandardizer({ features: trainFeatures }));
  const heldoutScaled = transformStandardizer({ model: scaler, features: heldoutFeatures }).features;
  close(heldoutScaled[0][0], 2.23606797749979);
  close(heldoutScaled[1][0], 3.1304951684997055);
  assert.notDeepEqual(heldoutTargetsA, heldoutTargetsB);
  assert.deepEqual(modelA.coefficients, modelB.coefficients, 'neither future labels nor evaluation labels are accepted by fit');
  assert.throws(() => predictLinearRegression({ model: modelA, features: heldoutFeatures, targets: heldoutTargetsA }), /unknown prediction input field/i);
});

test('grouped holdout splits complete run/condition groups before model fitting', () => {
  const records = [
    { runId: 'r1', conditionId: 'normal', features: [4], target: 0 },
    { runId: 'r1', conditionId: 'repeat', features: [4], target: 0 },
    { runId: 'r2', conditionId: 'slow', features: [3.8], target: -1.5 },
    { runId: 'r3', conditionId: 'fast', features: [4.2], target: 1.5 },
  ];
  const split = splitByGroup({ records, testFraction: 0.5, seed: 2 });
  const trainRunIds = new Set(split.train.map(record => record.runId));
  const testRunIds = new Set(split.test.map(record => record.runId));
  assert.ok([...trainRunIds].every(id => !testRunIds.has(id)));
  const trainConditions = new Set(split.train.map(record => record.conditionId));
  const testConditions = new Set(split.test.map(record => record.conditionId));
  assert.ok([...trainConditions].every(id => !testConditions.has(id)));
  assert.ok(split.train.length > 0 && split.test.length > 0);
});

test('known hidden watch-rate injection fails feature selection before fitting', () => {
  const dataset = {
    sourceKind: 'synthetic-watch',
    featureNames: ['earlyObservedMechanicalHz', 'mechanicalHz'],
    targetName: 'horizonClockErrorSeconds',
    records: [{ runId: 'run-1', conditionId: 'fault-1', features: [3.95, 3.95], target: -0.375 }],
  };
  assert.deepEqual(selectFeatures({ dataset, featureNames: ['earlyObservedMechanicalHz'] }), {
    featureNames: ['earlyObservedMechanicalHz'], featureIndices: [0],
  });
  assert.throws(() => selectFeatures({ dataset, featureNames: ['mechanicalHz'] }), /known target|identifier|future|hidden|configured-fault/i);
  assert.throws(() => selectFeatures({ dataset, featureNames: ['horizonClockErrorSeconds'] }), /known target|identifier|future|hidden|configured-fault/i);
});

test('train-only mean baseline is a fair heldout comparator and metrics report errors', () => {
  const model = fitMeanBaseline({ targets: [2, 4, 6] });
  const predictions = predictMeanBaseline({ model, count: 2 }).predictions;
  assert.deepEqual(predictions, [4, 4]);
  assert.deepEqual(regressionMetrics({ actual: [8, 10], predicted: predictions }), {
    count: 2, mae: 5, mse: 26, rmse: Math.sqrt(26), r2: -25,
  });
});

test('watch calibration uses only early observed rate and keeps heldout labels and later observations out of fit', () => {
  const dataset = buildWatchCalibrationDataset({
    conditions: [37, 38, 39, 40, 41, 42].map((numerator, index) => ({ conditionId: `rate-${index}`, mechanicalHz: { numerator, denominator: 10 } })),
    earlySeconds: 5,
    horizonSeconds: 30,
    seed: 17,
  });
  assert.deepEqual(dataset.featureNames, ['earlyObservedMechanicalHz']);
  const byRate = new Map(dataset.records.map(record => [record.features[0], record.target]));
  for (const [rate, target] of [[3.7, -2.25], [3.8, -1.5], [3.9, -0.75], [4, 0], [4.1, 0.75], [4.2, 1.5]]) {
    close(byRate.get(rate), target);
  }
  assert.ok(dataset.records.every(record => record.features.length === 1));
  assert.ok(dataset.records.every(record => Object.hasOwn(record, 'observations') && !Object.hasOwn(record, 'mechanicalHz')));

  function fitObservedOnly(source) {
    const split = splitByGroup({ records: source.records, testFraction: 1 / 3, seed: 33 });
    const selected = selectFeatures({ dataset: source, featureNames: source.featureNames });
    const trainFeatures = split.train.map(record => selected.featureIndices.map(index => record.features[index]));
    const trainTargets = split.train.map(record => record.target);
    const scaler = fitStandardizer({ features: trainFeatures });
    const standardized = transformStandardizer({ model: scaler, features: trainFeatures }).features;
    const model = fitLinearRegression({ features: standardized, targets: trainTargets }).model;
    return { split, scaler, model };
  }

  const fitted = fitObservedOnly(dataset);
  const editedHoldout = structuredClone(dataset);
  const holdoutIds = new Set(fitted.split.test.map(record => record.conditionId));
  for (const record of editedHoldout.records) {
    if (holdoutIds.has(record.conditionId)) {
      record.target += 10_000;
      record.observations.earlyClockErrorSeconds -= 500;
      record.observations.earlyMechanicalBeats += 123;
    }
  }
  const refit = fitObservedOnly(editedHoldout);
  assert.deepEqual(refit.scaler, fitted.scaler);
  assert.deepEqual(refit.model, fitted.model, 'heldout target and retained later-observation edits do not change learned parameters');

  const analytical = predictAnalyticalWatchBaseline({
    features: dataset.records.map(record => record.features),
    nominalMechanicalHz: 4,
    horizonSeconds: 30,
  });
  const baselineMetrics = regressionMetrics({ actual: dataset.records.map(record => record.target), predicted: analytical.predictions });
  assert.ok(baselineMetrics.mae < 1e-12);
  assert.ok(baselineMetrics.mse < 1e-24, 'the analytical baseline matches the known synthetic rate-drift relation within floating-point rounding');
});

test('shared watch fault conditions remain grouped when separately seeded datasets are merged', () => {
  const first = buildWatchCalibrationDataset({ seed: 1 });
  const second = buildWatchCalibrationDataset({ seed: 2 });
  const sharedConditionIds = new Set(first.records.map(record => record.conditionId)
    .filter(id => second.records.some(record => record.conditionId === id)));
  assert.ok(sharedConditionIds.size > 0);
  const merged = [...first.records, ...second.records];
  const split = splitByGroup({ records: merged, testFraction: 0.3, seed: 8 });
  for (const id of sharedConditionIds) {
    const onTrain = split.train.filter(record => record.conditionId === id).length;
    const onTest = split.test.filter(record => record.conditionId === id).length;
    assert.ok(onTrain === 0 || onTest === 0, `shared condition ${id} cannot cross the merged split`);
    assert.equal(onTrain + onTest, 2, 'both generated observations remain in the split');
  }
});

test('fractional early cycle observation reconstructs measured rate without flooring beats', () => {
  const rate = { numerator: 15, denominator: 4 };
  const initial = createWatchRun({ mechanicalHz: 4 });
  const retuned = applyWatchAction(initial, { type: 'rate', model: 'mechanical', hz: rate });
  const earlyState = applyWatchAction(retuned, { type: 'advance', duration: 5, origin: 'manual' });
  assert.deepEqual(earlyState.cycles.mechanicalBeats, { numerator: 75, denominator: 2 });
  assert.equal(earlyState.counters.mechanicalBeats, 37, 'the integer event count floors a fractional cycle');
  const reconstructedRate = (earlyState.cycles.mechanicalBeats.numerator / earlyState.cycles.mechanicalBeats.denominator)
    / (2 * earlyState.operatingTime.mechanical.numerator / earlyState.operatingTime.mechanical.denominator);
  assert.equal(reconstructedRate, 3.75);

  const dataset = buildWatchCalibrationDataset({
    conditions: [
      { conditionId: 'fractional', mechanicalHz: rate },
      { conditionId: 'slow', mechanicalHz: { numerator: 37, denominator: 10 } },
      { conditionId: 'nominal', mechanicalHz: 4 },
      { conditionId: 'fast', mechanicalHz: { numerator: 41, denominator: 10 } },
    ],
    earlySeconds: 5,
    horizonSeconds: 30,
    seed: 9,
  });
  const record = dataset.records.find(item => item.conditionId === 'fractional');
  assert.equal(record.features[0], reconstructedRate);
  assert.deepEqual(record.observations.earlyMechanicalCycles, earlyState.cycles.mechanicalBeats);
  assert.equal(record.observations.earlyMechanicalBeats, 37);
  assert.deepEqual(record.observations.earlyObservationWindowSeconds, { numerator: 5, denominator: 1 });
  assert.equal(record.observations.readoutKind, 'synthetic-teaching-phase-observation');
  assert.equal(record.observations.formula, 'earlyMechanicalCycles/(2*earlyOperatingTime)');
  assert.deepEqual(record.observations.earlyMechanicalCycles, { numerator: 75, denominator: 2 }, 'these are accumulated beats including fractional phase');
  assert.deepEqual(earlyState.models.mechanical.oscillator.cycles, { numerator: 75, denominator: 4 }, 'full oscillator cycles are half the beat-cycle total');
  assert.notEqual(record.features[0], record.observations.earlyMechanicalBeats / (2 * 5), 'the feature uses fractional cycles, not the floored event count');
});
