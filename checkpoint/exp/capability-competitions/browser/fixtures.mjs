import {
  createCompetitionRegistry,
  NAME_THAT_LLM,
  NFL_WR_CUT_RECOVERY,
  NTL_LABELS,
  REPORT_SCHEMA,
} from '../capabilities.mjs';

const syntheticProvenance = note => ({ sourceKind: 'synthetic-fixture', note });

export function makeNameThatLlmReport() {
  return {
    schema: REPORT_SCHEMA,
    experiment: NAME_THAT_LLM,
    sourceKind: 'synthetic-fixture',
    status: 'inconclusive',
    provenance: syntheticProvenance('Tiny browser plumbing example. Predictions are literal synthetic labels; no model fitting.'),
    evaluation: {
      labels: [...NTL_LABELS],
      actual: [...NTL_LABELS],
      baselinePredicted: NTL_LABELS.map((label, index) => index < 2 ? NTL_LABELS[index + 1] : label),
      candidatePredicted: [...NTL_LABELS],
      groupIds: NTL_LABELS.map((_, index) => `synthetic-prompt-${index + 1}`),
    },
  };
}

export function makeNflReport() {
  return {
    schema: REPORT_SCHEMA,
    experiment: NFL_WR_CUT_RECOVERY,
    sourceKind: 'synthetic-fixture',
    status: 'inconclusive',
    provenance: syntheticProvenance('Five synthetic plays for browser plumbing only; no model fitting or competition data.'),
    evaluation: {
      actual: [10, 10, 10, 10, 20],
      baselinePredicted: [8, 8, 8, 8, 20],
      candidatePredicted: [10, 10, 10, 10, 18],
      groupIds: ['A', 'A', 'A', 'A', 'B'],
    },
  };
}

export function runSyntheticReference(report, registry = createCompetitionRegistry()) {
  if (report?.sourceKind !== 'synthetic-fixture' || report?.status !== 'inconclusive') {
    throw new TypeError('Reference panel accepts only inconclusive synthetic-fixture reports.');
  }
  const capabilityId = report.experiment === NAME_THAT_LLM
    ? 'ntllm.evaluatePredictions'
    : report.experiment === NFL_WR_CUT_RECOVERY
      ? 'nfl.evaluatePredictions'
      : null;
  if (!capabilityId) throw new TypeError('Choose a supported competition reference.');
  const execution = registry.execute(capabilityId, { report });
  return { execution, result: execution.result };
}
