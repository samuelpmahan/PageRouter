import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, variance, weightedMean, weightedVariance, onlineUpdate, onlineMoments, covariance, capabilities as coreCapabilities } from '../../src/statistics/core.mjs';
import { describe, capabilities as orderCapabilities } from '../../src/statistics/order.mjs';
import { resampleWithReplacement, bootstrapMeanCI, capabilities as inferenceCapabilities } from '../../src/statistics/inference.mjs';
import { createRegistry } from '../../src/runtime/index.mjs';

test('weighted results ignore zero-weight extreme observations and are scale invariant', () => {
  const base = { values: [2, 4], weights: [1, 1] };
  const withIgnoredOutlier = { values: [2, 4, 1e300], weights: [1e300, 1e300, 0] };
  assert.equal(weightedMean(withIgnoredOutlier).value, weightedMean(base).value);
  assert.equal(weightedVariance(withIgnoredOutlier).value, weightedVariance(base).value);
  assert.equal(weightedMean({ values: [2, 4], weights: [1e-300, 1e-300] }).value, 3);
});

test('online updates match a hand-computed batch state', () => {
  let state = { count: 0, mean: 0, m2: 0 };
  for (const value of [1, 2, 3, 4]) {
    const next = onlineUpdate({ state, value });
    state = { count: next.count, mean: next.mean, m2: next.m2 };
  }
  assert.deepEqual(state, { count: 4, mean: 2.5, m2: 5 });
  assert.deepEqual(onlineMoments({ values: [1, 2, 3, 4], denominator: 'sample' }), { count: 4, mean: 2.5, m2: 5, variance: 5 / 3 });
});

test('onlineUpdate runtime results can be fed directly into the next population and sample update', () => {
  const registry = createRegistry(coreCapabilities, { source: 'online-update-cross-review', version: '1' });
  let state = { count: 0, mean: 0, m2: 0 };
  for (const value of [1, 2, 3]) {
    const before = structuredClone(state);
    const execution = registry.execute('statistics.onlineUpdate', { state, value, denominator: 'population' });
    assert.deepEqual(state, before, 'onlineUpdate must not mutate its retained prior state');
    state = execution.result;
  }
  assert.deepEqual(state, { count: 3, mean: 2, m2: 2, variance: 2 / 3 });

  let sampleState = { count: 1, mean: 1, m2: 0, variance: 999 };
  for (const value of [2, 3]) sampleState = registry.execute('statistics.onlineUpdate', {
    state: sampleState, value, denominator: 'sample'
  }).result;
  assert.deepEqual(sampleState, { count: 3, mean: 2, m2: 2, variance: 1 });
});

test('large-offset covariance retains the exact centered fixture', () => {
  const offset = 1e12;
  assert.equal(covariance({ x: [offset + 1, offset + 2, offset + 3], y: [offset + 2, offset + 4, offset + 6], denominator: 'population' }).value, 4 / 3);
});

test('named descriptive function agrees with its reused core moment functions', () => {
  const input = { values: [3, -2, 5, 8], denominator: 'sample' }, got = describe(input);
  assert.equal(got.mean, mean(input).value);
  assert.equal(got.variance, variance(input).value);
});

test('order descriptors call exactly their declared dependencies synchronously', () => {
  const registry = new Map([...coreCapabilities, ...orderCapabilities].map(c => [c.id, c]));
  for (const id of ['statistics.describe', 'statistics.robustSummary', 'statistics.range']) {
    const cap = registry.get(id), called = [];
    const result = cap.run(cap.examples[0].input, { call(dependency, input) {
      assert.ok(cap.dependsOn.includes(dependency), `${id} called undeclared ${dependency}`);
      called.push(dependency);
      return registry.get(dependency).run(input, { call: () => { throw new Error('unexpected nested dependency'); } });
    } });
    assert.deepEqual(result, cap.examples[0].expected);
    for (const dependency of cap.dependsOn) assert.ok(called.includes(dependency), `${id} did not call ${dependency}`);
  }
});

test('seed 1 uses the known xorshift32 words to select independently indexed samples', () => {
  // First six xorshift32 words for seed 1; mapping floor(word / 2^32 * 3) => 0,0,1,0,1,0.
  const words = [270369, 67634689, 2647435461, 307599695, 2398689233, 745495504];
  assert.deepEqual(words.map(word => Math.floor(word / 0x1_0000_0000 * 3)), [0, 0, 1, 0, 1, 0]);
  assert.deepEqual(resampleWithReplacement({ values: [10, 20, 30], sampleSize: 6, seed: 1 }),
    { values: [10, 10, 20, 10, 20, 10], seed: 1 });
  assert.deepEqual(bootstrapMeanCI({ values: [0, 10], replicates: 1, seed: 1, confidence: 0.8 }),
    { estimate: 5, lower: 0, upper: 0, replicates: 1, seed: 1, confidence: 0.8 });
  assert.ok(inferenceCapabilities.some(capability => capability.id === 'statistics.bootstrapMeanCI'));
});

test('bootstrap uses one continued random stream rather than restarting at nearby seeds', () => {
  // Ten known seed-1 words map to [0,0,1,0,1,0,0,0,0,1]. Pairing draws gives means [0,5,5,0,5].
  const words = [270369, 67634689, 2647435461, 307599695, 2398689233, 745495504, 632435482, 435756210, 2005365029, 2916098932];
  const means = Array.from({ length: 5 }, (_, i) => words.slice(2 * i, 2 * i + 2).reduce((sum, word) => sum + (word >= 0x8000_0000 ? 10 : 0), 0) / 2);
  assert.deepEqual(means, [0, 5, 5, 0, 5]);
  assert.deepEqual(bootstrapMeanCI({ values: [0, 10], replicates: 5, seed: 1, confidence: 0.8 }),
    { estimate: 5, lower: 0, upper: 5, replicates: 5, seed: 1, confidence: 0.8 });
});

test('1000 bootstrap replicates cover both points of a balanced two-point population', () => {
  const registry = createRegistry([...coreCapabilities, ...orderCapabilities, ...inferenceCapabilities], { source: 'cross-review', version: '1' });
  const execution = registry.execute('statistics.bootstrapMeanCI', { values: [0, 10], replicates: 1_000, seed: 1, confidence: 0.95 });
  assert.deepEqual(execution.result, { estimate: 5, lower: 0, upper: 10, replicates: 1_000, seed: 1, confidence: 0.95 });
  assert.equal(execution.trace.calls.length, 1_004);
  assert.equal(registry.replay(execution).matches, true);
});
