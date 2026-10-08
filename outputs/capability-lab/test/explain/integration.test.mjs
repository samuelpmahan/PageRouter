import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExplanationContext,
  checkExplanationClaims,
  explainPrediction,
  perturbPrediction,
} from '../../src/explain/index.mjs';
import { runMLExperiment } from '../../src/ml/index.mjs';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};

function regressionExperiment() {
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'independent-model-fixture',
    featureNames: ['signal', 'context'], targetName: 'target',
    records: Array.from({ length: 12 }, (_, index) => {
      const signal = index - 5;
      return {
        runId: `reg-run-${index}`, conditionId: `reg-condition-${index}`,
        features: [signal, 100 + index], target: 5 + 3 * signal,
      };
    }),
  };
  return runMLExperiment({
    dataset, algorithm: 'linearRegression', featureNames: ['signal'],
    testFraction: 1 / 3, seed: 4, standardize: false,
  });
}

function cloudDataset() {
  return {
    schema: 'ml-dataset.v1', sourceKind: 'two-cluster-fixture',
    featureNames: ['x', 'y'],
    records: Array.from({ length: 12 }, (_, index) => {
      const local = index % 6;
      const offset = index < 6 ? 0 : 10;
      return {
        runId: `cloud-run-${index}`, conditionId: `cloud-condition-${index}`,
        features: [offset + local % 3, offset + Math.floor(local / 3)],
      };
    }),
  };
}

function predictionClaim(context) {
  const item = context.evidence.find(entry => entry.permittedScopes.includes('model.prediction'));
  assert.ok(item);
  return {
    contextId: context.contextId,
    stateIdentity: context.stateIdentity,
    modelIdentity: context.modelIdentity,
    claims: [{
      evidenceId: item.id,
      value: item.value,
      unit: item.unit,
      kind: item.kind,
      scope: 'model.prediction',
      citationIds: item.citationIds,
    }],
  };
}

test('wrapper explanation matches the retained linear predictor and raw-unit counterfactual', () => {
  const experiment = regressionExperiment();
  const originalArtifact = structuredClone(experiment);
  const features = [4, 7];
  const explanation = explainPrediction({ experiment, features });

  assert.equal(explanation.algorithm, 'linearRegression');
  assert.deepEqual(explanation.features, features);
  close(explanation.prediction.predictions[0], 17);
  close(explanation.attribution.prediction, explanation.prediction.predictions[0]);
  assert.equal(explanation.verification.matchesNativePrediction, true);
  assert.ok(explanation.calculationTrace.calls.some(call => call.id === 'src/ml/index.mjs#replayMLExperiment' && call.result.exactCanonicalMatch));
  assert.ok(explanation.calculationTrace.calls.some(call => call.id === 'src/ml/index.mjs#predictMLModel'));
  assert.ok(explanation.calculationTrace.calls.some(call => call.id.endsWith('#explainLinearRegression')));

  const perturbation = perturbPrediction({
    experiment, features, changes: { signal: 1, context: 5 },
  });
  close(perturbation.originalPrediction.predictions[0], 17);
  close(perturbation.changedPrediction.predictions[0], 20);
  close(perturbation.predictionDelta, 3);
  assert.deepEqual(perturbation.changedFeatures, [5, 12]);
  assert.deepEqual(perturbation.changes.map(change => change.selected), [true, false]);
  assert.equal(perturbation.modelUnchanged, true);
  assert.equal(perturbation.preprocessingRefit, false);
  assert.deepEqual(experiment, originalArtifact);
});

test('wrapper explanation follows retained logistic score, sigmoid probability, and threshold after a raw delta', () => {
  const dataset = {
    schema: 'ml-dataset.v1', sourceKind: 'binary-fixture',
    featureNames: ['signal', 'context'], targetName: 'classLabel',
    records: Array.from({ length: 20 }, (_, index) => ({
      runId: `class-run-${index}`, conditionId: `class-condition-${index}`,
      features: [index - 10, index * 2], target: index >= 10 ? 1 : 0,
    })),
  };
  const experiment = runMLExperiment({
    dataset, algorithm: 'logisticRegression', featureNames: ['signal'],
    testFraction: 0.2, seed: 3, standardize: false,
    modelConfig: { learningRate: 0.2, maxIterations: 2_000, tolerance: 1e-8 },
  });
  const explanation = explainPrediction({ experiment, features: [2, 40] });
  assert.equal(explanation.verification.matchesNativePrediction, true);
  close(explanation.attribution.prediction.logit, explanation.prediction.scores[0]);
  close(explanation.attribution.prediction.probability, explanation.prediction.probabilities[0]);
  assert.equal(explanation.attribution.prediction.label, explanation.prediction.labels[0]);

  const changed = perturbPrediction({ experiment, features: [2, 40], changes: { signal: -20 } });
  close(changed.originalPrediction.scores[0], explanation.prediction.scores[0]);
  assert.notEqual(changed.changedPrediction.probabilities[0], changed.originalPrediction.probabilities[0]);
  assert.equal(changed.modelUnchanged, true);
  assert.ok(changed.calculationTrace.bytes < 64 * 1024);
});

test('k-means and PCA wrapper outputs verify against actual retained prediction APIs', () => {
  const dataset = cloudDataset();
  const common = { dataset, featureNames: ['x', 'y'], testFraction: 1 / 3, seed: 9, standardize: false };
  const clusters = runMLExperiment({ ...common, algorithm: 'kMeans', modelConfig: { k: 2, maxIterations: 100, tolerance: 1e-12 } });
  const cluster = explainPrediction({ experiment: clusters, features: [100, 50] });
  assert.equal(cluster.verification.matchesNativePrediction, true);
  assert.ok(cluster.attribution.prediction.distanceReconstruction.withinTolerance);
  assert.ok(cluster.calculationTrace.calls.some(call => call.id.endsWith('#predictMLModel')));

  const pca = runMLExperiment({ ...common, algorithm: 'pca', modelConfig: { components: 1 } });
  const projection = explainPrediction({ experiment: pca, features: [100, 50] });
  assert.equal(projection.verification.matchesNativePrediction, true);
  assert.equal(projection.attribution.components.length, 1);
  assert.ok(projection.attribution.components[0].reconstruction.withinTolerance);
  assert.ok(projection.calculationTrace.calls.some(call => call.id.endsWith('#predictMLModel')));
});

test('high-level retrieved claims are matched to current replayed artifact identity', () => {
  const experiment = regressionExperiment();
  const features = [4, 7];
  const context = buildExplanationContext({ experiment, features });
  const draft = predictionClaim(context);
  const accepted = checkExplanationClaims({ context, draft, current: { experiment, features } });
  assert.equal(accepted.accepted, true);
  assert.match(accepted.renderedText, /native model prediction/i);

  const unsupportedText = { ...draft, text: 'The model proves this feature causes the outcome.' };
  assert.equal(checkExplanationClaims({ context, draft: unsupportedText, current: { experiment, features } }).accepted, false);

  const changedArtifact = structuredClone(experiment);
  changedArtifact.model.coefficients[0] += 0.25;
  const stale = checkExplanationClaims({ context, draft, current: { experiment: changedArtifact, features } });
  assert.equal(stale.accepted, false);
  assert.match(JSON.stringify(stale.errors), /could not be regenerated|replay|stale/i);
});
