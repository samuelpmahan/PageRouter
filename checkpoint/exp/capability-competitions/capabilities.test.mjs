import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCompetitionRegistry, NTL_LABELS, NAME_THAT_LLM, NFL_WR_CUT_RECOVERY, REPORT_SCHEMA } from './capabilities.mjs';
import { evaluateReport, validateRunnerReport } from './index.mjs';
import { aggregateRunReceipts } from './cli.mjs';

const registry = createCompetitionRegistry();
const nameThatLlmExample = {
  schema: REPORT_SCHEMA, experiment: NAME_THAT_LLM, sourceKind: 'synthetic-fixture', status: 'inconclusive',
  provenance: { sourceKind: 'synthetic-fixture' },
  evaluation: { labels: [...NTL_LABELS], actual: [...NTL_LABELS], baselinePredicted: NTL_LABELS.map((label, index) => index < 2 ? NTL_LABELS[index + 1] : label), candidatePredicted: [...NTL_LABELS], groupIds: NTL_LABELS.map((_, index) => `prompt-${index + 1}`) },
  details: { reason: 'Small synthetic example.' },
};
const nflExample = {
  schema: REPORT_SCHEMA, experiment: NFL_WR_CUT_RECOVERY, sourceKind: 'synthetic-fixture', status: 'inconclusive',
  provenance: { sourceKind: 'synthetic-fixture' },
  evaluation: { actual: [0, 0, 0, 0, 0], baselinePredicted: [2, 2, 2, 2, 0], candidatePredicted: [0, 0, 0, 0, 1], groupIds: ['player-A', 'player-A', 'player-A', 'player-A', 'player-B'] },
  details: { reason: 'Five synthetic play rows.' },
};

test('native examples are literal and complete, and registry examples execute exactly as declared', () => {
  const descriptors = registry.list().filter(item => item.source === 'pagerouter-capability-competitions');
  assert.deepEqual(descriptors.map(item => item.id).sort(), [
    'competition.validateReport', 'nfl.evaluatePredictions', 'nfl.groupResiduals', 'ntllm.evaluatePredictions',
  ]);
  for (const descriptor of descriptors) {
    assert.ok(descriptor.examples.length > 0, `${descriptor.id} has a hand-checkable literal example`);
    for (const example of descriptor.examples || []) {
      const execution = registry.execute(descriptor.id, example.input, { seed: 1 });
      assert.deepEqual(execution.result, example.expected, `${descriptor.id} literal example`);
    }
  }
  assert.equal(nameThatLlmExample.evaluation.actual.length, 18);
  assert.equal(new Set(nameThatLlmExample.evaluation.actual).size, 18);
  assert.equal(nflExample.evaluation.actual.length, 5);
});

test('Name That LLM maps fixed labels by stable ID and uses native macro-recall with trace and replay', () => {
  const report = nameThatLlmExample;
  const result = evaluateReport(report, { registry });
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.sourceKind, 'synthetic-fixture');
  assert.equal(result.metrics.count, 18);
  assert.equal(result.metrics.baseline.accuracy, 16 / 18);
  assert.equal(result.metrics.candidate.accuracy, 1);
  assert.equal(result.metrics.baseline.macroRecall, 16 / 18);
  assert.equal(result.metrics.candidate.macroRecall, 1);
  assert.equal(result.replay.matches, true);
  assert.equal(result.replay.exact, true);
  const ids = new Set(result.execution.trace.calls.map(call => call.id));
  assert.ok(ids.has('competition.validateReport'));
  assert.ok(ids.has('ml.classificationMetrics'));
  assert.deepEqual(result.metrics.classes, [...NTL_LABELS]);
});

test('NFL displays row metrics separately and computes equal-player MAE on unequal play counts', () => {
  const result = evaluateReport(nflExample, { registry });
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.metrics.count, 5);
  assert.equal(result.metrics.playerCount, 2);
  assert.equal(result.metrics.rowWeighted.baseline.mae, 1.6);
  assert.equal(result.metrics.rowWeighted.candidate.mae, 0.2);
  assert.equal(result.metrics.playerWeighted.baselineMae, 1);
  assert.equal(result.metrics.playerWeighted.candidateMae, 0.5);
  assert.equal(result.metrics.playerWeighted.maeDeltaCandidateMinusBaseline, -0.5);
  assert.equal(result.replay.matches, true);
  const ids = new Set(flattenCalls(result.execution.trace).map(call => call.id));
  assert.ok(ids.has('nfl.groupResiduals'));
  assert.ok(ids.has('ml.regressionMetrics'));
  assert.ok(ids.has('statistics.mean'));
});

