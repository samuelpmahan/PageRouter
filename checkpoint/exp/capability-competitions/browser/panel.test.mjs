import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompetitionRegistry, NTL_LABELS } from '../capabilities.mjs';
import { makeNameThatLlmReport, makeNflReport, runSyntheticReference } from './fixtures.mjs';
import { metricMarkup } from './panel.mjs';

const registry = createCompetitionRegistry();

test('browser NTL fixture contains all supported canonical classes and stays explicitly synthetic', () => {
  const report = makeNameThatLlmReport();
  assert.equal(report.sourceKind, 'synthetic-fixture');
  assert.equal(report.status, 'inconclusive');
  assert.deepEqual(report.evaluation.labels, [...NTL_LABELS]);
  assert.deepEqual(new Set(report.evaluation.actual), new Set(NTL_LABELS));
  const { result } = runSyntheticReference(report, registry);
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.sourceKind, 'synthetic-fixture');
  assert.equal(result.count, 18);
  assert.match(metricMarkup(result), /Baseline · macro recall/);
  assert.match(metricMarkup(result), /Candidate · macro recall/);
});

test('browser NFL fixture demonstrates pooled MAE improvement with equal-player MAE tie and native replay', () => {
  const report = makeNflReport();
  assert.deepEqual(report.evaluation.actual, [10, 10, 10, 10, 20]);
  assert.deepEqual(report.evaluation.baselinePredicted, [8, 8, 8, 8, 20]);
  assert.deepEqual(report.evaluation.candidatePredicted, [10, 10, 10, 10, 18]);
  assert.deepEqual(report.evaluation.groupIds, ['A', 'A', 'A', 'A', 'B']);
  const { execution, result } = runSyntheticReference(report, registry);
  assert.equal(result.rowWeighted.baseline.mae, 1.6);
  assert.equal(result.rowWeighted.candidate.mae, 0.4);
  assert.equal(result.playerWeighted.baselineMae, 1);
  assert.equal(result.playerWeighted.candidateMae, 1);
  assert.equal(result.playerWeighted.maeDeltaCandidateMinusBaseline, 0);
  assert.match(metricMarkup(result), /Pooled metrics weight each play row equally/);
  assert.match(metricMarkup(result), /Equal-player metrics first average a player’s plays/);
  const replay = registry.replay(execution);
  assert.equal(replay.matches, true);
  assert.equal(replay.exact, true);
});

test('browser runner refuses a completed or non-synthetic report', () => {
  const report = makeNflReport();
  assert.throws(() => runSyntheticReference({ ...report, status: 'completed' }, registry), /inconclusive synthetic-fixture/);
  assert.throws(() => runSyntheticReference({ ...report, sourceKind: 'competition-csv' }, registry), /inconclusive synthetic-fixture/);
});
