import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, median, count, sum, extrema, range, rank, empiricalCdf, histogram, describe, robustSummary, capabilities } from '../../src/statistics/order.mjs';

test('type 7 quantiles interpolate and preserve input', () => {
  const values = [4, 1, 3, 2], before = [...values];
  assert.equal(quantile({ values, probability: 0.25 }).value, 1.75);
  assert.equal(median({ values }).value, 2.5);
  assert.equal(quantile({ values: [8], probability: 1 }).value, 8);
  assert.deepEqual(values, before);
  assert.equal(quantile({ values: [-1e308, 1e308], probability: 0.5 }).value, 0);
});

test('ranks use explicit one-based tie policies', () => {
  const values = [20, 10, 10, 30];
  assert.deepEqual(rank({ values }).ranks, [3, 1.5, 1.5, 4]);
  assert.deepEqual(rank({ values, method: 'min' }).ranks, [3, 1, 1, 4]);
  assert.deepEqual(rank({ values, method: 'max' }).ranks, [3, 2, 2, 4]);
  assert.deepEqual(rank({ values, method: 'dense' }).ranks, [2, 1, 1, 3]);
  assert.deepEqual(rank({ values, method: 'ordinal' }).ranks, [3, 1, 2, 4]);
});

test('count and sum accept empty input while extrema and range require observations', () => {
  assert.deepEqual(count({ values: [] }), { value: 0 });
  assert.deepEqual(sum({ values: [] }), { value: 0 });
  assert.deepEqual(count({ values: [4, -1, 4] }), { value: 3 });
  assert.deepEqual(sum({ values: [1e16, 1, -1e16] }), { value: 1 });
  assert.deepEqual(extrema({ values: [3, -2, 7, 7] }), { min: -2, max: 7 });
  assert.deepEqual(range({ values: [3, -2, 7, 7] }), { value: 9 });
  assert.throws(() => extrema({ values: [] }), /not be empty/i);
  assert.throws(() => range({ values: [-1e308, 1e308] }), /finite number range/i);
  assert.throws(() => sum({ values: [Number.MAX_VALUE, Number.MAX_VALUE] }), /finite number range/i);
});

test('empirical CDF counts ties at or below x and handles query order', () => {
  assert.deepEqual(empiricalCdf({ values: [4, 2, 2, 1], points: [2, 0, 5] }).points,
    [{ x: 2, y: 0.75 }, { x: 0, y: 0 }, { x: 5, y: 1 }]);
});

test('histogram uses left-closed bins and includes the rightmost edge', () => {
  assert.deepEqual(histogram({ values: [0, 1, 2, 3, 4], bins: [0, 2, 4] }).bins,
    [{ x0: 0, x1: 2, count: 2 }, { x0: 2, x1: 4, count: 3 }]);
  assert.deepEqual(histogram({ values: [7, 7], bins: 5 }).bins, [{ x0: 6.5, x1: 7.5, count: 2 }]);
  assert.throws(() => histogram({ values: [Number.MAX_VALUE, Number.MAX_VALUE], bins: 1 }), /representable precision/i);
  assert.throws(() => histogram({ values: [0, 1], bins: [0, 1, 1 + Number.EPSILON / 2] }), /strictly increasing/i);
  assert.throws(() => histogram({ values: [0, 1], bins: Array(10003).fill(0).map((_, i) => i) }));
});

test('descriptive and robust summaries have independent numeric fixtures', () => {
  assert.deepEqual(describe({ values: [1, 2, 3, 4], denominator: 'population' }),
    { count: 4, mean: 2.5, variance: 1.25, standardDeviation: Math.sqrt(1.25), min: 1, q1: 1.75, median: 2.5, q3: 3.25, max: 4 });
  assert.deepEqual(robustSummary({ values: [1, 2, 3, 4, 100] }),
    { count: 5, median: 3, mad: 1, q1: 2, q3: 4, iqr: 2 });
  assert.throws(() => describe({ values: [3] }));
  assert.throws(() => robustSummary({ values: [-1e308, -1e308, 1e308, 1e308] }), /finite number range/i);
});

test('order capabilities publish schema, examples and real declared composition', () => {
  const byId = new Map(capabilities.map(c => [c.id, c]));
  assert.equal(byId.get('statistics.median').kind, 'composed');
  assert.deepEqual(byId.get('statistics.median').dependsOn, ['statistics.quantile']);
  for (const capability of capabilities) for (const example of capability.examples) assert.ok(example.expected);
});

test('invalid and degenerate inputs fail explicitly', () => {
  assert.throws(() => quantile({ values: [], probability: 0.5 }));
  assert.throws(() => quantile({ values: [1, Infinity], probability: 0.5 }));
  assert.throws(() => quantile({ values: [1], probability: 1.1 }));
  assert.throws(() => rank({ values: [1], method: 'random' }));
  assert.throws(() => empiricalCdf({ values: [1], points: [NaN] }));
  assert.throws(() => histogram({ values: [1], bins: [0, 2, 1] }));
  assert.throws(() => histogram({ values: [1], bins: 10001 }));
});
