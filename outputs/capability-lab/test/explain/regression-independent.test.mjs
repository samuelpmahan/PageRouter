import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceContext, checkExplanationClaims } from '../../src/explain/grounding.mjs';
import { buildWatchCalibrationDataset } from '../../src/ml/watch-data.mjs';

test('independent two-feature linear hand fixture reconstructs baseline, contributions, prediction, and perturbation', () => {
  const fittedModel = { intercept: 5, coefficients: [3, -2], selectedFeatures: ['x', 'y'], scaler: { means: [0, 0], scales: [1, 1] } };
  const before = structuredClone(fittedModel);
  const inputFeatures = [4, 7];
  const referenceFeatures = [1, 3];
  const baseline = fittedModel.intercept + fittedModel.coefficients[0] * referenceFeatures[0] + fittedModel.coefficients[1] * referenceFeatures[1];
  const contributions = fittedModel.coefficients.map((coefficient, index) => coefficient * (inputFeatures[index] - referenceFeatures[index]));
  const prediction = baseline + contributions.reduce((sum, contribution) => sum + contribution, 0);
  const changedFeatures = [5, 7];
  const changedPrediction = fittedModel.intercept + fittedModel.coefficients[0] * changedFeatures[0] + fittedModel.coefficients[1] * changedFeatures[1];
  assert.equal(baseline, 2);
  assert.deepEqual(contributions, [9, -8]);
  assert.equal(prediction, 3);
  assert.equal(changedPrediction, 6);

  const modelSource = { id: 'fitted-model', url: null, title: 'Retained fitted ML artifact', scope: 'model arithmetic', identity: 'ml-model:fixture' };
  const evidence = [
    { id: 'baseline', value: { kind: 'explicit', featureValues: referenceFeatures, prediction: baseline }, unit: 'model units', kind: 'derived', permittedScopes: ['model.baseline'], citationIds: ['fitted-model'] },
    { id: 'feature-effects', value: contributions, unit: 'model units', kind: 'derived', permittedScopes: ['model.contribution'], citationIds: ['fitted-model'] },
    { id: 'prediction', value: prediction, unit: 'model units', kind: 'derived', permittedScopes: ['model.prediction'], citationIds: ['fitted-model'] },
    { id: 'one-unit-change', value: { originalFeatures: inputFeatures, changedFeatures, originalPrediction: prediction, changedPrediction, predictionDelta: changedPrediction - prediction }, unit: 'model units', kind: 'derived', permittedScopes: ['model.perturbation'], citationIds: ['fitted-model'] },
  ];
  const context = buildEvidenceContext({ contextId: 'linear-fixture', stateIdentity: 'data:fixture', modelIdentity: 'ml-model:fixture', sourceKind: 'model-derived', sources: [modelSource], evidence });
  const claims = evidence.map(item => ({ evidenceId: item.id, value: item.value, unit: item.unit, kind: item.kind, scope: item.permittedScopes[0], citationIds: item.citationIds }));
  const result = checkExplanationClaims({ context, draft: { contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity, claims } });
  assert.equal(result.accepted, true);
  assert.equal(result.claims[0].value.prediction + result.claims[1].value.reduce((sum, effect) => sum + effect, 0), result.claims[2].value);
  assert.equal(result.claims[3].value.changedPrediction - result.claims[3].value.originalPrediction, 3);
  assert.deepEqual(fittedModel, before, 'using the checked explanation does not mutate retained model parameters');
});

test('retained standardization and reordered selected indices explain raw-unit effects without refitting', () => {
  const experiment = {
    schema: 'ml-experiment.v1', sourceIdentity: 'dataset:retained-standardized-fixture',
    sourceFeatureNames: ['irrelevant', 'x2', 'x1'], selectedFeatures: [2, 1],
    preprocessing: { means: [0, 0], scales: [0.25, 0.5] },
    model: { kind: 'linearRegression', intercept: 5, coefficients: [0.75, -1] },
  };
  const raw = [99, 7, 4];
  const reference = [77, 3, 1];
  const beforeExperiment = structuredClone(experiment);
  const beforeRaw = [...raw];
  const selectedIndices = experiment.selectedFeatures;
  const selectedRaw = selectedIndices.map(index => raw[index]);
  const selectedReference = selectedIndices.map(index => reference[index]);
  const modelValues = selectedRaw.map((value, index) => (value - experiment.preprocessing.means[index]) / experiment.preprocessing.scales[index]);
  const modelReference = selectedReference.map((value, index) => (value - experiment.preprocessing.means[index]) / experiment.preprocessing.scales[index]);
  const rawCoefficients = experiment.model.coefficients.map((coefficient, index) => coefficient / experiment.preprocessing.scales[index]);
  assert.deepEqual(selectedRaw, [4, 7], 'selected source order is x1 then x2 despite the source schema order');
  assert.deepEqual(modelValues, [16, 14]);
  assert.deepEqual(rawCoefficients, [3, -2]);
  const baseline = experiment.model.intercept + experiment.model.coefficients.reduce((sum, coefficient, index) => sum + coefficient * modelReference[index], 0);
  const contributions = experiment.model.coefficients.map((coefficient, index) => coefficient * (modelValues[index] - modelReference[index]));
  const prediction = experiment.model.intercept + experiment.model.coefficients.reduce((sum, coefficient, index) => sum + coefficient * modelValues[index], 0);
  const changedRaw = [...raw];
  changedRaw[2] += 1;
  const changedSelected = selectedIndices.map(index => changedRaw[index]);
  const changedModelValues = changedSelected.map((value, index) => (value - experiment.preprocessing.means[index]) / experiment.preprocessing.scales[index]);
  const changedPrediction = experiment.model.intercept + experiment.model.coefficients.reduce((sum, coefficient, index) => sum + coefficient * changedModelValues[index], 0);
  const nonselectedChanged = [1_000, raw[1], raw[2]];
  const nonselectedModelValues = selectedIndices.map((index, position) => (nonselectedChanged[index] - experiment.preprocessing.means[position]) / experiment.preprocessing.scales[position]);
  const nonselectedPrediction = experiment.model.intercept + experiment.model.coefficients.reduce((sum, coefficient, index) => sum + coefficient * nonselectedModelValues[index], 0);
  assert.equal(baseline, 2);
  assert.deepEqual(contributions, [9, -8]);
  assert.equal(prediction, 3);
  assert.equal(changedPrediction, 6);
  assert.equal(prediction + 3, changedPrediction);
  assert.equal(nonselectedPrediction, prediction, 'changing unselected feature leaves prediction unchanged');
  assert.deepEqual(experiment, beforeExperiment, 'explanation and perturbation use retained fitted parameters without mutation');
  assert.deepEqual(raw, beforeRaw);
});

