import test from 'node:test';
import assert from 'node:assert/strict';
import { runMLExperiment } from '../../src/ml/index.mjs';
import { explainKMeans } from '../../src/explain/clustering.mjs';

function makeExperiment(standardize = false) {
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'fixture', featureNames: ['x', 'y', 'constant'],
    records: [[0, 0, 7], [1, 0, 7], [3, 4, 7], [3, 5, 7]].map((features, index) => ({
      runId: `r${index}`, conditionId: `c${index}`, features,
    })),
  };
  const experiment = runMLExperiment({ dataset, algorithm: 'kMeans', featureNames: ['y', 'x'], testFraction: 0.25, seed: 1, standardize, modelConfig: { k: 2 } });
  experiment.model = {
    kind: 'kmeans', featureCount: 2, centroids: [[0, 0], [3, 4]], assignments: [0, 1], inertia: 0,
    iterations: 1, converged: true, seed: 1,
    config: { k: 2, maxIterations: 1, tolerance: 0, initialization: 'k-means++', tieBreak: 'lowest-index', emptyCluster: 'retain-previous-centroid' },
  };
  return experiment;
}

const experiment = makeExperiment();

test('k-means explanation reconstructs literal squared-distance terms and tie margin', () => {
  const features = [4, 3, 7];
  const before = structuredClone(features);
  const explanation = explainKMeans({ experiment, features });
  assert.deepEqual(features, before);
  assert.equal(explanation.sourceIdentity.dataFingerprint.hash, experiment.sourceIdentity.dataFingerprint.hash);
  assert.deepEqual(explanation.selectedFeatures.map(value => [value.index, value.name, value.rawValue]), [[1, 'y', 3], [0, 'x', 4]]);
  assert.deepEqual(explanation.centers[0].selectedCoordinates.map(value => value.squaredContribution), [9, 16]);
  assert.equal(explanation.centers[0].squaredDistance, 25);
  assert.equal(explanation.centers[0].distance, 5);
  assert.equal(explanation.prediction.clusterIndex, 1);
  assert.equal(explanation.prediction.nearestAlternativeIndex, 0);
  assert.equal(explanation.prediction.margin, 25);
  assert.equal(explanation.prediction.tieBreak, 'lowest-index');
  assert.ok(explanation.trace.calls.some(call => call.operationId === 'linalg.distance'));
  assert.equal(explanation.trace.bytes, new TextEncoder().encode(JSON.stringify(explanation.trace)).byteLength);
});

test('k-means explanation uses inverse scaler for center display and model-space distances', () => {
  const scaled = makeExperiment(true);
  const means = scaled.preprocessing.means, scales = scaled.preprocessing.scales;
  const raw = [means[1] + 4 * scales[1], means[0] + 3 * scales[0], 7];
  const result = explainKMeans({ experiment: scaled, features: raw });
  assert.deepEqual(result.selectedFeatures.map(value => value.modelValue), [3, 4]);
  assert.deepEqual(result.centers[1].centroidRaw, [means[0] + 3 * scales[0], means[1] + 4 * scales[1]]);
  assert.equal(result.distanceSpace, 'standardized-model-feature-units');
  assert.equal(result.centers[1].squaredDistance, 0);
});

test('k-means explanation rejects malformed raw schema and inconsistent saved models', () => {
  assert.throws(() => explainKMeans({ experiment, features: [4, Infinity, 7] }), /finite/i);
  assert.throws(() => explainKMeans({ experiment, features: [4, 3] }), /source|feature/i);
  assert.throws(() => explainKMeans({ experiment: { ...experiment, selectedFeatures: { ...experiment.selectedFeatures, names: ['x', 'y'], indices: [0, 0] }, config: { ...experiment.config, featureNames: ['x', 'y'] } }, features: [4, 3, 7] }), /unique|indices|selected/i);
});

test('k-means explanation output arrays do not alias fitted experiment data', () => {
  const savedCentroids = structuredClone(experiment.model.centroids);
  const first = explainKMeans({ experiment, features: [4, 3, 7] });
  first.centers[0].centroidModel[0] = 999;
  first.centers[0].selectedCoordinates[0].name = 'poison';
  first.selectedFeatures[0].name = 'poison';
  first.sourceIdentity.kind = 'poison';
  const second = explainKMeans({ experiment, features: [4, 3, 7] });
  assert.deepEqual(experiment.model.centroids, savedCentroids);
  assert.equal(second.centers[0].centroidModel[0], 0);
  assert.equal(second.centers[0].selectedCoordinates[0].name, 'y');
  assert.equal(second.sourceIdentity.kind, 'fixture');
});

test('k-means explanation follows exact distance ties and defines a missing alternative', () => {
  const tied = makeExperiment();
  tied.model.centroids = [[0, 0], [6, 8]];
  const result = explainKMeans({ experiment: tied, features: [4, 3, 7] });
  assert.equal(result.prediction.clusterIndex, 0);
  assert.equal(result.prediction.exactDistanceTie, true);
  assert.equal(result.prediction.margin, 0);

  const single = makeExperiment();
  single.model.centroids = [[0, 0]];
  single.model.assignments = [0];
  single.model.config.k = 1;
  const only = explainKMeans({ experiment: single, features: [4, 3, 7] });
  assert.equal(only.prediction.nearestAlternativeIndex, null);
  assert.equal(only.prediction.margin, null);
});

test('k-means explanation rejects overlong UTF-8 feature and source identity labels before expansion', () => {
  const longName = 'é'.repeat(129);
  const featureLabel = makeExperiment();
  featureLabel.dataset.featureNames[0] = longName;
  featureLabel.selectedFeatures.sourceFeatureNames[0] = longName;
  featureLabel.selectedFeatures.names[1] = longName;
  featureLabel.config.featureNames[1] = longName;
  assert.throws(() => explainKMeans({ experiment: featureLabel, features: [4, 3, 7] }), /256 UTF-8 bytes/i);

  const sourceLabel = makeExperiment();
  sourceLabel.sourceIdentity.kind = 's'.repeat(257);
  assert.throws(() => explainKMeans({ experiment: sourceLabel, features: [4, 3, 7] }), /256 UTF-8 bytes/i);

  const extendedIdentity = makeExperiment();
  extendedIdentity.sourceIdentity.extraMetadata = 'must not be silently dropped';
  assert.throws(() => explainKMeans({ experiment: extendedIdentity, features: [4, 3, 7] }), /exactly kind|exactly .*dataFingerprint/i);
});
