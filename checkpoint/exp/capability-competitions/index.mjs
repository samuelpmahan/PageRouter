import { createCompetitionRegistry, NAME_THAT_LLM, NFL_WR_CUT_RECOVERY, validateReportEnvelope } from './capabilities.mjs';

export const validateRunnerReport = validateReportEnvelope;

export function evaluateReport(report, { registry = createCompetitionRegistry(), seed = 'capability-competition-v1' } = {}) {
  const expected = report?.experiment;
  validateRunnerReport(report, expected);
  const capabilityId = expected === NAME_THAT_LLM ? 'ntllm.evaluatePredictions' : expected === NFL_WR_CUT_RECOVERY ? 'nfl.evaluatePredictions' : null;
  if (!capabilityId) throw new TypeError(`unsupported experiment ${String(expected)}`);
  const status = report.status === 'blocked' ? 'blocked' : report.sourceKind === 'synthetic-fixture' ? 'inconclusive' : report.status;
  const execution = report.evaluation === undefined
    ? registry.execute('competition.validateReport', { report, experiment: expected }, { seed })
    : registry.execute(capabilityId, { report }, { seed });
  const replay = registry.replay(execution);
  return {
    experiment: expected,
    status,
    sourceKind: report.sourceKind,
    reason: report.reason ?? report.details?.reason ?? null,
    metrics: report.evaluation === undefined ? { experiment: expected, status, sourceKind: report.sourceKind, metrics: null } : execution.result,
    execution,
    replay: { matches: replay.matches, exact: replay.exact, hash: replay.hash, mismatches: replay.mismatches },
  };
}
