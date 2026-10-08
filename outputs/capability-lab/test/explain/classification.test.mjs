import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLogisticRegression } from '../../src/ml/classification.mjs';
import { explainLogisticRegression, perturbLogisticRegression } from '../../src/explain/classification.mjs';

const sourceNames = ['first', 'ignored', 'second'];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fingerprint(value) {
  const canonical = canonicalJson(value);
  const bytes = new TextEncoder().encode(canonical);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { bytes: bytes.byteLength, algorithm: 'fnv1a32', hash: hash.toString(16).padStart(8, '0') };
}

function model(overrides = {}) {
  return {
    kind: 'logisticRegression',
    version: 1,
    coefficients: [3, -2],
    intercept: 5,
    fitIntercept: true,
    threshold: 0.5,
    training: { sampleCount: 4, featureCount: 2, initialization: 'zeros' },
    optimizer: {
      method: 'fullBatchGradientDescent', learningRate: 0.1, maxIterations: 20,
      tolerance: 1e-8, l2: 0, iterations: 1, converged: true,
      finalLoss: 0.5, finalBinaryCrossEntropy: 0.5,
      maxBatchElementVisits: 2_000_000, worstCaseElementVisits: 200,
    },
    ...overrides,
  };
}

function experiment({ fitted = model(), preprocessing = null, trainFeatures = [[1, 99, 3], [1, 101, 3]], selectedIndices = [0, 2] } = {}) {
  const records = trainFeatures.map((features, index) => ({ runId: `train-${index}`, conditionId: `condition-${index}`, features, target: index }));
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'literal-fixture', featureNames: [...sourceNames],
    targetName: 'label', records,
  };
  const selectedNames = selectedIndices.map(index => sourceNames[index]);
  return {
    schema: 'ml-experiment.v1',
    sourceIdentity: {
      kind: 'literal-fixture', declaredByCaller: true,
      dataFingerprint: fingerprint(dataset),
    },
    dataset,
    config: { algorithm: 'logisticRegression', featureNames: selectedNames, seed: 7, standardize: preprocessing !== null },
    selectedFeatures: {
      sourceFeatureNames: [...sourceNames],
      names: selectedIndices.map(index => sourceNames[index]),
      indices: selectedIndices,
    },
    split: { train: records, test: [] },
    preprocessing,
    model: fitted,
  };
}

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from ${expected}`);
};

test('logistic explanation reconstructs the literal logit with signed feature contributions', () => {
  const saved = experiment();
  const rawFeatures = [4, 777, 7];
  const savedBefore = structuredClone(saved);
  const rowBefore = rawFeatures.slice();
  const result = explainLogisticRegression({ experiment: saved, features: rawFeatures, baseline: [1, -999, 3] });

  assert.equal(result.kind, 'logisticPredictionExplanation');
  assert.equal(result.version, 1);
  assert.equal(result.baseline.kind, 'explicit');
  assert.deepEqual(result.baseline.rawSelectedFeatures, [1, 3]);
  assert.deepEqual(result.contributions.map(item => item.logitContribution), [9, -8]);
  assert.deepEqual(result.contributions.map(item => item.sourceIndex), [0, 2]);
  assert.equal(result.baseline.logit, 2);
  assert.equal(result.prediction.logit, 3);
  close(result.prediction.probability, 1 / (1 + Math.exp(-3)));
  assert.equal(result.prediction.label, 1);
  close(result.reconstruction.reconstructedLogit, result.prediction.logit);
  assert.equal(result.reconstruction.withinTolerance, true);
  assert.deepEqual(saved, savedBefore);
  assert.deepEqual(rawFeatures, rowBefore);
});

test('training-mean reference uses the saved standardizer and original raw coordinates', () => {
  const preprocessing = {
    kind: 'standardizer', version: 1, means: [10, 20], scales: [2, 4],
    constantColumns: [false, false], featureCount: 2, sampleCount: 2,
    scaleMethod: 'population-standard-deviation',
  };
  const saved = experiment({
    preprocessing,
    trainFeatures: [[8, 100, 16], [12, 120, 24]],
  });
  const result = explainLogisticRegression({ experiment: saved, features: [12, 999, 24] });
  assert.equal(result.baseline.kind, 'trainingMean');
  assert.deepEqual(result.baseline.rawSelectedFeatures, [10, 20]);
  assert.deepEqual(result.baseline.transformedFeatures, [0, 0]);
  assert.deepEqual(result.input.transformedFeatures, [1, 1]);
  assert.deepEqual(result.contributions.map(item => item.rawCoefficient), [1.5, -0.5]);
  assert.deepEqual(result.contributions.map(item => item.logitContribution), [3, -2]);
  assert.equal(result.prediction.logit, 6);
  assert.equal(result.baseline.logit, 5);
});

test('training-mean reference without preprocessing comes from retained training rows', () => {
  const saved = experiment({ trainFeatures: [[2, 10, 4], [4, 30, 8]] });
  const result = explainLogisticRegression({ experiment: saved, features: [4, 99, 8] });
  assert.deepEqual(result.baseline.rawSelectedFeatures, [3, 6]);
  assert.equal(result.baseline.logit, 2);
});

test('logistic reference probability threshold ties and stable extreme scores use the actual predictor', () => {
  const tie = experiment({ fitted: model({ coefficients: [0, 0], intercept: 0, threshold: 0.5 }) });
  const tied = explainLogisticRegression({ experiment: tie, features: [1, 0, 2] });
  assert.equal(tied.prediction.logit, 0);
  assert.equal(tied.prediction.probability, 0.5);
  assert.equal(tied.prediction.label, 1);

  for (const [score, probability] of [[1000, 1], [-1000, 0]]) {
    const extreme = experiment({ fitted: model({ coefficients: [0, 0], intercept: score }) });
    const explanation = explainLogisticRegression({ experiment: extreme, features: [0, 0, 0], baseline: 'zero' });
    assert.equal(explanation.prediction.logit, score);
    assert.equal(explanation.prediction.probability, probability);
    assert.ok(Number.isFinite(explanation.prediction.probability));
  }
});

test('counterfactual replacement reports actual changed predictions from the retained model', () => {
  const saved = experiment();
  const features = [4, 777, 7];
  const before = structuredClone(saved);
  const result = perturbLogisticRegression({ experiment: saved, features, changes: { first: 5 }, baseline: [1, -999, 3] });
  assert.equal(result.kind, 'logisticCounterfactual');
  assert.deepEqual(result.changes, [{ featureName: 'first', sourceIndex: 0, previousValue: 4, replacementValue: 5, delta: 1 }]);
  assert.equal(result.before.logit, 3);
  assert.equal(result.after.logit, 6);
  assert.equal(result.effect.logitDelta, 3);
  close(result.before.probability, 1 / (1 + Math.exp(-3)));
  close(result.after.probability, 1 / (1 + Math.exp(-6)));
  assert.equal(result.effect.labelChanged, false);
  assert.equal(result.beforeExplanation.prediction.logit, result.before.logit);
  assert.equal(result.afterExplanation.prediction.logit, result.after.logit);
  assert.deepEqual(saved, before);
  assert.deepEqual(features, [4, 777, 7]);
});

test('counterfactual applies raw replacements through the same retained scaler', () => {
  const preprocessing = {
    kind: 'standardizer', version: 1, means: [10, 20], scales: [2, 4],
    constantColumns: [false, false], featureCount: 2, sampleCount: 2,
    scaleMethod: 'population-standard-deviation',
  };
  const saved = experiment({ preprocessing, trainFeatures: [[8, 100, 16], [12, 120, 24]] });
  const before = structuredClone(saved);
  const result = perturbLogisticRegression({ experiment: saved, features: [12, 999, 24], changes: { first: 14 } });
  assert.equal(result.before.logit, 6);
  assert.equal(result.after.logit, 9);
  assert.equal(result.effect.logitDelta, 3);
  assert.deepEqual(result.afterExplanation.contributions.map(item => item.logitContribution), [6, -2]);
  assert.equal(result.beforeExplanation.baseline.logit, result.afterExplanation.baseline.logit);
  assert.deepEqual(saved, before);
});

test('counterfactual reports a real threshold crossing using the saved threshold rule', () => {
  const saved = experiment({ fitted: model({ coefficients: [3, 0], intercept: -1.5 }) });
  const result = perturbLogisticRegression({ experiment: saved, features: [0, 777, 3], changes: { first: 1 } });
  assert.equal(result.before.logit, -1.5);
  assert.equal(result.before.label, 0);
  assert.equal(result.after.logit, 1.5);
  assert.equal(result.after.label, 1);
  assert.equal(result.effect.labelChanged, true);
});

test('L2-regularized fitted coefficients are explained as prediction arithmetic only', () => {
  const fitted = fitLogisticRegression({
    features: [[-2], [-1], [1], [2]], targets: [0, 0, 1, 1],
    l2: 0.75, maxIterations: 400, tolerance: 1e-6,
  });
  assert.equal(fitted.optimizer.l2, 0.75);
  const saved = experiment({
    fitted, selectedIndices: [0], trainFeatures: [[-2, 100, 0], [-1, 100, 0], [1, 100, 0], [2, 100, 0]],
  });
  const result = explainLogisticRegression({ experiment: saved, features: [1.5, 999, 0] });
  assert.ok(Math.abs(result.reconstruction.residual) <= result.reconstruction.tolerance);
  assert.equal(result.prediction.label, result.prediction.probability >= fitted.threshold ? 1 : 0);
  assert.equal(result.trace.calls.some(call => call.sourceId.includes('objectiveParts')), false, 'inference explanation does not report training loss or add the L2 penalty');
});

test('explanations and counterfactuals reject malformed or unselected inputs without mutation', () => {
  const saved = experiment();
  const original = structuredClone(saved);
  assert.throws(() => explainLogisticRegression({ experiment: saved, features: [1, 2] }), /source|schema|feature/i);
  assert.throws(() => explainLogisticRegression({ experiment: saved, features: [1, Infinity, 3] }), /finite/i);
  assert.throws(() => explainLogisticRegression({ experiment: saved, features: [1, 2, 3], baseline: [1, 3] }), /source|length|schema/i);
  assert.throws(() => explainLogisticRegression({ experiment: saved, features: [1, 2, 3], baseline: 'unknown' }), /baseline/i);
  assert.throws(() => explainLogisticRegression({ experiment: saved, features: [1, 2, 3], baseline: null }), /baseline/i);
  assert.throws(() => perturbLogisticRegression({ experiment: saved, features: [1, 2, 3], changes: { ignored: 4 } }), /selected|feature/i);
  assert.throws(() => perturbLogisticRegression({ experiment: saved, features: [1, 2, 3], changes: { absent: 4 } }), /unknown|feature/i);
  assert.throws(() => perturbLogisticRegression({ experiment: saved, features: [1, 2, 3], changes: { first: Infinity } }), /finite/i);
  assert.throws(() => explainLogisticRegression({ experiment: { ...saved, config: { algorithm: 'kMeans' } }, features: [1, 2, 3] }), /logistic/i);
  const stale = structuredClone(saved);
  stale.dataset.records[0].target += 1;
  assert.throws(() => explainLogisticRegression({ experiment: stale, features: [1, 2, 3] }), /fingerprint|identity/i);
  assert.deepEqual(saved, original);
});

test('classification explanations reject numeric-heavy JSON during bounded traversal', () => {
  const saved = experiment();
  // This is only about 0.8 MB of numeric payload, but enough entries to exceed
  // the classifier explanation's explicit traversal budget.
  saved.unusedNumericPayload = new Array(100_000).fill(0);
  assert.throws(
    () => explainLogisticRegression({ experiment: saved, features: [1, 2, 3] }),
    /maximum JSON (node|entry)( or entry)? count|JSON (node|entry) budget/i,
  );
});

test('classification JSON byte budgets account for escaping and output before joining oversized strings', () => {
  const inputBudget = experiment();
  inputBudget.unusedEscapedText = '\0'.repeat(1_500_000);
  assert.throws(
    () => explainLogisticRegression({ experiment: inputBudget, features: [1, 2, 3] }),
    /explanation input exceeds .*byte budget/i,
  );

  const longName = 'x'.repeat(530_000);
  const outputBudget = experiment({
    fitted: model({ coefficients: [3], training: { sampleCount: 4, featureCount: 1, initialization: 'zeros' } }),
    selectedIndices: [0],
  });
  outputBudget.dataset.featureNames[0] = longName;
  outputBudget.selectedFeatures.sourceFeatureNames[0] = longName;
  outputBudget.selectedFeatures.names[0] = longName;
  outputBudget.config.featureNames[0] = longName;
  outputBudget.sourceIdentity.dataFingerprint = fingerprint(outputBudget.dataset);
  assert.throws(
    () => explainLogisticRegression({ experiment: outputBudget, features: [1, 2, 3] }),
    /explanation output exceeds/i,
  );
});

test('explanation identity and calculation traces are stable JSON copies with bounded bytes', () => {
  const saved = experiment();
  const input = { experiment: saved, features: [4, 777, 7], baseline: [1, -999, 3] };
  const first = explainLogisticRegression(input);
  const replay = explainLogisticRegression(structuredClone(input));
  assert.deepEqual(replay, first);
  assert.deepEqual(first.experimentIdentity.sourceIdentity, saved.sourceIdentity);
  assert.ok(first.trace.bytes <= 32_768);
  assert.equal(first.trace.bytes, new TextEncoder().encode(JSON.stringify(first.trace)).byteLength);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.trace.calls.some(call => call.sourceId.includes('sigmoid') && call.stage === 'contribution'), false);
  assert.deepEqual(new Set(first.trace.calls.map(call => call.sourceId)), new Set([
    'src/explain/regression.mjs#prepareExplanationFeatures',
    'src/ml/index.mjs#predictMLModel',
    'src/explain/classification.mjs#reconstructLogit',
  ]));
  first.experimentIdentity.sourceIdentity.dataFingerprint.hash = 'poison';
  first.contributions[0].featureName = 'poison';
  assert.equal(saved.sourceIdentity.dataFingerprint.hash, fingerprint(saved.dataset).hash);
  assert.equal(saved.selectedFeatures.names[0], 'first');
});
