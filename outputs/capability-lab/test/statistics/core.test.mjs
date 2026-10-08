import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilities as coreCapabilities,
  mean,
  variance,
  standardDeviation,
  weightedMean,
  weightedVariance,
  onlineUpdate,
  onlineMoments,
  covariance,
  correlation,
  zScores,
  pairedDifferences,
  welchMeanDifference
} from '../../src/statistics/core.mjs';
import { createRegistry } from '../../src/runtime/index.mjs';

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('mean and variance use explicit population and sample denominators', () => {
  assert.deepEqual(mean({ values: [1, 2, 3] }), { value: 2 });
  assert.deepEqual(variance({ values: [1, 2, 3], denominator: 'population' }), { value: 2 / 3 });
  assert.deepEqual(variance({ values: [1, 2, 3], denominator: 'sample' }), { value: 1 });
  assert.deepEqual(standardDeviation({ values: [1, 2, 3], denominator: 'sample' }), { value: 1 });
});

test('scaled averaging retains the smallest representable positive means', () => {
  assert.deepEqual(mean({ values: [Number.MIN_VALUE, Number.MIN_VALUE] }), { value: Number.MIN_VALUE });
});

test('weighted averaging retains a representable subnormal result', () => {
  assert.deepEqual(weightedMean({ values: [Number.MIN_VALUE, Number.MIN_VALUE], weights: [1, 1] }), { value: Number.MIN_VALUE });
});

test('centered variance remains accurate for small spread on a large offset', () => {
  const values = [1_000_000_000_001, 1_000_000_000_002, 1_000_000_000_003];
  close(mean({ values }).value, 1_000_000_000_002, 1e-6);
  close(variance({ values, denominator: 'population' }).value, 2 / 3, 1e-12);
  close(variance({ values, denominator: 'sample' }).value, 1, 1e-12);
});

test('weighted statistics use nonnegative weights and population normalization', () => {
  const input = { values: [1, 3, 10], weights: [1, 2, 1] };
  assert.deepEqual(weightedMean(input), { value: 4.25 });
  assert.deepEqual(weightedVariance(input), { value: 11.6875 });
  assert.deepEqual(weightedVariance({ values: [-1e308, 1e308], weights: [1, 0] }), { value: 0 });
  assert.deepEqual(weightedVariance({ values: [2, 4, 1e300], weights: [1e300, 1e300, 0] }), { value: 1 });
  const manyEqualValues = Array(150_000).fill(3);
  assert.deepEqual(weightedVariance({ values: manyEqualValues, weights: Array(150_000).fill(1) }), { value: 0 });
});

test('online moments use Welford updates and match the population variance', () => {
  assert.deepEqual(onlineMoments({ values: [1, 2, 3], denominator: 'population' }), {
    count: 3, mean: 2, m2: 2, variance: 2 / 3
  });
});

test('online updates accept an explicit empty state and retain only bounded moments', () => {
  const first = onlineUpdate({ state: { count: 0, mean: 0, m2: 0 }, value: 5 });
  assert.deepEqual(first, { count: 1, mean: 5, m2: 0, variance: 0 });
  const second = onlineUpdate({ state: { count: first.count, mean: first.mean, m2: first.m2 }, value: 7 });
  assert.deepEqual(second, { count: 2, mean: 6, m2: 2, variance: 1 });
  assert.deepEqual(first, { count: 1, mean: 5, m2: 0, variance: 0 });
});

test('online update registry accepts its full prior result as the next state', () => {
  const registry = createRegistry(coreCapabilities);
  let state = { count: 0, mean: 0, m2: 0 };
  for (const value of [1, 2, 3]) {
    state = registry.execute('statistics.onlineUpdate', { state, value }).result;
  }
  assert.deepEqual(state, { count: 3, mean: 2, m2: 2, variance: 2 / 3 });

  const staleDerivedVariance = registry.execute('statistics.onlineUpdate', {
    state: { count: 2, mean: 1.5, m2: 0.5, variance: 999 }, value: 3
  }).result;
  assert.deepEqual(staleDerivedVariance, { count: 3, mean: 2, m2: 2, variance: 2 / 3 });
  assert.throws(() => onlineUpdate({ state: { count: 2, mean: 1.5, m2: 0.5, variance: -1 }, value: 3 }), /state.variance.*nonnegative/i);
  assert.throws(() => onlineUpdate({ state: { count: 2, mean: 1.5, m2: 0.5, variance: Infinity }, value: 3 }), /state.variance.*finite/i);
});

