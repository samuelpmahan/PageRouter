import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPCA, transformPCA } from '../../src/ml/pca.mjs';
import { fitKMeans, predictKMeans } from '../../src/ml/clustering.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};

test('independent tilted-line PCA fixture matches analytic covariance and score variance', () => {
  const features = [[-6,-3],[-2,-1],[2,1],[6,3]];
  const before = structuredClone(features);
  const model = fitPCA({ features, components: 2 });
  assert.deepEqual(features, before);
  close(model.means[0], 0);
  close(model.means[1], 0);
  close(model.eigenvalues[0], 100 / 3);
  close(model.eigenvalues[1], 0);
  close(model.explainedVarianceRatio[0], 1);
  close(model.explainedVarianceRatio[1], 0);
  close(model.directions[0][0], 2 / Math.sqrt(5));
  close(model.directions[0][1], 1 / Math.sqrt(5));
  close(model.directions[1][0], -1 / Math.sqrt(5));
  close(model.directions[1][1], 2 / Math.sqrt(5));

  const projected = transformPCA({ model, features }).projected;
  for (let component = 0; component < 2; component += 1) {
    const mean = projected.reduce((sum, row) => sum + row[component], 0) / projected.length;
    const sampleVariance = projected.reduce((sum, row) => sum + (row[component] - mean) ** 2, 0) / (projected.length - 1);
    close(sampleVariance, model.eigenvalues[component]);
  }
  const crossProduct = projected.reduce((sum, row) => sum + row[0] * row[1], 0) / (projected.length - 1);
  close(crossProduct, 0);
});

test('PCA holdout projection uses retained training mean, not holdout statistics', () => {
  const model = fitPCA({ features: [[0, 0], [2, 0], [4, 0]], components: 1 });
  const before = structuredClone(model);
  const projected = transformPCA({ model, features: [[100, 7], [102, 9]] }).projected;
  close(projected[0][0], 98);
  close(projected[1][0], 100);
  assert.deepEqual(model, before);
});

test('independent two-group k-means fixture matches literal centroids, assignments, and distances', () => {
  const features = [[0], [2], [10], [12]];
  const before = structuredClone(features);
  const model = fitKMeans({ features, k: 2, seed: 41 });
  assert.deepEqual(features, before);
  assert.deepEqual(model.centroids, [[11], [1]]);
  assert.deepEqual(model.assignments, [1, 1, 0, 0]);
  close(model.inertia, 4);

  const predicted = predictKMeans({ model, features: [[1], [6], [13]] });
  assert.deepEqual(predicted.assignments, [1, 0, 0]);
  assert.deepEqual(predicted.distances, [0, 5, 2]);
  assert.deepEqual(predicted.squaredDistances, [0, 25, 4]);
});