test('inconclusive report without evaluation is preserved as a structured native run', () => {
  const report = { schema: 'capability-competition-report.v1', experiment: NFL_WR_CUT_RECOVERY, sourceKind: 'competition-csv', status: 'inconclusive', provenance: {}, reason: 'Too few eligible players.' };
  const result = evaluateReport(report, { registry });
  assert.equal(result.status, 'inconclusive');
  assert.equal(result.metrics.metrics, null);
  assert.equal(result.reason, 'Too few eligible players.');
  assert.equal(result.replay.matches, true);
  assert.equal(result.execution.id, 'competition.validateReport');
  assert.deepEqual(result.execution.trace.calls, []);
});

test('synthetic source never becomes a completed empirical receipt even if a report says completed', () => {
  const forged = { ...nameThatLlmExample, status: 'completed' };
  assert.equal(evaluateReport(forged, { registry }).status, 'inconclusive');
});

test('report envelope rejects missing source kind, blocked evaluation, malformed metadata, and unknown keys', () => {
  const missingSource = { ...nflExample }; delete missingSource.sourceKind;
  assert.throws(() => validateRunnerReport(missingSource, NFL_WR_CUT_RECOVERY), /sourceKind/);
  const blockedWithEvaluation = { ...nflExample, status: 'blocked', reason: 'Missing input.' };
  assert.throws(() => validateRunnerReport(blockedWithEvaluation, NFL_WR_CUT_RECOVERY), /cannot contain evaluation/);
  const blockedWithoutReason = { ...nflExample, status: 'blocked' }; delete blockedWithoutReason.evaluation; delete blockedWithoutReason.details;
  assert.throws(() => validateRunnerReport(blockedWithoutReason, NFL_WR_CUT_RECOVERY), /require reason/);
  const inconclusiveWithoutReason = { ...nflExample, status: 'inconclusive' }; delete inconclusiveWithoutReason.evaluation; delete inconclusiveWithoutReason.details;
  assert.throws(() => validateRunnerReport(inconclusiveWithoutReason, NFL_WR_CUT_RECOVERY), /require reason/);
  assert.throws(() => validateRunnerReport({ ...nflExample, sourceKind: 'competition-csv', provenance: { sourceKind: 'synthetic-fixture' } }, NFL_WR_CUT_RECOVERY), /match report.sourceKind/);
  assert.throws(() => validateRunnerReport({ ...nflExample, details: null }, NFL_WR_CUT_RECOVERY), /details must be an object/);
  assert.throws(() => validateRunnerReport({ ...nflExample, reason: '' }, NFL_WR_CUT_RECOVERY), /reason must be a nonempty string/);
  assert.throws(() => validateRunnerReport({ ...nflExample, extra: true }, NFL_WR_CUT_RECOVERY), /unknown report field/);
});

test('aggregate retains complete source runner reports, diagnostics, provenance, and hashes', () => {
  const runnerReport = { ...nflExample, details: { cohortPlayers: { train: ['a'], holdout: ['b'] }, split_sha256: 'split-hash' } };
  const receipt = { name: NFL_WR_CUT_RECOVERY, schema: REPORT_SCHEMA, status: 'inconclusive', sourceKind: 'synthetic-fixture', reportSha256: 'a'.repeat(64), evaluation: { playerWeighted: { baselineMae: 1 } }, replay: { matches: true }, runnerReport };
  const aggregate = aggregateRunReceipts([receipt], 'fixture');
  assert.equal(aggregate.status, 'inconclusive');
  assert.equal(aggregate.sourceKinds[0], 'synthetic-fixture');
  assert.equal(aggregate.runs[0].reportSha256, 'a'.repeat(64));
  assert.equal(aggregate.runs[0].runnerReport.provenance.sourceKind, 'synthetic-fixture');
  assert.deepEqual(aggregate.runs[0].runnerReport.details, runnerReport.details);
  assert.deepEqual(aggregate.runs[0].evaluation, receipt.evaluation);
});

test('18-label report rejects unknown, missing, and unsupported actual classes before scoring', () => {
  const unknown = structuredClone(nameThatLlmExample); unknown.evaluation.candidatePredicted[0] = 'unknown-model';
  assert.throws(() => evaluateReport(unknown, { registry }), /unknown model label/);
  const unsupported = structuredClone(nameThatLlmExample); unsupported.evaluation.actual[17] = unsupported.evaluation.actual[16];
  assert.throws(() => evaluateReport(unsupported, { registry }), /all 18 model classes/);
  const duplicateTaxonomy = structuredClone(nameThatLlmExample); duplicateTaxonomy.evaluation.labels[17] = duplicateTaxonomy.evaluation.labels[16];
  assert.throws(() => evaluateReport(duplicateTaxonomy, { registry }), /each of the fixed 18/);
});

test('report JSON schema is strict at the root and requires a reason for blocked reports', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schema = JSON.parse(readFileSync(path.join(here, 'schemas/report.v1.schema.json'), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('sourceKind'));
  assert.ok(schema.allOf.some(rule => rule.if?.properties?.status?.const === 'blocked' && rule.then?.anyOf));
});

function flattenCalls(node) {
  return (node.calls || []).flatMap(call => [call, ...flattenCalls(call)]);
}
