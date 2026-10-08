import test from 'node:test';
import assert from 'node:assert/strict';
import { runMLExperiment, predictMLModel } from '../../src/ml/index.mjs';
import { explainKMeans } from '../../src/explain/clustering.mjs';
import { explainPCA } from '../../src/explain/pca.mjs';
import { explainLogisticRegression, perturbLogisticRegression } from '../../src/explain/classification.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};

function experimentFor(algorithm, standardize = false) {
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: `independent-${algorithm}`, featureNames: ['x', 'y', 'constant'],
    records: Array.from({ length: 8 }, (_, index) => {
      const x = index - 3.5;
      return { runId: `run-${index}`, conditionId: `condition-${index}`, features: [2 * x, x, 7] };
    }),
  };
  return runMLExperiment({
    dataset, algorithm, featureNames: algorithm === 'pca' ? ['y', 'x', 'constant'] : ['y', 'x'], testFraction: 0.25, seed: 11, standardize,
    modelConfig: algorithm === 'pca' ? { components: 1 } : { k: 2 },
  });
}

test('independent k-means coordinate arithmetic yields literal 9+16=25 and distance 5', () => {
  const experiment = experimentFor('kMeans');
  experiment.model = {
    ...experiment.model,
    centroids: [[0, 0], [3, 4]], assignments: [0, 1], inertia: 0,
    iterations: 1, converged: true,
    config: { ...experiment.model.config, maxIterations: 1, tolerance: 0 },
  };
  const result = explainKMeans({ experiment, features: [4, 3, 7] });
  assert.equal(result.prediction.clusterIndex, 1);
  assert.deepEqual(result.centers[0].selectedCoordinates.map(item => item.squaredContribution), [9, 16]);
  assert.equal(result.centers[0].squaredDistance, 25);
  assert.equal(result.centers[0].distance, 5);
  assert.equal(result.prediction.margin, 25);
});

test('independent PCA contribution sum matches the retained one-component predictor', () => {
  const experiment = experimentFor('pca', true);
  const raw = [18, 9, 7];
  const output = explainPCA({ experiment, features: raw });
  const selected = [raw[1], raw[0], raw[2]];
  const modelInput = selected.map((value, index) => (value - experiment.preprocessing.means[index]) / experiment.preprocessing.scales[index]);
  const component = experiment.model.directions[0];
  const expectedScore = modelInput.reduce((sum, value, index) => sum + (value - experiment.model.means[index]) * component[index], 0);
  const actualScore = predictMLModel({ experiment, records: [{ runId: 'new', conditionId: 'new', features: raw }] }).projected[0][0];
  close(output.components[0].contributions.reduce((sum, item) => sum + item.contribution, 0), expectedScore);
  close(output.components[0].score, actualScore);
  assert.equal(output.selectedFeatures[0].index, 1, 'selected source ordering is retained');
  assert.equal(output.selectedFeatures[2].name, 'constant');
  assert.equal(output.selectedFeatures[2].modelValue, 0);
  assert.equal(output.components.length, 1, 'only the component retained by the saved model is explained');
});

test('independent logistic fixture reconstructs logit and raw replacement perturbation', () => {
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'independent-logistic', featureNames: ['first', 'ignored', 'second'], targetName: 'label',
    records: Array.from({ length: 6 }, (_, index) => ({
      runId: `lr-${index}`, conditionId: `lc-${index}`, features: [index, 100 + index, 2 * index], target: index % 2,
    })),
  };
  const experiment = runMLExperiment({ dataset, algorithm: 'logisticRegression', featureNames: ['first', 'second'], testFraction: 1 / 3, seed: 2, standardize: false });
  experiment.model.coefficients = [3, -2];
  experiment.model.intercept = 5;
  experiment.model.threshold = 0.5;
  const input = [4, 777, 7];
  const baseline = [1, -999, 3];
  const saved = structuredClone(experiment);
  const explanation = explainLogisticRegression({ experiment, features: input, baseline });
  const independentScore = experiment.model.intercept + 3 * input[0] - 2 * input[2];
  const independentBaseline = experiment.model.intercept + 3 * baseline[0] - 2 * baseline[2];
  assert.equal(independentScore, 3);
  assert.equal(independentBaseline, 2);
  assert.equal(explanation.prediction.logit, independentScore);
  assert.deepEqual(explanation.contributions.map(value => value.logitContribution), [9, -8]);
  close(explanation.reconstruction.reconstructedLogit, independentScore);
  close(explanation.prediction.probability, 1 / (1 + Math.exp(-independentScore)));

  const changed = perturbLogisticRegression({ experiment, features: input, changes: { first: 5 }, baseline });
  assert.equal(changed.before.logit, independentScore);
  assert.equal(changed.after.logit, 6);
  assert.equal(changed.effect.logitDelta, 3);
  assert.deepEqual(experiment.model, saved.model);
  assert.deepEqual(input, [4, 777, 7]);
});
