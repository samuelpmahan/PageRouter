import test from 'node:test';
import assert from 'node:assert/strict';
import { createCvRegistry, runCvCounterexample } from './cv-demo.mjs';
import { flowCandidateKey } from './adapters.mjs';

test('native CV fixture replays the choose-before-filter counterexample', () => {
  const result = runCvCounterexample();
  assert.equal(result.before.execution.result.candidate, null);
  assert.equal(result.after.execution.result.candidate.name, 'near-acceptable');
  assert.deepEqual(result.expected, { before: null, after: 'near-acceptable' });
  assert.equal(result.before.replay.matches, true);
  assert.equal(result.before.replay.exact, true);
  assert.equal(result.after.replay.matches, true);
  assert.equal(result.after.replay.exact, true);
  assert.match(result.evidenceSource, /4da01fba601a250e2fd4e7b8683c9fdd6bf0401b/);
  assert.match(result.evidenceSource, /github\.com\/samuelpmahan\/ChainSpot/);
  assert.equal(result.source.implementation.identityStatus, 'unbound');
  assert.equal(result.source.implementation.path, 'checkpoint/exp/operation-index/cv-demo.mjs');
  assert.equal(result.source.historicalReference.commit, '4da01fba601a250e2fd4e7b8683c9fdd6bf0401b');
});

test('native CV operations obey the eligibility-first invariant across edge cases', () => {
  const registry = createCvRegistry();
  const cases = [
    { candidates: [], expected: null },
    { candidates: [{ name: 'far', score: 0.99, distance: 20 }], expected: null },
    { candidates: [{ name: 'boundary', score: 0.8, distance: 5 }], expected: 'boundary' },
    { candidates: [{ name: 'under-floor', score: 0.79, distance: 2 }], expected: null },
    { candidates: [
      { name: 'tie-z', score: 0.8, distance: 1 },
      { name: 'tie-a', score: 0.8, distance: 3 },
    ], expected: 'tie-a' },
  ];

  for (const item of cases) {
    const execution = registry.execute('cv.filterThenRank', {
      candidates: item.candidates,
      radius: 5,
      scoreFloor: 0.8,
    }, { seed: 'cv-fixture-v1' });
    const replay = registry.replay(execution);
    assert.equal(execution.result.candidate?.name ?? null, item.expected);
    assert.equal(replay.matches, true);
    assert.equal(replay.exact, true);
  }
});

test('each composed descriptor uses both declared native leaf operations', () => {
  const registry = createCvRegistry();
  for (const id of ['cv.rankThenFilter', 'cv.filterThenRank']) {
    const execution = registry.execute(id, {
      candidates: [
        { name: 'far', score: 0.99, distance: 20 },
        { name: 'near', score: 0.8, distance: 2 },
      ],
      radius: 5,
      scoreFloor: 0.8,
    }, { seed: 'cv-fixture-v1' });
    const expectedOrder = id === 'cv.rankThenFilter'
      ? ['cv.rankCandidates', 'cv.filterEligible']
      : ['cv.filterEligible', 'cv.rankCandidates'];
    assert.deepEqual(execution.trace.calls.map(call => call.id), expectedOrder);
    assert.equal(registry.replay(execution).matches, true);
  }
});

test('fixture can persist each execution and its replay as separate indexed runs', () => {
  const runs = [];
  const index = { record(run) { runs.push(run); return { id: `run-${runs.length}` }; } };
  const result = runCvCounterexample({ index, now: () => 1234 });
  assert.deepEqual(runs.map(run => run.action), ['cv.rankThenFilter', 'cv.rankThenFilter.replay', 'cv.filterThenRank', 'cv.filterThenRank.replay']);
  assert.equal(runs[1].replayOf, 'run-1');
  assert.equal(runs[3].replayOf, 'run-3');
  assert.equal(runs[0].status, 'succeeded');
  assert.deepEqual(runs[0].operations.map(operation => operation.capabilityId), ['cv.rankThenFilter', 'cv.rankCandidates', 'cv.filterEligible']);
  assert.deepEqual(runs[2].operations.map(operation => operation.capabilityId), ['cv.filterThenRank', 'cv.filterEligible', 'cv.rankCandidates']);
  assert.equal(runs[2].operations[0].semantics.predicate, 'candidate-wise eligibility before argmax');
  assert.ok(runs.every(run => run.edges.every(edge => edge.kind === 'invocation')));
  assert.equal(runs[0].evidence.edgeMeaning.includes('no dataflow is inferred'), true);
  assert.notEqual(flowCandidateKey(runs[0]), flowCandidateKey(runs[2]));
  assert.equal(result.before.indexedRunId, 'run-1');
  assert.equal(result.after.indexedRunId, 'run-3');
});

test('flow candidate preserves guard values while ignoring incidental capability and operation IDs', () => {
  const baseRuns = [];
  const baseIndex = { record(run) { baseRuns.push(run); return { id: `base-${baseRuns.length}` }; } };
  runCvCounterexample({ index: baseIndex, now: () => 1234 });
  const base = baseRuns[2];
  const radiusRuns = [];
  const radiusIndex = { record(run) { radiusRuns.push(run); return { id: `radius-${radiusRuns.length}` }; } };
  runCvCounterexample({ index: radiusIndex, now: () => 1234, input: {
    candidates: [
      { name: 'far-high-score', score: 0.99, distance: 20 },
      { name: 'near-acceptable', score: 0.8, distance: 2 },
    ], radius: 6, scoreFloor: 0.8,
  } });
  const floorRuns = [];
  const floorIndex = { record(run) { floorRuns.push(run); return { id: `floor-${floorRuns.length}` }; } };
  runCvCounterexample({ index: floorIndex, now: () => 1234, input: {
    candidates: [
      { name: 'far-high-score', score: 0.99, distance: 20 },
      { name: 'near-acceptable', score: 0.8, distance: 2 },
    ], radius: 5, scoreFloor: 0.79,
  } });
  assert.notEqual(flowCandidateKey(base), flowCandidateKey(radiusRuns[2]));
  assert.notEqual(flowCandidateKey(base), flowCandidateKey(floorRuns[2]));

  const ids = new Map(base.operations.map((operation, index) => [operation.id, `renamed-op-${index + 1}`]));
  const renamed = {
    ...base,
    operations: base.operations.map((operation, index) => ({
      ...operation,
      id: ids.get(operation.id),
      nativeId: `renamed-native-${index + 1}`,
      capabilityId: `renamed.capability${index + 1}`,
    })),
    edges: base.edges.map(edge => ({ ...edge, from: ids.get(edge.from), to: ids.get(edge.to) })),
  };
  assert.equal(flowCandidateKey(base), flowCandidateKey(renamed));
});
