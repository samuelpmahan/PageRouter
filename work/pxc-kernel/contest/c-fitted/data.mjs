// Deterministic datasets with a known relationship. No randomness anywhere.
// Feature j of row i is ((i * mult_j) mod rows) / 2 - rows / 4, a permutation of an evenly spaced grid
// (mult_j coprime with rows). Noise is a fixed pattern in [-0.5, 0.5].
const MULT = [5, 7];

export function regressionData({ rows = 24, weights = [0.75], intercept = 2, groupCount = 8, noise = true } = {}) {
  const matrix = []; const targets = []; const groups = [];
  for (let i = 0; i < rows; i += 1) {
    const x = weights.map((_, j) => ((i * MULT[j]) % rows) / 2 - rows / 4);
    const e = noise ? (((i * 37) % 11) - 5) / 10 : 0;
    matrix.push(x);
    targets.push(intercept + x.reduce((s, v, j) => s + v * weights[j], 0) + e);
    groups.push((i % groupCount) + 1);
  }
  return { matrix, targets, groups, truth: { intercept, weights } };
}

/** Two well separated blobs of points with a fixed jitter pattern, in two dimensions. */
export function blobs({ perBlob = 7, centres = [[1, 1], [8, 7]] } = {}) {
  const points = [];
  centres.forEach((c, b) => {
    for (let i = 0; i < perBlob; i += 1) {
      const dx = (((i * 5 + b * 3) % 7) - 3) / 3;
      const dy = (((i * 3 + b * 2) % 5) - 2) / 2.5;
      points.push([c[0] + dx, c[1] + dy]);
    }
  });
  return points;
}
