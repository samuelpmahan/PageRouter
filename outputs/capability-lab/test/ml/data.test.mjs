import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import {
  capabilities,
  classificationMetrics,
  fitMeanBaseline,
  fitStandardizer,
  predictMeanBaseline,
  regressionMetrics,
  selectFeatures,
  splitByGroup,
  transformStandardizer,
} from '../../src/ml/data.mjs';

const records = [
  { runId: 'r1', conditionId: 'c1', participant: 'p1', features: [1], target: 10 },
  { runId: 'r1', conditionId: 'c2', participant: 'p2', features: [2], target: 20 },
  { runId: 'r2', conditionId: 'c3', participant: 'p3', features: [3], target: 30 },
  { runId: 'r3', conditionId: 'c3', participant: 'p4', features: [4], target: 40 },
  { runId: 'r4', conditionId: 'c4', participant: 'p1', features: [5], target: 50 },
  { runId: 'r5', conditionId: 'c5', participant: 'p5', features: [6], target: 60 },
];

test('seeded group split keeps linked runs, conditions, and selected groups together', () => {
  const before = structuredClone(records);
  const first = splitByGroup({ records, groupBy: 'participant', testFraction: 0.5, seed: 91 });
  const replay = splitByGroup({ records, groupBy: 'participant', testFraction: 0.5, seed: 91 });
  const changedSeed = splitByGroup({ records, groupBy: 'participant', testFraction: 0.5, seed: 93 });
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first.testIndices, changedSeed.testIndices, 'a changed seed should alter the group holdout');
  assert.deepEqual(records, before, 'splitting must not mutate source records');
  assert.equal(first.groupCount, 3);
  assert.equal(first.test.length > 0, true);
  assert.equal(first.train.length > 0, true);
  const train = new Set(first.train.map(record => record.runId));
  const testRuns = new Set(first.test.map(record => record.runId));
  assert.ok([...train].every(runId => !testRuns.has(runId)), 'run IDs cannot cross splits');
  const trainConditions = new Set(first.train.map(record => record.conditionId));
  const testConditions = new Set(first.test.map(record => record.conditionId));
  assert.ok([...trainConditions].every(conditionId => !testConditions.has(conditionId)), 'condition IDs cannot cross splits');
  const trainParticipants = new Set(first.train.map(record => record.participant));
  const testParticipants = new Set(first.test.map(record => record.participant));
  assert.ok([...trainParticipants].every(participant => !testParticipants.has(participant)), 'selected groups cannot cross splits');
  assert.deepEqual(first.trainIndices.concat(first.testIndices).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});

test('split rejects too few independent groups and malformed grouping inputs', () => {
  assert.throws(() => splitByGroup({ records: [records[0], { ...records[1], runId: 'r1', conditionId: 'c1' }] }), /two independent connected groups/i);
  assert.throws(() => splitByGroup({ records: [records[0], records[1]], testFraction: 0 }), /testFraction/i);
  assert.throws(() => splitByGroup({ records: [records[0], records[1]], seed: -1 }), /seed/i);
  assert.throws(() => splitByGroup({ records: [{ ...records[0], participant: undefined }, records[1]], groupBy: 'participant' }), /participant/i);
});

test('standardizer fits population parameters, marks constants, and reuses its model', () => {
  const trainingFeatures = [[1, 7, 2], [3, 7, 4], [5, 7, 6]];
  const before = structuredClone(trainingFeatures);
  const model = fitStandardizer({ features: trainingFeatures });
  assert.deepEqual(model, {
    kind: 'standardizer', version: 1, means: [3, 7, 4], scales: [Math.sqrt(8 / 3), 1, Math.sqrt(8 / 3)],
    constantColumns: [false, true, false], featureCount: 3, sampleCount: 3, scaleMethod: 'population-standard-deviation',
  });
  const transformed = transformStandardizer({ model, features: [[1, 7, 2], [3, 7, 4], [5, 7, 6]] });
  assert.ok(Math.abs(transformed.features[0][0] + Math.sqrt(1.5)) < 1e-14);
  assert.deepEqual(transformed.features[1], [0, 0, 0]);
  assert.ok(Math.abs(transformed.features[2][2] - Math.sqrt(1.5)) < 1e-14);
  assert.deepEqual(trainingFeatures, before);
  assert.deepEqual(model, fitStandardizer({ features: trainingFeatures }), 'changing unrelated holdout labels cannot enter the scaler fit API');
  assert.deepEqual(transformStandardizer({ model: fitStandardizer({ features: [[7], [7]] }), features: [[9]] }).features, [[2]], 'constant training columns retain scale 1 and still reveal changed holdout values');
  const offsetModel = fitStandardizer({ features: [[1_000_000_000_000], [1_000_000_000_001], [1_000_000_000_002]] });
  assert.equal(offsetModel.means[0], 1_000_000_000_001);
  assert.ok(Math.abs(offsetModel.scales[0] - Math.sqrt(2 / 3)) < 1e-12, 'centered moments preserve variation beside a large offset');
});

