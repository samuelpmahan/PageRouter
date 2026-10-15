// Contest A: statistics and linear algebra. Pure calculations, some imperative, some composed.
// Purpose: the first necessity test of the kernel core.

const num = { type: 'number' };
const vec = { type: 'array', minItems: 1, items: num };
const mat = { type: 'array', minItems: 1, items: vec };
const denominator = { type: 'string', enum: ['sample', 'population'] };

export function register(world) {
  const C = (def) => world.contract(def);
  const I = (def) => world.implement(def);

  // ---- statistics atoms
  C({ id: 'stat.mean', in: { values: vec }, out: { value: num },
    examples: [{ in: { values: [2, 4, 6] }, out: { value: 4 } }, { in: { values: [5] }, out: { value: 5 } }] });
  I({ id: 'stat.mean/sum', implements: 'stat.mean', run: ({ values }) => ({ value: values.value.reduce((a, b) => a + b, 0) / values.value.length }) });

  C({ id: 'stat.variance', in: { values: vec, denominator }, out: { value: num }, tolerance: 1e-12,
    examples: [
      { in: { values: [2, 4, 6], denominator: 'population' }, out: { value: 8 / 3 } },
      { in: { values: [2, 4, 6], denominator: 'sample' }, out: { value: 4 } },
      { in: { values: [1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16], denominator: 'sample' }, out: { value: 30 } },
    ] });
  I({ id: 'stat.variance/two-pass', implements: 'stat.variance', run: ({ values, denominator: d }) => {
    const v = values.value; const n = v.length;
    if (d.value === 'sample' && n < 2) throw new Error('sample variance needs two values');
    const m = v.reduce((a, b) => a + b, 0) / n;
    return { value: v.reduce((a, x) => a + (x - m) ** 2, 0) / (d.value === 'sample' ? n - 1 : n) };
  } });
  I({ id: 'stat.variance/welford', implements: 'stat.variance', run: ({ values, denominator: d }) => {
    let n = 0; let mean = 0; let m2 = 0;
    for (const x of values.value) { n += 1; const delta = x - mean; mean += delta / n; m2 += delta * (x - mean); }
    if (d.value === 'sample' && n < 2) throw new Error('sample variance needs two values');
    return { value: m2 / (d.value === 'sample' ? n - 1 : n) };
  } });
  world.select('stat.variance', 'stat.variance/two-pass');

  C({ id: 'stat.standardDeviation', in: { values: vec, denominator }, out: { value: num }, tolerance: 1e-12,
    examples: [{ in: { values: [2, 4, 4, 4, 5, 5, 7, 9], denominator: 'population' }, out: { value: 2 } }] });
  I({ id: 'stat.standardDeviation/sqrt-variance', implements: 'stat.standardDeviation', uses: ['stat.variance'],
    run: (input, ctx) => ({ value: Math.sqrt(ctx.call('stat.variance', input).value.value) }) });

  C({ id: 'vec.standardize', in: { values: vec, center: num, scale: num }, out: { values: vec },
    examples: [{ in: { values: [2, 4, 6], center: 4, scale: 2 }, out: { values: [-1, 0, 1] } }] });
  I({ id: 'vec.standardize/map', implements: 'vec.standardize', run: ({ values, center, scale }) => {
    if (scale.value === 0) throw new Error('scale is zero: constant data has no standard score');
    return { values: values.value.map((x) => (x - center.value) / scale.value) };
  } });

  // ---- composed: z-scores, declared as data
  C({ id: 'stat.zScores', in: { values: vec }, out: { values: vec, mean: num, standardDeviation: num }, tolerance: 1e-12,
    examples: [{ in: { values: [2, 4, 6] }, out: { values: [-1.224744871391589, 0, 1.224744871391589], mean: 4, standardDeviation: 1.632993161855452 } }] });
  world.compose({ id: 'stat.zScores/composed', implements: 'stat.zScores',
    steps: [
      { name: 'mean', call: 'stat.mean', bind: { values: '$in.values' } },
      { name: 'sd', call: 'stat.standardDeviation', bind: { values: '$in.values', denominator: { literal: 'population' } } },
      { name: 'z', call: 'vec.standardize', bind: { values: '$in.values', center: 'mean.value', scale: 'sd.value' } },
    ],
    returns: { values: 'z.values', mean: 'mean.value', standardDeviation: 'sd.value' } });

  // ---- linear algebra
  C({ id: 'lin.dot', in: { a: vec, b: vec }, out: { value: num },
    examples: [{ in: { a: [1, 2, 3], b: [4, 5, 6] }, out: { value: 32 } }] });
  I({ id: 'lin.dot/loop', implements: 'lin.dot', run: ({ a, b }) => {
    if (a.value.length !== b.value.length) throw new Error(`dot: length ${a.value.length} vs ${b.value.length}`);
    return { value: a.value.reduce((s, x, i) => s + x * b.value[i], 0) };
  } });

  C({ id: 'lin.transpose', in: { matrix: mat }, out: { matrix: mat },
    examples: [{ in: { matrix: [[1, 2, 3], [4, 5, 6]] }, out: { matrix: [[1, 4], [2, 5], [3, 6]] } }] });
  I({ id: 'lin.transpose/loop', implements: 'lin.transpose', run: ({ matrix }) => {
    const m = matrix.value;
    return { matrix: m[0].map((_, j) => m.map((row) => row[j])) };
  } });

  C({ id: 'lin.matvec', in: { matrix: mat, vector: vec }, out: { vector: vec },
    examples: [{ in: { matrix: [[1, 2], [3, 4]], vector: [1, 1] }, out: { vector: [3, 7] } }] });
  I({ id: 'lin.matvec/rows', implements: 'lin.matvec', uses: ['lin.dot'],
    run: ({ matrix, vector }, ctx) => ({
      vector: matrix.value.map((_, i) => ctx.call('lin.dot', { a: ctx.at(matrix, i), b: vector }).value.value),
    }) });

  C({ id: 'lin.matmul', in: { a: mat, b: mat }, out: { matrix: mat },
    examples: [{ in: { a: [[1, 2], [3, 4]], b: [[5, 6], [7, 8]] }, out: { matrix: [[19, 22], [43, 50]] } }] });
  I({ id: 'lin.matmul/columns', implements: 'lin.matmul', uses: ['lin.transpose', 'lin.matvec'],
    run: ({ a, b }, ctx) => {
      const bt = ctx.call('lin.transpose', { matrix: b }).matrix;
      const cols = bt.value.map((_, j) => ctx.call('lin.matvec', { matrix: a, vector: ctx.at(bt, j) }).vector.value);
      return { matrix: a.value.map((_, i) => cols.map((col) => col[i])) };
    } });

  C({ id: 'lin.solve', in: { matrix: mat, vector: vec }, out: { vector: vec }, tolerance: 1e-10,
    examples: [{ in: { matrix: [[2, 1], [1, 3]], vector: [3, 5] }, out: { vector: [0.8, 1.4] } },
               { in: { matrix: [[0, 1], [1, 0]], vector: [2, 3] }, out: { vector: [3, 2] } }] });
  I({ id: 'lin.solve/gauss-partial-pivot', implements: 'lin.solve', run: ({ matrix, vector }) => {
    const n = matrix.value.length;
    const a = matrix.value.map((row, i) => [...row, vector.value[i]]);
    for (let k = 0; k < n; k += 1) {
      let p = k;
      for (let i = k + 1; i < n; i += 1) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
      if (Math.abs(a[p][k]) < 1e-12) throw new Error('matrix is singular to working precision');
      [a[k], a[p]] = [a[p], a[k]];
      for (let i = k + 1; i < n; i += 1) {
        const f = a[i][k] / a[k][k];
        for (let j = k; j <= n; j += 1) a[i][j] -= f * a[k][j];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i -= 1) {
      let s = a[i][n];
      for (let j = i + 1; j < n; j += 1) s -= a[i][j] * x[j];
      x[i] = s / a[i][i];
    }
    return { vector: x };
  } });

  // ---- composed: least squares via normal equations, declared as data
  C({ id: 'lin.leastSquares', in: { matrix: mat, vector: vec }, out: { coefficients: vec }, tolerance: 1e-9,
    examples: [{ in: { matrix: [[1, 0], [1, 1], [1, 2], [1, 3]], vector: [1, 3, 5, 7] }, out: { coefficients: [1, 2] } }] });
  world.compose({ id: 'lin.leastSquares/normal-equations', implements: 'lin.leastSquares',
    steps: [
      { name: 'xt', call: 'lin.transpose', bind: { matrix: '$in.matrix' } },
      { name: 'gram', call: 'lin.matmul', bind: { a: 'xt.matrix', b: '$in.matrix' } },
      { name: 'moment', call: 'lin.matvec', bind: { matrix: 'xt.matrix', vector: '$in.vector' } },
      { name: 'beta', call: 'lin.solve', bind: { matrix: 'gram.matrix', vector: 'moment.vector' } },
    ],
    returns: { coefficients: 'beta.vector' } });
}
