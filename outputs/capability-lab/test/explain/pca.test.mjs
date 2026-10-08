import test from 'node:test';
import assert from 'node:assert/strict';
import { runMLExperiment, predictMLModel } from '../../src/ml/index.mjs';
import { explainPCA } from '../../src/explain/pca.mjs';

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function fixture(components = 1) {
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'explanation-fixture', featureNames: ['a', 'b', 'constant'],
    records: Array.from({ length: 12 }, (_, index) => {
      const x = index - 5.5;
      return { runId: `r${index}`, conditionId: `c${index}`, features: [2 * x, x, 7] };
    }),
  };
  return runMLExperiment({
    dataset, algorithm: 'pca', featureNames: ['b', 'a', 'constant'], testFraction: 1 / 3,
    seed: 19, standardize: true, modelConfig: { components },
  });
}

test('PCA explanation reconstructs the actual fitted score and preserves selected feature order', () => {
  const experiment = fixture();
  const raw = [18, 9, 7];
  const before = structuredClone({ experiment, raw });
  const explanation = explainPCA({ experiment, features: raw });
  assert.deepEqual(raw, before.raw);
  assert.deepEqual(experiment, before.experiment);
  assert.deepEqual(explanation.sourceIdentity.dataFingerprint, experiment.sourceIdentity.dataFingerprint);
  assert.deepEqual(explanation.selectedFeatures.map(feature => [feature.index, feature.name]), [[1, 'b'], [0, 'a'], [2, 'constant']]);
  assert.deepEqual(explanation.components[0].contributions.map(value => value.name), ['b', 'a', 'constant']);
  const reconstructed = explanation.components[0].contributions.reduce((sum, value) => sum + value.contribution, 0);
  close(reconstructed, explanation.components[0].score);
  const predicted = predictMLModel({ experiment, records: [{ runId: 'new', conditionId: 'new', features: raw }] }).projected[0][0];
  close(explanation.components[0].score, predicted);
  assert.ok(explanation.trace.calls.some(call => call.operationId === 'linalg.dot'));
  assert.equal(explanation.trace.bytes, new TextEncoder().encode(JSON.stringify(explanation.trace)).byteLength);
  assert.equal(explanation.selectedFeatures[2].scale, 1);
  assert.equal(explanation.selectedFeatures[2].modelValue, 0);
  assert.ok(explanation.components[0].rawLoadings.every(Number.isFinite));
});

test('PCA explanation includes only fitted components and adds no synthetic axis', () => {
  const experiment = fixture();
  const explanation = explainPCA({ experiment, features: [3, 1.5, 7] });
  assert.equal(explanation.components.length, 1);
  assert.equal(explanation.components[0].componentIndex, 0);
  assert.equal(explanation.components[0].eigenvalue, experiment.model.eigenvalues[0]);
  assert.equal(explanation.components[0].explainedVarianceRatio, experiment.model.explainedVarianceRatio[0]);
  assert.ok(explanation.caveats.some(value => /caus/i.test(value)));
});

test('PCA explanation preserves fitted zero-variance components and their zero ratios', () => {
  const experiment = fixture(3);
  const result = explainPCA({ experiment, features: [3, 1.5, 7] });
  assert.equal(result.components.length, 3);
  assert.deepEqual(result.components.map(value => value.explainedVarianceRatio), experiment.model.explainedVarianceRatio);
  assert.equal(result.components[1].eigenvalue, 0);
  assert.equal(result.components[1].explainedVarianceRatio, 0);
  assert.equal(result.components[2].eigenvalue, 0);
  assert.equal(result.components[2].explainedVarianceRatio, 0);
  assert.ok(result.components.every(component => component.contributions.length === 3));
});

test('PCA explanation rejects malformed vectors, mismatched algorithms, and malformed preprocessing', () => {
  const experiment = fixture();
  assert.throws(() => explainPCA({ experiment, features: [1, Infinity, 7] }), /finite/i);
  assert.throws(() => explainPCA({ experiment, features: [1, 2] }), /source|feature/i);
  assert.throws(() => explainPCA({ experiment: { ...experiment, config: { ...experiment.config, algorithm: 'kMeans' } }, features: [1, 2, 7] }), /algorithm/i);
  assert.throws(() => explainPCA({ experiment: { ...experiment, preprocessing: { ...experiment.preprocessing, scales: [1, 0, 1] } }, features: [1, 2, 7] }), /scale|positive/i);
});

test('PCA explanation output arrays do not alias fitted directions or feature metadata', () => {
  const experiment = fixture();
  const savedDirections = structuredClone(experiment.model.directions);
  const first = explainPCA({ experiment, features: [3, 1.5, 7] });
  first.components[0].directionModel[0] = 999;
  first.components[0].contributions[0].name = 'poison';
  first.components[0].rawLoadings[0] = 999;
  first.sourceIdentity.kind = 'poison';
  const second = explainPCA({ experiment, features: [3, 1.5, 7] });
  assert.deepEqual(experiment.model.directions, savedDirections);
  assert.notEqual(second.components[0].directionModel[0], 999);
  assert.equal(second.components[0].contributions[0].name, 'b');
  assert.equal(second.sourceIdentity.kind, 'explanation-fixture');
});

test('PCA explanation rejects overlong UTF-8 feature labels before repeated contribution output', () => {
  const experiment = fixture();
  const longName = '界'.repeat(86);
  experiment.dataset.featureNames[0] = longName;
  experiment.selectedFeatures.sourceFeatureNames[0] = longName;
  experiment.selectedFeatures.names[1] = longName;
  experiment.config.featureNames[1] = longName;
  assert.throws(() => explainPCA({ experiment, features: [3, 1.5, 7] }), /256 UTF-8 bytes/i);
});

test('PCA explanation rejects extra source fingerprint fields instead of dropping identity data', () => {
  const experiment = fixture();
  experiment.sourceIdentity.dataFingerprint.extra = 'unrecognized';
  assert.throws(() => explainPCA({ experiment, features: [3, 1.5, 7] }), /exactly algorithm|exactly .*bytes/i);
});

test('PCA output estimate counts JSON-escaped identifier bytes before building repeated entries', () => {
  const featureNames = Array.from({ length: 32 }, (_, index) => index === 0 ? '\u0001'.repeat(200) : `feature-${index}`);
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'escape-amplification-fixture', featureNames,
    records: Array.from({ length: 6 }, (_, row) => ({
      runId: `r${row}`, conditionId: `c${row}`,
      features: featureNames.map((_, column) => (row - 2.5) * (column + 1)),
    })),
  };
  const experiment = runMLExperiment({
    dataset, algorithm: 'pca', featureNames, testFraction: 1 / 3, seed: 4, standardize: false,
    modelConfig: { components: 32 },
  });
  const input = Array(32).fill(1);
  assert.throws(() => explainPCA({ experiment, features: input }), /estimated output .* exceeds 1048576 bytes/i);
});