test('standardizer rejects dimension mismatch, nonfinite values, and invalid model state', () => {
  assert.throws(() => fitStandardizer({ features: [[1, 2], [3]] }), /same feature count/i);
  assert.throws(() => fitStandardizer({ features: [[1], [Infinity]] }), /finite/i);
  const model = fitStandardizer({ features: [[2], [2]] });
  assert.throws(() => transformStandardizer({ model, features: [[2, 3]] }), /columns/i);
  assert.throws(() => transformStandardizer({ model: { ...model, scales: [0] }, features: [[2]] }), /positive/i);
  assert.throws(() => transformStandardizer({ model: { ...model, sampleCount: 0 }, features: [[2]] }), /sampleCount/i);
  assert.throws(() => transformStandardizer({ model: { ...model, scaleMethod: 'sample' }, features: [[2]] }), /scaleMethod/i);
  assert.throws(() => transformStandardizer({ model: { ...model, constantColumns: [true], scales: [2] }, features: [[2]] }), /scale 1/i);
});

test('regression metrics include exact error measures and mark constant-target R2 undefined', () => {
  assert.deepEqual(regressionMetrics({ actual: [1, 2, 3], predicted: [1, 2, 4] }), {
    count: 3, mae: 1 / 3, mse: 1 / 3, rmse: Math.sqrt(1 / 3), r2: 0.5,
  });
  assert.deepEqual(regressionMetrics({ actual: [4, 4], predicted: [3, 4] }), {
    count: 2, mae: 0.5, mse: 0.5, rmse: Math.sqrt(0.5), r2: null,
  });
  assert.deepEqual(regressionMetrics({ actual: [0, 0], predicted: [1e154, 1e154] }), {
    count: 2, mae: 1e154, mse: 1e308, rmse: 1e154, r2: null,
  }, 'scaled accumulation should preserve a finite true MSE');
  assert.throws(() => regressionMetrics({ actual: [], predicted: [] }), /between 1/i);
  assert.throws(() => regressionMetrics({ actual: [1], predicted: [1, 2] }), /same length/i);
  assert.throws(() => regressionMetrics({ actual: [1], predicted: [Infinity] }), /finite/i);
  assert.throws(() => regressionMetrics({ actual: [0], predicted: [1e200] }), /outside the finite numeric range/i);
});

test('mean baseline uses training targets and predicts without reading evaluation labels', () => {
  const model = fitMeanBaseline({ targets: [2, 4, 6] });
  assert.deepEqual(model, { kind: 'meanBaseline', mean: 4, sampleCount: 3 });
  assert.deepEqual(predictMeanBaseline({ model, count: 3 }), { predictions: [4, 4, 4] });
  const changedEvaluation = [1, 10_000, -50];
  const scores = regressionMetrics({ actual: changedEvaluation, predicted: predictMeanBaseline({ model, count: 3 }).predictions });
  assert.deepEqual(model, { kind: 'meanBaseline', mean: 4, sampleCount: 3 }, 'evaluation labels do not refit the baseline');
  assert.equal(scores.count, changedEvaluation.length);
  assert.equal(fitMeanBaseline({ targets: [1e12, 1e12 + 1, 1e12 + 2] }).mean, 1e12 + 1);
  assert.throws(() => predictMeanBaseline({ model, count: 0 }), /count/i);
});

