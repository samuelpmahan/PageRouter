import { createRegistry } from '../../vendor/capability-lab/src/runtime/index.mjs';
import { normalizeLabExecution } from './adapters.mjs';

export const CV_FIXTURE_SOURCE = Object.freeze({
  kind: 'synthetic-fixture',
  implementation: { path: 'checkpoint/exp/operation-index/cv-demo.mjs', identityStatus: 'unbound' },
  historicalReference: {
    repository: 'samuelpmahan/ChainSpot',
    commit: '4da01fba601a250e2fd4e7b8683c9fdd6bf0401b',
    file: 'src/lib/cv/localSnap.ts',
    url: 'https://github.com/samuelpmahan/ChainSpot/blob/4da01fba601a250e2fd4e7b8683c9fdd6bf0401b/src/lib/cv/localSnap.ts',
    claim: 'The historical code selected argmax across all crops, then radius-rejected that single winner; this fixture models the ordering counterexample only.',
  },
  caveat: 'This is a replayable synthetic CapabilityLab fixture. It does not execute the historical ChainSpot TypeScript or a full CV pipeline.',
});

export const CV_SEMANTICS = Object.freeze({
  'cv.rankCandidates': { op: 'argmax', predicate: 'score descending', constants: { tieBreak: 'candidate name ascending' }, frame: 'synthetic candidate set', units: 'score unitless; distance fixture units' },
  'cv.filterEligible': { op: 'filter', predicate: 'distance <= radius and score >= scoreFloor', constants: { radiusBoundary: 'inclusive', scoreFloorBoundary: 'inclusive' }, frame: 'synthetic candidate set', units: 'distance and radius share fixture units; score unitless' },
  'cv.rankThenFilter': { op: 'compose', predicate: 'argmax before candidate-wise eligibility', constants: { order: ['argmax', 'eligibility-filter'] }, frame: 'synthetic candidate set', units: 'score unitless; distance fixture units' },
  'cv.filterThenRank': { op: 'compose', predicate: 'candidate-wise eligibility before argmax', constants: { order: ['eligibility-filter', 'argmax'] }, frame: 'synthetic candidate set', units: 'score unitless; distance fixture units' },
});

const candidateSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, score: { type: 'number' }, distance: { type: 'number' } },
  required: ['name', 'score', 'distance'],
  additionalProperties: false,
};
const candidatesSchema = { type: 'array', items: candidateSchema };
const inputSchema = {
  type: 'object',
  properties: {
    candidates: candidatesSchema,
    radius: { type: 'number', minimum: 0 },
    scoreFloor: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['candidates', 'radius', 'scoreFloor'],
  additionalProperties: false,
};
const candidateOrEmptySchema = {
  type: 'object',
  properties: { name: { type: 'string' }, score: { type: 'number' }, distance: { type: 'number' } },
  required: ['name', 'score', 'distance'],
  additionalProperties: false,
};
const rankOutputSchema = {
  type: 'object',
  properties: { found: { type: 'boolean' }, candidate: candidateOrEmptySchema },
  required: ['found', 'candidate'],
  additionalProperties: false,
};
const eligibleOutputSchema = { type: 'object', properties: { candidates: candidatesSchema }, required: ['candidates'], additionalProperties: false };
const demoInput = {
  candidates: [
    { name: 'far-high-score', score: 0.99, distance: 20 },
    { name: 'near-acceptable', score: 0.8, distance: 2 },
  ],
  radius: 5,
  scoreFloor: 0.8,
};

const rankCandidates = {
  id: 'cv.rankCandidates', title: 'Rank candidates by score',
  description: 'Choose the highest score; break score ties by ascending candidate name.',
  kind: 'atomic', dependsOn: [], source: 'pagerouter-cv-ordering-fixture', version: '1',
  inputSchema: { type: 'object', properties: { candidates: candidatesSchema }, required: ['candidates'], additionalProperties: false },
  outputSchema: rankOutputSchema,
  examples: [{ input: { candidates: demoInput.candidates }, expected: { found: true, candidate: demoInput.candidates[0] } }],
  formula: 'argmax(score), with ascending name as the deterministic tie-break.',
  run: ({ candidates }) => {
    if (candidates.length === 0) return { found: false, candidate: { name: '', score: 0, distance: 0 } };
    const sorted = [...candidates].sort((left, right) => right.score - left.score || compareText(left.name, right.name));
    return { found: true, candidate: sorted[0] };
  },
};

const filterEligible = {
  id: 'cv.filterEligible', title: 'Filter CV candidates by eligibility',
  description: 'Retain each candidate within the inclusive radius and at or above the score floor.',
  kind: 'atomic', dependsOn: [], source: 'pagerouter-cv-ordering-fixture', version: '1',
  inputSchema,
  outputSchema: eligibleOutputSchema,
  examples: [{ input: demoInput, expected: { candidates: [demoInput.candidates[1]] } }],
  formula: 'candidate.distance <= radius and candidate.score >= scoreFloor.',
  units: 'distance and radius use the same fixture distance unit; score is unitless.',
  run: ({ candidates, radius, scoreFloor }) => ({
    candidates: candidates.filter(candidate => candidate.distance <= radius && candidate.score >= scoreFloor),
  }),
};

const rankThenFilter = {
  id: 'cv.rankThenFilter', title: 'Rank before eligibility filtering',
  description: 'Reproduce the ordering failure by selecting one global winner before applying radius and score eligibility.',
  kind: 'composed', dependsOn: ['cv.rankCandidates', 'cv.filterEligible'], source: 'pagerouter-cv-ordering-fixture', version: '1',
  inputSchema,
  outputSchema: { type: 'object' },
  examples: [{ input: demoInput, expected: { candidate: null } }],
  caveats: 'This synthetic composition expresses the historical ordering pattern. Runtime traces show call order; they do not prove dataflow between calls.',
  run: ({ candidates, radius, scoreFloor }, ctx) => {
    const winner = ctx.call('cv.rankCandidates', { candidates });
    const eligible = ctx.call('cv.filterEligible', {
      candidates: winner.found ? [winner.candidate] : [], radius, scoreFloor,
    });
    return { candidate: eligible.candidates[0] ?? null };
  },
};

const filterThenRank = {
  id: 'cv.filterThenRank', title: 'Filter eligibility before ranking',
  description: 'Apply radius and score eligibility to every candidate, then select the best remaining score.',
  kind: 'composed', dependsOn: ['cv.filterEligible', 'cv.rankCandidates'], source: 'pagerouter-cv-ordering-fixture', version: '1',
  inputSchema,
  outputSchema: { type: 'object' },
  examples: [{ input: demoInput, expected: { candidate: demoInput.candidates[1] } }],
  caveats: 'This fixture verifies the ordering invariant on declared synthetic data; it does not run a production CV pipeline.',
  run: ({ candidates, radius, scoreFloor }, ctx) => {
    const eligible = ctx.call('cv.filterEligible', { candidates, radius, scoreFloor });
    const winner = ctx.call('cv.rankCandidates', { candidates: eligible.candidates });
    return { candidate: winner.found ? winner.candidate : null };
  },
};

export const cvCapabilities = [rankCandidates, filterEligible, rankThenFilter, filterThenRank];

export function createCvRegistry(options = {}) {
  return createRegistry(cvCapabilities, { source: 'pagerouter-cv-ordering-fixture', version: '1', ...options });
}

export function runCvCounterexample({ index, source = CV_FIXTURE_SOURCE, now = Date.now, registry = createCvRegistry(), input = demoInput } = {}) {
  const effectiveSource = mergeSource(source);
  const before = runAndReplay(registry, 'cv.rankThenFilter', input, { index, source: effectiveSource, now });
  const after = runAndReplay(registry, 'cv.filterThenRank', input, { index, source: effectiveSource, now });
  return {
    before,
    after,
    expected: { before: before.execution.result.candidate?.name ?? null, after: after.execution.result.candidate?.name ?? null },
    evidenceSource: effectiveSource?.historicalReference?.url ?? CV_FIXTURE_SOURCE.historicalReference.url,
    source: effectiveSource,
    capabilityInspection: registry.graph(),
  };
}

function runAndReplay(registry, capabilityId, input, { index, source, now }) {
  const executionStartedAt = now();
  const execution = registry.execute(capabilityId, input, { seed: 'cv-fixture-v1' });
  const executionFinishedAt = now();
  const originalIndexId = recordExecution(index, execution, capabilityId, source, executionStartedAt, executionFinishedAt);
  const replayStartedAt = now();
  const replay = registry.replay(execution);
  const replayFinishedAt = now();
  const replayIndexId = recordExecution(index, replay.receipt, `${capabilityId}.replay`, source, replayStartedAt, replayFinishedAt, originalIndexId);
  return {
    execution,
    replay: { matches: replay.matches, exact: replay.exact, hash: replay.hash, mismatches: replay.mismatches },
    indexedRunId: originalIndexId,
    replayIndexedRunId: replayIndexId,
  };
}

function recordExecution(index, execution, action, source, startedAt, finishedAt, replayOf) {
  if (!index || typeof index.record !== 'function') return null;
  const normalized = normalizeLabExecution(execution, { replay: action.endsWith('.replay'), semantics: semanticsFor(execution.input) });
  const evidence = {
    ...normalized.evidence,
    fixture: 'synthetic-cv-local-snap-ordering',
    executionId: execution.id,
    semanticRecipe: action.includes('.replay') ? null : recipeFor(action),
    caveat: 'Call tree records invocation order only. semanticRecipe documents the fixture code binding; it is not runtime-observed dataflow.',
  };
  const result = index.record({
    runtime: 'capability-lab',
    action,
    source,
    startedAt,
    finishedAt,
    status: normalized.status,
    operations: normalized.operations,
    edges: normalized.edges,
    evidence,
    ...(replayOf ? { replayOf } : {}),
  });
  return typeof result === 'string' ? result : result?.id ?? null;
}

function recipeFor(action) {
  return action === 'cv.rankThenFilter'
    ? { order: ['argmax', 'eligibility-filter'], binding: 'filterEligible receives the rank result as a singleton candidate list' }
    : { order: ['eligibility-filter', 'argmax'], binding: 'rankCandidates receives the filter result candidate list' };
}

function semanticsFor(input) {
  const guards = { radius: input.radius, scoreFloor: input.scoreFloor };
  return {
    ...CV_SEMANTICS,
    'cv.filterEligible': {
      ...CV_SEMANTICS['cv.filterEligible'],
      constants: { ...CV_SEMANTICS['cv.filterEligible'].constants, ...guards },
    },
    'cv.rankThenFilter': {
      ...CV_SEMANTICS['cv.rankThenFilter'],
      constants: { ...CV_SEMANTICS['cv.rankThenFilter'].constants, ...guards },
    },
    'cv.filterThenRank': {
      ...CV_SEMANTICS['cv.filterThenRank'],
      constants: { ...CV_SEMANTICS['cv.filterThenRank'].constants, ...guards },
    },
  };
}

function mergeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source ?? CV_FIXTURE_SOURCE;
  return {
    ...CV_FIXTURE_SOURCE,
    ...source,
    implementation: { ...CV_FIXTURE_SOURCE.implementation, ...(source.implementation ?? {}) },
    historicalReference: source.historicalReference ?? CV_FIXTURE_SOURCE.historicalReference,
  };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