test('covariance respects denominator and correlation is scale-free', () => {
  assert.deepEqual(covariance({ x: [2, 4, 6], y: [1, 3, 5], denominator: 'population' }), { value: 8 / 3 });
  assert.deepEqual(covariance({ x: [2, 4, 6], y: [1, 3, 5], denominator: 'sample' }), { value: 4 });
  close(correlation({ x: [2, 4, 6], y: [1, 3, 5] }).value, 1);
  close(correlation({ x: [2, 4, 6], y: [5, 3, 1] }).value, -1);
});

test('z scores use population spread and paired differences preserve pairing', () => {
  const z = zScores({ values: [2, 4, 6], denominator: 'population' });
  close(z.mean, 4);
  close(z.standardDeviation, Math.sqrt(8 / 3));
  close(z.values[0], -Math.sqrt(3 / 2));
  close(z.values[1], 0);
  close(z.values[2], Math.sqrt(3 / 2));
  assert.deepEqual(pairedDifferences({ x: [4, 8, 3], y: [1, 5, 7] }), { values: [3, 3, -4] });
});

test('Welch group comparison reports an independent-groups standard error and degrees of freedom', () => {
  const result = welchMeanDifference({ a: [2, 4, 6], b: [1, 2, 3] });
  close(result.meanA, 4);
  close(result.meanB, 2);
  close(result.difference, 2);
  close(result.standardError, Math.sqrt(5 / 3));
  close(result.degreesOfFreedom, 50 / 17);
  close(result.testStatistic, 2 / Math.sqrt(5 / 3));
});

test('invalid, mismatched, singleton-sample and constant-correlation inputs fail clearly', () => {
  assert.throws(() => mean({ values: [] }), /at least 1/i);
  assert.throws(() => mean({ values: [1, Infinity] }), /finite/i);
  assert.throws(() => variance({ values: [7], denominator: 'sample' }), /at least two/i);
  assert.throws(() => variance({ values: [1, 2], denominator: 'biased' }), /denominator/i);
  assert.throws(() => weightedMean({ values: [1, 2], weights: [1] }), /same length/i);
  assert.throws(() => weightedMean({ values: [1, 2], weights: [0, 0] }), /positive total/i);
  assert.throws(() => weightedVariance({ values: [1, 2], weights: [1, -1] }), /nonnegative/i);
  assert.throws(() => covariance({ x: [1, 2], y: [1] }), /same length/i);
  assert.throws(() => correlation({ x: [1, 1, 1], y: [2, 3, 4] }), /zero variance/i);
  assert.throws(() => zScores({ values: [5, 5, 5] }), /zero variance/i);
  assert.throws(() => pairedDifferences({ x: [1, 2], y: [1] }), /same length/i);
  assert.throws(() => welchMeanDifference({ a: [3, 3], b: [2, 2] }), /standard error/i);
  assert.throws(() => onlineUpdate({ state: { count: 1, mean: 2, m2: 1 }, value: 3 }), /one-value state/i);
});

test('statistical helpers do not mutate the supplied arrays', () => {
  const values = [1, 2, 3];
  const weights = [3, 2, 1];
  const x = [2, 4, 6];
  const y = [1, 3, 5];
  const before = structuredClone({ values, weights, x, y });
  mean({ values });
  variance({ values, denominator: 'sample' });
  weightedMean({ values, weights });
  weightedVariance({ values, weights });
  onlineMoments({ values, denominator: 'sample' });
  covariance({ x, y, denominator: 'sample' });
  correlation({ x, y });
  zScores({ values });
  pairedDifferences({ x, y });
  assert.deepEqual({ values, weights, x, y }, before);
});
