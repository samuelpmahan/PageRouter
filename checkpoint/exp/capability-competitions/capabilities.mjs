import { createRegistry } from '../../vendor/capability-lab/src/runtime/index.mjs';
import { capabilities as statisticsCapabilities } from '../../vendor/capability-lab/src/statistics/index.mjs';
import { capabilities as linearAlgebraCapabilities } from '../../vendor/capability-lab/src/linalg/index.mjs';
import { capabilities as composedCapabilities } from '../../vendor/capability-lab/src/composed/index.mjs';
import { capabilities as mlDataCapabilities } from '../../vendor/capability-lab/src/ml/data.mjs';

export const NAME_THAT_LLM = 'name-that-llm';
export const NFL_WR_CUT_RECOVERY = 'nfl-wr-cut-recovery';
export const REPORT_SCHEMA = 'capability-competition-report.v1';
export const SOURCE_KINDS = Object.freeze(['synthetic-fixture', 'competition-csv']);
export const NTL_LABELS = Object.freeze([
  'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra',
  'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash',
  'claude-fable-5', 'claude-opus-4-6', 'claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5',
  'qwen3.8-max', 'glm-5.3', 'glm-5.3-flash', 'kimi-k3',
]);

const object = { type: 'object' };
const nonempty = { type: 'string' };
const stableClassIds = Array.from({ length: NTL_LABELS.length }, (_, index) => index);
const identityConfusion = stableClassIds.map(row => stableClassIds.map(column => row === column ? 1 : 0));
const perfectClassMetrics = { count: NTL_LABELS.length, classes: stableClassIds, confusionMatrix: identityConfusion, accuracy: 1, macroPrecision: 1, macroRecall: 1, macroF1: 1 };
const perfectNtlReport = {
  schema: REPORT_SCHEMA, experiment: NAME_THAT_LLM, sourceKind: 'synthetic-fixture', status: 'inconclusive', provenance: { sourceKind: 'synthetic-fixture' },
  evaluation: { labels: [...NTL_LABELS], actual: [...NTL_LABELS], baselinePredicted: [...NTL_LABELS], candidatePredicted: [...NTL_LABELS], groupIds: NTL_LABELS.map((_, index) => `prompt-${index + 1}`) },
};
const nflHandReport = {
  schema: REPORT_SCHEMA, experiment: NFL_WR_CUT_RECOVERY, sourceKind: 'synthetic-fixture', status: 'inconclusive', provenance: { sourceKind: 'synthetic-fixture' },
  evaluation: { actual: [10, 10, 10, 10, 20], baselinePredicted: [8, 8, 8, 8, 20], candidatePredicted: [10, 10, 10, 10, 18], groupIds: ['A', 'A', 'A', 'A', 'B'] },
};
const nflGroupExample = { actual: [3], baselinePredicted: [1], candidatePredicted: [2], groupIds: ['player-a'] };
const shared = {
  id: 'competition.validateReport', title: 'Validate competition report envelope',
  description: 'Check report identity, status, source kind, provenance, and evaluation shape before native scoring.',
  kind: 'atomic', dependsOn: [], source: 'pagerouter-capability-competitions', version: '1',
  inputSchema: { type: 'object', properties: { report: object, experiment: nonempty }, required: ['report', 'experiment'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { experiment: nonempty, status: nonempty, sourceKind: nonempty, hasEvaluation: { type: 'boolean' } }, required: ['experiment', 'status', 'sourceKind', 'hasEvaluation'], additionalProperties: false },
  examples: [{ input: { report: { schema: REPORT_SCHEMA, experiment: NAME_THAT_LLM, sourceKind: 'synthetic-fixture', status: 'inconclusive', provenance: {}, reason: 'No evaluation supplied.' }, experiment: NAME_THAT_LLM }, expected: { experiment: NAME_THAT_LLM, status: 'inconclusive', sourceKind: 'synthetic-fixture', hasEvaluation: false } }],
  run: ({ report, experiment }) => {
    const status = validateReportEnvelope(report, experiment);
    return { experiment, status, sourceKind: report.sourceKind, hasEvaluation: report.evaluation !== undefined };
  },
  caveats: 'This validates the declared report envelope and metric arrays. It does not independently verify external model fitting, source files, or data provenance.',
};

export function validateReportEnvelope(report, expectedExperiment) {
  if (![NAME_THAT_LLM, NFL_WR_CUT_RECOVERY].includes(expectedExperiment)) throw new TypeError(`unknown experiment ${String(expectedExperiment)}`);
  if (!plainObject(report)) throw new TypeError('report must be a plain object');
  const allowed = new Set(['schema', 'experiment', 'sourceKind', 'status', 'provenance', 'evaluation', 'details', 'reason']);
  for (const key of Object.keys(report)) if (!allowed.has(key)) throw new TypeError(`unknown report field ${key}`);
  if (report.schema !== REPORT_SCHEMA) throw new TypeError(`report.schema must be ${REPORT_SCHEMA}`);
  if (report.experiment !== expectedExperiment) throw new TypeError(`report.experiment must be ${expectedExperiment}`);
  if (!SOURCE_KINDS.includes(report.sourceKind)) throw new TypeError('report.sourceKind must be synthetic-fixture or competition-csv');
  if (!['completed', 'blocked', 'inconclusive'].includes(report.status)) throw new TypeError('report.status is invalid');
  if (!plainObject(report.provenance)) throw new TypeError('report.provenance must be an object');
  if (Object.hasOwn(report.provenance, 'sourceKind') && report.provenance.sourceKind !== report.sourceKind) throw new TypeError('provenance.sourceKind must match report.sourceKind');
  if (report.details !== undefined && !plainObject(report.details)) throw new TypeError('report.details must be an object');
  if (report.reason !== undefined && (typeof report.reason !== 'string' || !report.reason.trim())) throw new TypeError('report.reason must be a nonempty string');
  if (report.status === 'blocked') {
    if (Object.hasOwn(report, 'evaluation')) throw new TypeError('blocked reports cannot contain evaluation');
    if (!(report.reason || (typeof report.details?.reason === 'string' && report.details.reason.trim()))) throw new TypeError('blocked reports require reason or details.reason');
  }
  if (report.status === 'inconclusive' && report.evaluation === undefined && !(report.reason || (typeof report.details?.reason === 'string' && report.details.reason.trim()))) throw new TypeError('inconclusive reports without evaluation require reason or details.reason');
  if (report.status === 'completed' && report.evaluation === undefined) throw new TypeError('completed reports require evaluation');
  if (report.evaluation !== undefined && !plainObject(report.evaluation)) throw new TypeError('report.evaluation must be an object');
  return report.status;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validateArrays(evaluation, fields, maxRows = 10_000, stringFields = []) {
  if (!plainObject(evaluation)) throw new TypeError('evaluation must be an object');
  const arrays = fields.map(field => evaluation[field]);
  const count = arrays[0]?.length;
  if (!Number.isInteger(count) || count < 1 || count > maxRows || arrays.some(rows => !Array.isArray(rows) || rows.length !== count)) throw new TypeError('evaluation arrays must be nonempty, equal length, and within row limits');
  for (const [field, rows] of fields.map((field, index) => [field, arrays[index]])) {
    for (const [index, value] of rows.entries()) {
      if (field === 'groupIds') {
        if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field}[${index}] must be a nonempty string`);
      } else if (stringFields.includes(field)) {
        if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field}[${index}] must be a nonempty string`);
      } else if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${field}[${index}] must be finite`);
    }
  }
  return count;
}

const groupRows = {
  id: 'nfl.groupResiduals', title: 'Group play residuals by player',
  description: 'Keep every play-level error and group rows by player before computing equal-player metrics.',
  kind: 'atomic', dependsOn: [], source: 'pagerouter-capability-competitions', version: '1',
  inputSchema: { type: 'object', properties: { actual: { type: 'array', minItems: 1, items: { type: 'number' } }, baselinePredicted: { type: 'array', minItems: 1, items: { type: 'number' } }, candidatePredicted: { type: 'array', minItems: 1, items: { type: 'number' } }, groupIds: { type: 'array', minItems: 1, items: nonempty } }, required: ['actual', 'baselinePredicted', 'candidatePredicted', 'groupIds'], additionalProperties: false },
  outputSchema: { type: 'object' }, examples: [{ input: nflGroupExample, expected: { players: ['player-a'], rowsByPlayer: { 'player-a': { baselineAbsolute: [2], candidateAbsolute: [1], baselineSquared: [4], candidateSquared: [1] } }, playCount: 1 } }],
  run: input => {
    const rows = { ...input };
    const count = validateArrays(rows, ['actual', 'baselinePredicted', 'candidatePredicted', 'groupIds']);
    const byPlayer = new Map();
    for (let i = 0; i < count; i += 1) {
      const values = byPlayer.get(rows.groupIds[i]) || { baselineAbsolute: [], candidateAbsolute: [], baselineSquared: [], candidateSquared: [] };
      const baselineError = rows.actual[i] - rows.baselinePredicted[i];
      const candidateError = rows.actual[i] - rows.candidatePredicted[i];
      values.baselineAbsolute.push(Math.abs(baselineError)); values.candidateAbsolute.push(Math.abs(candidateError));
      values.baselineSquared.push(baselineError ** 2); values.candidateSquared.push(candidateError ** 2);
      byPlayer.set(rows.groupIds[i], values);
    }
    const orderedPlayers = [...byPlayer.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return { players: orderedPlayers, rowsByPlayer: Object.fromEntries(orderedPlayers.map(player => [player, byPlayer.get(player)])), playCount: count };
  },
  caveats: 'Group IDs come from the report. This step preserves play-level residuals; it does not validate their external grouping provenance.',
};

const ntllmEvaluate = {
  id: 'ntllm.evaluatePredictions', title: 'Evaluate Name That LLM predictions',
  description: 'Map the fixed 18-model taxonomy to stable integer IDs and compare macro recall using CapabilityLab metrics.',
  kind: 'composed', dependsOn: ['competition.validateReport', 'ml.classificationMetrics'], source: 'pagerouter-capability-competitions', version: '1',
  inputSchema: { type: 'object', properties: { report: object }, required: ['report'], additionalProperties: false }, outputSchema: object,
  examples: [{ input: { report: perfectNtlReport }, expected: { experiment: NAME_THAT_LLM, status: 'inconclusive', sourceKind: 'synthetic-fixture', count: 18, classes: [...NTL_LABELS], baseline: perfectClassMetrics, candidate: perfectClassMetrics, macroRecallDelta: 0, groupCount: 18 } }], formula: 'Map canonical model label to stable integer ID, then macroRecall = mean of class recalls across all 18 fixed labels.',
  caveats: 'All 18 actual classes must be present. Canonical label order defines IDs, independent of input order; unknown or missing classes are rejected.',
  run: ({ report }, ctx) => {
    const envelope = ctx.call('competition.validateReport', { report, experiment: NAME_THAT_LLM });
    const status = envelope.status === 'blocked' ? 'blocked' : envelope.sourceKind === 'synthetic-fixture' ? 'inconclusive' : envelope.status;
    if (!envelope.hasEvaluation) return { experiment: envelope.experiment, status, sourceKind: envelope.sourceKind, metrics: null };
    const evaluation = report.evaluation;
    const count = validateArrays(evaluation, ['actual', 'baselinePredicted', 'candidatePredicted', 'groupIds'], 10_000, ['actual', 'baselinePredicted', 'candidatePredicted']);
    if (evaluation.labels.length !== NTL_LABELS.length || new Set(evaluation.labels).size !== NTL_LABELS.length || evaluation.labels.some(label => !NTL_LABELS.includes(label))) throw new TypeError('labels must contain each of the fixed 18 Name That LLM labels exactly once');
    const ids = new Map(NTL_LABELS.map((label, index) => [label, index]));
    for (const field of ['actual', 'baselinePredicted', 'candidatePredicted']) if (evaluation[field].some(label => !ids.has(label))) throw new TypeError(`${field} contains an unknown model label`);
    if (new Set(evaluation.actual).size !== NTL_LABELS.length) throw new TypeError('actual must include all 18 model classes');
    const actual = evaluation.actual.map(label => ids.get(label));
    const baseline = ctx.call('ml.classificationMetrics', { actual, predicted: evaluation.baselinePredicted.map(label => ids.get(label)) });
    const candidate = ctx.call('ml.classificationMetrics', { actual, predicted: evaluation.candidatePredicted.map(label => ids.get(label)) });
    return { experiment: envelope.experiment, status, sourceKind: envelope.sourceKind, count, classes: [...NTL_LABELS], baseline, candidate, macroRecallDelta: candidate.macroRecall - baseline.macroRecall, groupCount: new Set(evaluation.groupIds).size };
  },
};

const nflEvaluate = {
  id: 'nfl.evaluatePredictions', title: 'Evaluate NFL receiver predictions',
  description: 'Show row-weighted play metrics and equal-player error metrics from the same held-out play rows.',
  kind: 'composed', dependsOn: ['competition.validateReport', 'ml.regressionMetrics', 'nfl.groupResiduals', 'statistics.mean'], source: 'pagerouter-capability-competitions', version: '1',
  inputSchema: { type: 'object', properties: { report: object }, required: ['report'], additionalProperties: false }, outputSchema: object,
  examples: [{ input: { report: nflHandReport }, expected: { experiment: NFL_WR_CUT_RECOVERY, status: 'inconclusive', sourceKind: 'synthetic-fixture', count: 5, playerCount: 2, players: ['A', 'B'], rowWeighted: { baseline: { count: 5, mae: 1.6, mse: 3.2, rmse: Math.sqrt(3.2), r2: 0.8 }, candidate: { count: 5, mae: 0.4, mse: 0.8, rmse: Math.sqrt(0.8), r2: 0.95 } }, playerWeighted: { baselineMae: 1, candidateMae: 1, maeDeltaCandidateMinusBaseline: 0, baselineRmse: Math.sqrt(2), candidateRmse: Math.sqrt(2) } } }], formula: 'Equal-player MAE = mean over players of each player’s mean absolute play error; row metrics are reported separately.',
  caveats: 'Equal-player MAE gives each player one vote. Row-level regression metrics are shown as a distinct estimand and are not used as the primary player-weighted comparison.',
  run: ({ report }, ctx) => {
    const envelope = ctx.call('competition.validateReport', { report, experiment: NFL_WR_CUT_RECOVERY });
    const status = envelope.status === 'blocked' ? 'blocked' : envelope.sourceKind === 'synthetic-fixture' ? 'inconclusive' : envelope.status;
    if (!envelope.hasEvaluation) return { experiment: envelope.experiment, status, sourceKind: envelope.sourceKind, metrics: null };
    const evaluation = report.evaluation;
    const count = validateArrays(evaluation, ['actual', 'baselinePredicted', 'candidatePredicted', 'groupIds']);
    const baselineRows = ctx.call('ml.regressionMetrics', { actual: evaluation.actual, predicted: evaluation.baselinePredicted });
    const candidateRows = ctx.call('ml.regressionMetrics', { actual: evaluation.actual, predicted: evaluation.candidatePredicted });
    const groups = ctx.call('nfl.groupResiduals', evaluation);
    const baselineMaeByPlayer = groups.players.map(player => ctx.call('statistics.mean', { values: groups.rowsByPlayer[player].baselineAbsolute }).value);
    const candidateMaeByPlayer = groups.players.map(player => ctx.call('statistics.mean', { values: groups.rowsByPlayer[player].candidateAbsolute }).value);
    const baselineMseByPlayer = groups.players.map(player => ctx.call('statistics.mean', { values: groups.rowsByPlayer[player].baselineSquared }).value);
    const candidateMseByPlayer = groups.players.map(player => ctx.call('statistics.mean', { values: groups.rowsByPlayer[player].candidateSquared }).value);
    const baselinePlayerMae = ctx.call('statistics.mean', { values: baselineMaeByPlayer }).value;
    const candidatePlayerMae = ctx.call('statistics.mean', { values: candidateMaeByPlayer }).value;
    const baselinePlayerRmse = Math.sqrt(ctx.call('statistics.mean', { values: baselineMseByPlayer }).value);
    const candidatePlayerRmse = Math.sqrt(ctx.call('statistics.mean', { values: candidateMseByPlayer }).value);
    return { experiment: envelope.experiment, status, sourceKind: envelope.sourceKind, count, playerCount: groups.players.length, players: groups.players, rowWeighted: { baseline: baselineRows, candidate: candidateRows }, playerWeighted: { baselineMae: baselinePlayerMae, candidateMae: candidatePlayerMae, maeDeltaCandidateMinusBaseline: candidatePlayerMae - baselinePlayerMae, baselineRmse: baselinePlayerRmse, candidateRmse: candidatePlayerRmse } };
  },
};

export const competitionCapabilities = [shared, groupRows, ntllmEvaluate, nflEvaluate];

export function createCompetitionRegistry(options = {}) {
  const limits = { maxValueBytes: 16 * 1024 * 1024, maxTracePayloadBytes: 64 * 1024 * 1024, ...(options.limits || {}) };
  return createRegistry([
    ...statisticsCapabilities, ...linearAlgebraCapabilities, ...composedCapabilities,
    ...mlDataCapabilities, ...competitionCapabilities,
  ], { source: 'pagerouter-capability-competitions', version: '1', ...options, limits });
}
