import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import { capabilities as linalgCapabilities } from '../../src/linalg/index.mjs';
import { capabilities as statisticsCapabilities } from '../../src/statistics/index.mjs';
import { fitKMeans, fitKMeansWithTrace, predictKMeans, clusteringCapabilities } from '../../src/ml/clustering.mjs';

const registry = () => createRegistry(
  [...statisticsCapabilities, ...linalgCapabilities, ...clusteringCapabilities],
  { source: 'ml-kmeans-tests', version: '1' },
);

function flattenCalls(calls, into = []) {
  for (const call of calls) {
    into.push(call.id);
    flattenCalls(call.calls ?? [], into);
  }
  return into;
}

test('one-cluster fit matches an independent centroid and squared-distance fixture', () => {
  const features = [[0, 2], [2, 4], [4, 6]];
  const before = structuredClone(features);
  const model = fitKMeans({ features, k: 1, seed: 5 });
  assert.equal(model.kind, 'kmeans');
  assert.equal(model.featureCount, 2);
  assert.deepEqual(model.centroids, [[2, 4]]);
  assert.deepEqual(model.assignments, [0, 0, 0]);
  assert.equal(model.inertia, 16);
  assert.equal(model.converged, true);
  assert.equal(model.seed, 5);
  assert.deepEqual(features, before);
});

test('seeded k-means++ fit is deterministic and changed data changes learned centroids', () => {
  const features = [[0, 0], [0, 2], [10, 10], [10, 12]];
  const first = fitKMeans({ features, k: 2, seed: 41 });
  const replay = fitKMeans({ features: structuredClone(features), k: 2, seed: 41 });
  assert.deepEqual(replay, first);
  assert.equal(first.config.initialization, 'k-means++');
  assert.equal(first.config.tieBreak, 'lowest-index');
  assert.equal(first.config.emptyCluster, 'retain-previous-centroid');
  const shifted = fitKMeans({ features: features.map(row => row.map(value => value + 100)), k: 2, seed: 41 });
  assert.deepEqual(shifted.centroids, first.centroids.map(row => row.map(value => value + 100)));
});

test('prediction returns Euclidean and squared distances and breaks ties by lowest cluster index', () => {
  const model = {
    kind: 'kmeans',
    featureCount: 1,
    centroids: [[0], [2]],
    assignments: [0, 0],
    inertia: 0,
    iterations: 1,
    converged: true,
    seed: 1,
    config: {
      k: 2,
      maxIterations: 100,
      tolerance: 1e-6,
      initialization: 'k-means++',
      tieBreak: 'lowest-index',
      emptyCluster: 'retain-previous-centroid',
    },
  };
  assert.deepEqual(predictKMeans({ model, features: [[1], [3]] }), {
    assignments: [0, 1],
    distances: [1, 1],
    squaredDistances: [1, 1],
  });
});

test('empty clusters retain their previous centers under the declared policy', () => {
  const model = fitKMeans({ features: [[5, 5], [5, 5], [5, 5]], k: 2, seed: 7 });
  assert.deepEqual(model.centroids, [[5, 5], [5, 5]]);
  assert.deepEqual(model.assignments, [0, 0, 0]);
  assert.equal(model.config.emptyCluster, 'retain-previous-centroid');
  assert.equal(model.converged, true);
});

test('reaching maxIterations returns an honest nonconverged model', () => {
  const model = fitKMeans({ features: [[0], [2], [10], [12]], k: 1, seed: 0, maxIterations: 1, tolerance: 0 });
  assert.equal(model.iterations, 1);
  assert.equal(model.converged, false);
  assert.deepEqual(model.centroids, [[6]]);
});

test('k-means rejects invalid shapes, non-finite features, seeds, and unbounded workloads', () => {
  assert.throws(() => fitKMeans({ features: [[1], [2]], k: 1 }), /seed/i);
  assert.throws(() => fitKMeans({ features: [[1], [2]], k: 0, seed: 1 }), /k/i);
  assert.throws(() => fitKMeans({ features: [[1], [2]], k: 3, seed: 1 }), /k|sample/i);
  assert.throws(() => fitKMeans({ features: [[1], [2, 3]], k: 1, seed: 1 }), /rectangular|feature/i);
  assert.throws(() => fitKMeans({ features: [[1], [Infinity]], k: 1, seed: 1 }), /finite/i);
  assert.throws(() => fitKMeans({ features: [[1], [2]], k: 1, seed: -1 }), /seed/i);
  const many = Array.from({ length: 180 }, (_, index) => [index, index % 7]);
  assert.throws(() => fitKMeans({ features: many, k: 8, seed: 1, maxIterations: 100 }), /work|trace|bound/i);
  assert.throws(() => predictKMeans({ model: { kind: 'kmeans', featureCount: 1, centroids: [[0]] }, features: [[0, 1]] }), /feature count|dimension|model/i);
});

test('k-means descriptors call declared distance and mean capabilities', () => {
  const run = registry();
  const fit = run.execute('ml.fitKMeans', { features: [[0, 2], [2, 4], [4, 6]], k: 1, seed: 5 });
  const calls = flattenCalls(fit.trace.calls);
  assert.ok(calls.includes('linalg.distance'));
  assert.ok(calls.includes('statistics.mean'));
  assert.deepEqual(fit.result, fitKMeans({ features: [[0, 2], [2, 4], [4, 6]], k: 1, seed: 5 }));
  const prediction = run.execute('ml.predictKMeans', { model: fit.result, features: [[3, 4]] });
  assert.ok(flattenCalls(prediction.trace.calls).includes('linalg.distance'));
  assert.deepEqual(prediction.result.assignments, [0]);
});

test('k-means trainer trace records real distance and mean summaries without retaining rows', () => {
  const features = [[0, 2], [2, 4], [4, 6]];
  const { model, trace } = fitKMeansWithTrace({ features, k: 1, seed: 5 });
  assert.deepEqual(model, fitKMeans({ features, k: 1, seed: 5 }));
  assert.equal(trace.schema, 'ml.training-trace.v1');
  assert.ok(trace.bytes <= 32_768);
  assert.ok(trace.calls.some(call => call.id === 'linalg.distance' && call.stage === 'assignment'));
  assert.ok(trace.calls.some(call => call.id === 'statistics.mean' && call.stage === 'centroid-coordinate-mean'));
  assert.equal(trace.bytes, new TextEncoder().encode(JSON.stringify(trace)).byteLength);
  assert.ok(trace.iterations.every(item => Number.isFinite(item.maximumMovement) && Number.isSafeInteger(item.emptyClusterCount)));
  assert.deepEqual(JSON.parse(JSON.stringify(trace)), trace);
  assert.equal(JSON.stringify(trace).includes('features'), false, 'training rows are not copied into the trace');
});

test('k-means rejects sparse feature rows and inconsistent centroid models', () => {
  const sparse = [1, 2];
  delete sparse[1];
  assert.throws(() => fitKMeans({ features: [[0, 0], sparse], k: 1, seed: 1 }), /missing/i);
  const model = fitKMeans({ features: [[0], [2]], k: 1, seed: 4 });
  assert.throws(() => predictKMeans({ model: { ...model, assignments: [1, 1] }, features: [[1]] }), /assignments/i);
});