test('regression rows and baseline targets support the declared ten-thousand-row bound', () => {
  const targets = Array.from({ length: 300 }, (_, index) => index);
  const model = fitMeanBaseline({ targets });
  assert.equal(model.sampleCount, 300);
  const result = regressionMetrics({ actual: targets, predicted: targets });
  assert.equal(result.count, 300);
  assert.equal(result.mse, 0);
});

test('classification metrics produce a deterministic confusion matrix and define missing classes', () => {
  assert.deepEqual(classificationMetrics({ actual: [0, 1, 1], predicted: [0, 0, 1] }), {
    count: 3, classes: [0, 1], confusionMatrix: [[1, 0], [1, 1]], accuracy: 2 / 3,
    macroPrecision: 0.75, macroRecall: 0.75, macroF1: 2 / 3,
  });
  assert.deepEqual(classificationMetrics({ actual: [0, 0], predicted: [0, 3] }), {
    count: 2, classes: [0, 3], confusionMatrix: [[1, 1], [0, 0]], accuracy: 0.5,
    macroPrecision: 0.5, macroRecall: 0.25, macroF1: 1 / 3,
  });
  assert.throws(() => classificationMetrics({ actual: [0], predicted: ['0'] }), /safe integer class label/i);
  assert.throws(() => classificationMetrics({ actual: [0], predicted: [0, 1] }), /same length/i);
});

test('feature selector maps only declared names and rejects known direct leakage fields', () => {
  const dataset = {
    sourceKind: 'observed-fixture', featureNames: ['earlyRate', 'ambient', 'target', 'runId', 'futureError', 'configuredFaultHz', 'observed_error'],
    targetName: 'lateError',
    records: [{ runId: 'r1', conditionId: 'c1', features: [4, 20, 1, 0, 2, 9, 5], target: 2 }],
  };
  const before = structuredClone(dataset);
  assert.deepEqual(selectFeatures({ dataset, featureNames: ['ambient', 'earlyRate'] }), {
    featureNames: ['ambient', 'earlyRate'], featureIndices: [1, 0],
  });
  for (const name of ['target', 'runId', 'futureError', 'configuredFaultHz', 'lateError']) {
    assert.throws(() => selectFeatures({ dataset, featureNames: [name] }), /known target|identifier|future|hidden|configured-fault/i, name);
  }
  const watchDataset = {
    ...dataset, sourceKind: 'synthetic-watch',
    featureNames: ['earlyObservedMechanicalHz', 'mechanicalHz', 'quartzHz', 'softwareHz', 'horizonMechanicalBeats', 'horizonOperatingTime', 'horizonDisplayTime'],
    records: [{ runId: 'watch-1', conditionId: 'fault-a', features: [4.05, 4.05, 32_768, 256, 243, 30, 30.375], target: 0.4 }],
  };
  assert.deepEqual(selectFeatures({ dataset: watchDataset, featureNames: ['earlyObservedMechanicalHz'] }), {
    featureNames: ['earlyObservedMechanicalHz'], featureIndices: [0],
  });
  for (const name of ['mechanicalHz', 'quartzHz', 'softwareHz']) {
    assert.throws(() => selectFeatures({ dataset: watchDataset, featureNames: [name] }), /known target|identifier|future|hidden|configured-fault/i, name);
  }
  for (const name of ['horizonMechanicalBeats', 'horizonOperatingTime', 'horizonDisplayTime']) {
    assert.throws(() => selectFeatures({ dataset: watchDataset, featureNames: [name] }), /known target|identifier|future|hidden|configured-fault/i, name);
  }
  assert.throws(() => selectFeatures({ dataset, featureNames: ['notDeclared'] }), /unknown dataset feature/i);
  assert.throws(() => selectFeatures({ dataset, featureNames: ['ambient', 'ambient'] }), /duplicates/i);
  assert.deepEqual(dataset, before, 'feature selection must not mutate provenance or records');
});

test('capability descriptors use explicit static examples accepted by the registry', () => {
  const registry = createRegistry(capabilities, { source: 'ml-data-tests', version: '1' });
  assert.equal(capabilities.length, 8);
  for (const capability of capabilities) {
    assert.equal(capability.kind, 'atomic');
    assert.equal(capability.examples.length, 1);
    assert.deepEqual(registry.execute(capability.id, capability.examples[0].input).result, capability.examples[0].expected);
  }
});