test('fractional early oscillator phase reconstructs the retained observed rate, not the floored beat count', () => {
  const dataset = buildWatchCalibrationDataset({ conditions: [
    { conditionId: 'rate-3.75', mechanicalHz: { numerator: 15, denominator: 4 } },
    { conditionId: 'rate-3.8', mechanicalHz: { numerator: 19, denominator: 5 } },
    { conditionId: 'rate-4', mechanicalHz: 4 },
    { conditionId: 'rate-4.1', mechanicalHz: { numerator: 41, denominator: 10 } },
  ] });
  const row = dataset.records[0];
  const exactFraction = row.observations.earlyMechanicalCycles.numerator /
    (row.observations.earlyMechanicalCycles.denominator * 2 * row.observations.earlyOperatingTime.numerator);
  assert.deepEqual(row.observations.earlyMechanicalCycles, { numerator: 75, denominator: 2 });
  assert.equal(row.observations.earlyObservationWindowSeconds.numerator, 5);
  assert.equal(row.observations.formula, 'earlyMechanicalCycles/(2*earlyOperatingTime)');
  assert.equal(row.observations.readoutKind, 'synthetic-teaching-phase-observation');
  assert.equal(exactFraction, 3.75);
  assert.equal(row.features[0], exactFraction);
  assert.equal(row.observations.earlyMechanicalBeats / (2 * 5), 3.7, 'floored count would lose the retained fractional phase');

  const context = buildEvidenceContext({
    contextId: 'calibration-run', stateIdentity: 'dataset:synthetic-watch-v1', modelIdentity: 'dataset:synthetic-watch-v1',
    sourceKind: 'synthetic-watch',
    sources: [{ id: 'dataset:synthetic-watch', url: null, title: 'Synthetic watch calibration rows', scope: 'dataset lineage', identity: 'dataset:synthetic-watch-v1' }],
    evidence: [{
      id: 'early-observed-rate', value: row.features[0], unit: 'Hz', kind: 'derived',
      permittedScopes: ['watch.syntheticObservation'], citationIds: ['dataset:synthetic-watch'],
      stateIdentity: 'dataset:synthetic-watch-v1',
    }],
  });
  const valid = checkExplanationClaims({ context, draft: {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: 'early-observed-rate', value: 3.75, unit: 'Hz', kind: 'derived', scope: 'watch.syntheticObservation', citationIds: ['dataset:synthetic-watch'] }],
  } });
  assert.equal(valid.accepted, true);
  assert.match(valid.renderedText, /3\.75 Hz/);
  const falseFloor = checkExplanationClaims({ context, draft: {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: 'early-observed-rate', value: 3.7, unit: 'Hz', kind: 'derived', scope: 'watch.syntheticObservation', citationIds: ['dataset:synthetic-watch'] }],
  } });
  assert.equal(falseFloor.accepted, false);
  assert.equal(falseFloor.errors[0].code, 'wrong-value');
});

test('future horizon fields cannot be promoted into accepted feature claims by their names alone', () => {
  const dataset = buildWatchCalibrationDataset({ conditions: [
    { conditionId: 'rate-a', mechanicalHz: { numerator: 19, denominator: 5 } }, { conditionId: 'rate-b', mechanicalHz: { numerator: 39, denominator: 10 } },
    { conditionId: 'rate-c', mechanicalHz: 4 }, { conditionId: 'rate-d', mechanicalHz: { numerator: 41, denominator: 10 } },
  ] });
  const row = dataset.records[0];
  for (const key of ['horizonMechanicalBeats', 'horizonOperatingTime', 'horizonDisplayTime']) assert.ok(key in row.observations);
  // Contexts accept only explicit evidence; attaching a future observation as a claim requires
  // a caller to manufacture new evidence and cannot make its arbitrary prose verified.
  const context = buildEvidenceContext({
    contextId: 'future-probe', stateIdentity: 'future-state', modelIdentity: 'future-model', sourceKind: 'synthetic-watch',
    sources: [{ id: 'dataset-lineage', url: null, title: 'Synthetic watch calibration rows', scope: 'dataset lineage', identity: 'future-state' }],
    evidence: [{ id: 'early-rate', value: row.features[0], unit: 'Hz', kind: 'derived', permittedScopes: ['watch.syntheticObservation'], citationIds: ['dataset-lineage'] }],
  });
  const futureDraft = {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: 'horizonDisplayTime', value: row.observations.horizonDisplayTime, unit: 'seconds', kind: 'fact', scope: 'watch.syntheticObservation', citationIds: ['dataset-lineage'] }],
  };
  assert.equal(checkExplanationClaims({ context, draft: futureDraft }).errors[0].code, 'unknown-evidence');
});
