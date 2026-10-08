import { mean as coreMean, variance as coreVariance } from './core.mjs';

// Order and distribution statistics. All functions accept object inputs and never mutate them.
const finiteArray = (values, name = 'values') => {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  if (values.length === 0) throw new RangeError(`${name} must not be empty`);
  values.forEach((x, i) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${name}[${i}] must be finite`); });
  return values;
};
const sorted = values => [...values].sort((a, b) => a - b);
const probability = p => { if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('probability must be between 0 and 1'); };
const anyFiniteArray = values => {
  if (!Array.isArray(values)) throw new TypeError('values must be an array');
  values.forEach((x, i) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`values[${i}] must be finite`); });
  return values;
};

/** Hyndman-Fan type 7 quantile: h=(n-1)p, linearly interpolate adjacent order statistics. */
export function quantile({ values, probability: p }) {
  finiteArray(values); probability(p);
  const xs = sorted(values), h = (xs.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h), t = h - lo;
  // Weighted interpolation avoids overflowing (hi - lo) for opposite extreme signs.
  const value = Math.sign(xs[lo]) !== Math.sign(xs[hi]) ? (1 - t) * xs[lo] + t * xs[hi] : xs[lo] + (xs[hi] - xs[lo]) * t;
  if (!Number.isFinite(value)) throw new RangeError('quantile result is outside the finite number range');
  return { value };
}

export function median({ values }) { return quantile({ values, probability: 0.5 }); }

/** Count finite observations; the empty array has count zero. */
export function count({ values }) { anyFiniteArray(values); return { value: values.length }; }

/** Neumaier compensated sum; empty input sums to zero and overflow is rejected. */
export function sum({ values }) {
  anyFiniteArray(values);
  let total = 0, correction = 0;
  for (const value of values) {
    const next = total + value;
    if (!Number.isFinite(next)) throw new RangeError('sum is outside the finite number range');
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    if (!Number.isFinite(correction)) throw new RangeError('sum is outside the finite number range');
    total = next;
  }
  const value = total + correction;
  if (!Number.isFinite(value)) throw new RangeError('sum is outside the finite number range');
  return { value };
}

/** Minimum and maximum of a nonempty finite numeric array. */
export function extrema({ values }) {
  finiteArray(values);
  return { min: values.reduce((a, b) => Math.min(a, b), Infinity), max: values.reduce((a, b) => Math.max(a, b), -Infinity) };
}

/** Difference between maximum and minimum; rejects a range wider than finite doubles. */
export function range({ values }) {
  const { min, max } = extrema({ values }), value = max - min;
  if (!Number.isFinite(value)) throw new RangeError('range is outside the finite number range');
  return { value };
}

/** Ranks are one-based. Ties support average, min, max, dense, or stable input-order ordinal ranks. */
export function rank({ values, method = 'average' }) {
  finiteArray(values);
  if (!['average', 'min', 'max', 'dense', 'ordinal'].includes(method)) throw new RangeError('method must be average, min, max, dense, or ordinal');
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = Array(values.length); let dense = 0;
  for (let i = 0; i < order.length;) {
    let j = i + 1; while (j < order.length && order[j].value === order[i].value) j++;
    dense++;
    for (let k = i; k < j; k++) {
      const r = method === 'ordinal' ? k + 1 : method === 'dense' ? dense : method === 'min' ? i + 1 : method === 'max' ? j : (i + 1 + j) / 2;
      ranks[order[k].index] = r;
    }
    i = j;
  }
  return { ranks };
}

/** Empirical CDF at each requested point: fraction of observations <= x. */
export function empiricalCdf({ values, points }) {
  finiteArray(values);
  if (!Array.isArray(points)) throw new TypeError('points must be an array');
  points.forEach((x, i) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`points[${i}] must be finite`); });
  const xs = sorted(values);
  return { points: points.map(x => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (xs[m] <= x) lo = m + 1; else hi = m; } return { x, y: lo / xs.length }; }) };
}

/** Histogram accepts a positive integer bin count or strictly increasing finite edge array. */
export function histogram({ values, bins = 10 }) {
  finiteArray(values);
  let edges;
  if (Number.isInteger(bins) && bins > 0 && bins <= 10000) {
    const min = values.reduce((a, b) => Math.min(a, b), Infinity), max = values.reduce((a, b) => Math.max(a, b), -Infinity);
    if (min === max) edges = [min - Math.max(0.5, Math.abs(min) * Number.EPSILON), max + Math.max(0.5, Math.abs(max) * Number.EPSILON)];
    else { const width = (max - min) / bins; if (!Number.isFinite(width)) throw new RangeError('value range is too wide to histogram'); edges = Array.from({ length: bins + 1 }, (_, i) => i === bins ? max : min + width * i); }
  } else if (Array.isArray(bins) && bins.length >= 2 && bins.length <= 10001 && bins.every(Number.isFinite) && bins.every((x, i) => i === 0 || x > bins[i - 1])) edges = [...bins];
  else throw new RangeError('bins must be a positive integer or strictly increasing finite edge array');
  if (edges.length < 2 || edges.some((x, i) => !Number.isFinite(x) || (i > 0 && x <= edges[i - 1]))) throw new RangeError('histogram edges must be finite and strictly increasing at representable precision');
  const counts = Array(edges.length - 1).fill(0);
  for (const x of values) {
    if (x < edges[0] || x > edges.at(-1)) continue;
    let i = x === edges.at(-1) ? counts.length - 1 : 0;
    if (x !== edges.at(-1)) { while (i + 1 < edges.length && x >= edges[i + 1]) i++; }
    counts[i]++;
  }
  return { bins: counts.map((count, i) => ({ x0: edges[i], x1: edges[i + 1], count })) };
}

/** Standalone descriptive summary; denominator selects sample (n-1) or population (n). */
export function describe({ values, denominator = 'sample' }) {
  finiteArray(values);
  if (!['sample', 'population'].includes(denominator)) throw new RangeError('denominator must be sample or population');
  if (denominator === 'sample' && values.length < 2) throw new RangeError('sample variance requires at least two values');
  const mean = coreMean({ values }).value;
  const variance = coreVariance({ values, denominator }).value;
  return { count: values.length, mean, variance, standardDeviation: Math.sqrt(variance), min: values.reduce((a, b) => Math.min(a, b), Infinity), q1: quantile({ values, probability: 0.25 }).value, median: median({ values }).value, q3: quantile({ values, probability: 0.75 }).value, max: values.reduce((a, b) => Math.max(a, b), -Infinity) };
}

/** Standalone median and IQR summary with the unscaled median absolute deviation. */
export function robustSummary({ values }) {
  finiteArray(values);
  const med = median({ values }).value, q1 = quantile({ values, probability: 0.25 }).value, q3 = quantile({ values, probability: 0.75 }).value;
  const mad = median({ values: values.map(x => Math.abs(x - med)) }).value, iqr = q3 - q1;
  if (!Number.isFinite(mad) || !Number.isFinite(iqr)) throw new RangeError('robust summary result is outside the finite number range');
  return { count: values.length, median: med, mad, q1, q3, iqr };
}

const arraySchema = { type: 'array', minItems: 1, items: { type: 'number' } };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const val = { type: 'number' };
const qInput = obj({ values: arraySchema, probability: { type: 'number', minimum: 0, maximum: 1 } });
const medianInput = obj({ values: arraySchema });
const maybeEmptyArraySchema = { type: 'array', items: { type: 'number' } };
const countInput = obj({ values: maybeEmptyArraySchema });
const extremaInput = medianInput;
const rankInput = obj({ values: arraySchema, method: { type: 'string', enum: ['average', 'min', 'max', 'dense', 'ordinal'] } }, ['values']);
const cdfInput = obj({ values: arraySchema, points: { type: 'array', items: val } });
const histogramInput = obj({ values: arraySchema, bins: { type: 'integer', minimum: 1, maximum: 10000 }, edges: { type: 'array', minItems: 2, items: val } }, ['values']);
const statsInput = obj({ values: arraySchema, denominator: { type: 'string', enum: ['sample', 'population'] } }, ['values']);
const qExpected = { value: 2.5 }, sample = [1, 2, 3, 4];

export const capabilities = [
  { id: 'statistics.quantile', title: 'Quantile', description: 'Interpolated sample quantile using Hyndman-Fan type 7.', kind: 'atomic', dependsOn: [], inputSchema: qInput, outputSchema: obj({ value: val }), examples: [{ input: { values: sample, probability: 0.5 }, expected: qExpected }], run: quantile, formula: 'h=(n-1)p; interpolate x[floor(h)] and x[ceil(h)]', caveats: 'Linear interpolation; p is in [0,1].' },
  { id: 'statistics.median', title: 'Median', description: 'Middle value under the type 7 quantile convention.', kind: 'composed', dependsOn: ['statistics.quantile'], inputSchema: medianInput, outputSchema: obj({ value: val }), examples: [{ input: { values: sample }, expected: { value: 2.5 } }], run: (input, ctx) => ctx.call('statistics.quantile', { values: input.values, probability: 0.5 }) },
  { id: 'statistics.count', title: 'Count', description: 'Count finite numeric observations; empty input has count zero.', kind: 'atomic', dependsOn: [], inputSchema: countInput, outputSchema: obj({ value: { type: 'integer', minimum: 0 } }), examples: [{ input: { values: [4, -1, 4] }, expected: { value: 3 } }, { input: { values: [] }, expected: { value: 0 } }], run: count },
  { id: 'statistics.sum', title: 'Sum', description: 'Add finite values using Neumaier compensated summation.', kind: 'atomic', dependsOn: [], inputSchema: countInput, outputSchema: obj({ value: val }), examples: [{ input: { values: [1e16, 1, -1e16] }, expected: { value: 1 } }, { input: { values: [] }, expected: { value: 0 } }], run: sum, formula: 'Compensated floating-point accumulation; the final result must remain finite.' },
  { id: 'statistics.extrema', title: 'Minimum and maximum', description: 'Return the smallest and largest finite values.', kind: 'atomic', dependsOn: [], inputSchema: extremaInput, outputSchema: obj({ min: val, max: val }), examples: [{ input: { values: [3, -2, 7, 7] }, expected: { min: -2, max: 7 } }], run: extrema },
  { id: 'statistics.range', title: 'Range', description: 'Compute maximum minus minimum through the extrema capability.', kind: 'composed', dependsOn: ['statistics.extrema'], inputSchema: extremaInput, outputSchema: obj({ value: val }), examples: [{ input: { values: [3, -2, 7, 7] }, expected: { value: 9 } }], run: (input, ctx) => { const { min, max } = ctx.call('statistics.extrema', { values: input.values }); const value = max - min; if (!Number.isFinite(value)) throw new RangeError('range is outside the finite number range'); return { value }; }, formula: 'max(values) - min(values)' },
  { id: 'statistics.rank', title: 'Ranks', description: 'One-based ranks with explicit tie handling.', kind: 'atomic', dependsOn: [], inputSchema: rankInput, outputSchema: obj({ ranks: { type: 'array', items: val } }), examples: [{ input: { values: [30, 10, 10, 20] }, expected: { ranks: [4, 1.5, 1.5, 3] } }], run: rank, caveats: 'Ordinal breaks ties by original input order.' },
  { id: 'statistics.empiricalCdf', title: 'Empirical CDF', description: 'Fraction of observations at or below each query point.', kind: 'atomic', dependsOn: [], inputSchema: cdfInput, outputSchema: obj({ points: { type: 'array', items: obj({ x: val, y: val }) } }), examples: [{ input: { values: [1, 2, 2, 4], points: [0, 2, 5] }, expected: { points: [{ x: 0, y: 0 }, { x: 2, y: 0.75 }, { x: 5, y: 1 }] } }], run: empiricalCdf, formula: 'F_n(x)=count(x_i<=x)/n' },
  { id: 'statistics.histogram', title: 'Histogram', description: 'Counts in equal-width bins or explicit edges; rightmost edge is inclusive.', kind: 'atomic', dependsOn: [], inputSchema: histogramInput, outputSchema: obj({ bins: { type: 'array', items: obj({ x0: val, x1: val, count: { type: 'integer', minimum: 0 } }) } }), examples: [{ input: { values: [0, 1, 2, 3], edges: [0, 2, 3] }, expected: { bins: [{ x0: 0, x1: 2, count: 2 }, { x0: 2, x1: 3, count: 2 }] } }], run: input => { if (input.edges && input.bins !== undefined) throw new RangeError('provide bins or edges, not both'); return histogram({ values: input.values, bins: input.edges ?? input.bins ?? 10 }); }, caveats: 'Values outside explicit edges are omitted; at most 10,000 equal-width bins or 10,000 explicit intervals.' },
  { id: 'statistics.describe', title: 'Descriptive summary', description: 'Combines count, range, moments, and quartiles.', kind: 'composed', dependsOn: ['statistics.mean', 'statistics.variance', 'statistics.quantile'], inputSchema: statsInput, outputSchema: obj({ count: { type: 'integer' }, mean: val, variance: val, standardDeviation: val, min: val, q1: val, median: val, q3: val, max: val }), examples: [{ input: { values: [1, 2, 3, 4], denominator: 'population' }, expected: { count: 4, mean: 2.5, variance: 1.25, standardDeviation: Math.sqrt(1.25), min: 1, q1: 1.75, median: 2.5, q3: 3.25, max: 4 } }], run: (input, ctx) => { const m = ctx.call('statistics.mean', { values: input.values }); const v = ctx.call('statistics.variance', { values: input.values, denominator: input.denominator ?? 'sample' }); const q1 = ctx.call('statistics.quantile', { values: input.values, probability: 0.25 }); const med = ctx.call('statistics.quantile', { values: input.values, probability: 0.5 }); const q3 = ctx.call('statistics.quantile', { values: input.values, probability: 0.75 }); return { count: input.values.length, mean: m.value, variance: v.value, standardDeviation: Math.sqrt(v.value), min: input.values.reduce((a, b) => Math.min(a, b), Infinity), q1: q1.value, median: med.value, q3: q3.value, max: input.values.reduce((a, b) => Math.max(a, b), -Infinity) }; }, caveats: 'Variance denominator is explicit; sample variance is undefined for a singleton and will fail in the variance capability.' },
  { id: 'statistics.robustSummary', title: 'Robust summary', description: 'Median, median absolute deviation, and interquartile range.', kind: 'composed', dependsOn: ['statistics.quantile'], inputSchema: medianInput, outputSchema: obj({ count: { type: 'integer' }, median: val, mad: val, q1: val, q3: val, iqr: val }), examples: [{ input: { values: [1, 2, 3, 4, 100] }, expected: { count: 5, median: 3, mad: 1, q1: 2, q3: 4, iqr: 2 } }], run: (input, ctx) => { const med = ctx.call('statistics.quantile', { values: input.values, probability: 0.5 }); const q1 = ctx.call('statistics.quantile', { values: input.values, probability: 0.25 }); const q3 = ctx.call('statistics.quantile', { values: input.values, probability: 0.75 }); const mad = ctx.call('statistics.quantile', { values: input.values.map(x => Math.abs(x - med.value)), probability: 0.5 }); return { count: input.values.length, median: med.value, mad: mad.value, q1: q1.value, q3: q3.value, iqr: q3.value - q1.value }; } }
];
