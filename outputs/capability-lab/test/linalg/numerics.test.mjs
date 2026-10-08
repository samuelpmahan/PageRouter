import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import {
  rowEchelon,
  matrixRank,
  luDecompose,
  determinant,
  solve,
  inverse,
  qr,
  leastSquares,
  cholesky,
  symmetricEigen,
  quadraticFormOfInverse,
  numericalCapabilities,
} from '../../src/linalg/numerics.mjs';
import { capabilities as allCapabilities } from '../../src/linalg/index.mjs';

const close = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
};

const matrixClose = (actual, expected, tolerance = 1e-10) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(actual[i].length, expected[i].length);
    for (let j = 0; j < expected[i].length; j += 1) close(actual[i][j], expected[i][j], tolerance);
  }
};

const multiply = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((sum, x, k) => sum + x * b[k][j], 0)));
const transpose = (a) => a[0].map((_, j) => a.map((row) => row[j]));

test('row echelon and rank use scale-relative pivots', () => {
  const matrix = [[1e-100, 2e-100], [2e-100, 4e-100], [0, 1e-100]];
  const result = rowEchelon({ matrix, tolerance: 1e-12 });
  assert.deepEqual(result.pivotColumns, [0, 1]);
  assert.equal(matrixRank({ matrix, tolerance: 1e-12 }), 2);
  assert.equal(matrixRank({ matrix: [[1e100, 0], [0, 1e100]], tolerance: 1e-12 }), 2);
});

test('pivoted LU reconstructs P*A as L*U and determinant has an independent fixture', () => {
  const matrix = [[0, 2, 1], [1, 1, 0], [2, 0, 1]];
  const { lower, upper, permutation } = luDecompose({ matrix });
  const permuted = permutation.map((row) => matrix[row]);
  matrixClose(multiply(lower, upper), permuted);
  close(determinant({ matrix: [[2, 1, 3], [0, -1, 2], [4, 1, 9]] }), -2);
});

test('pivoted solve and inverse return finite, independently checked results', () => {
  const matrix = [[0, 2], [1, 3]];
  const solution = solve({ matrix, vector: [4, 7] });
  close(solution[0], 1);
  close(solution[1], 2);
  const inv = inverse({ matrix });
  matrixClose(multiply(matrix, inv), [[1, 0], [0, 1]]);
});

test('pivoted solve remains scale-relative and rejects a near-singular pivot', () => {
  for (const scale of [1e-200, 1, 1e200]) {
    const matrix = [[0, 2 * scale], [scale, 3 * scale]];
    const solution = solve({ matrix, vector: [4 * scale, 7 * scale] });
    close(solution[0], 1);
    close(solution[1], 2);
  }
  assert.throws(() => solve({ matrix: [[1, 1], [1, 1 + 1e-13]], vector: [2, 2 + 1e-13] }), /singular|rank/i);
});

test('Householder QR is stable for small and large scale and preserves orthogonality', () => {
  for (const scale of [1e-200, 1, 1e200]) {
    const matrix = [[3 * scale, 0], [4 * scale, 5 * scale], [0, 12 * scale]];
    const { q: qMatrix, r } = qr({ matrix });
    const reconstructed = multiply(qMatrix, r);
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = 0; j < matrix[0].length; j += 1) {
        close(reconstructed[i][j] / scale, matrix[i][j] / scale, 1e-9);
      }
    }
    matrixClose(multiply(transpose(qMatrix), qMatrix), [[1, 0], [0, 1]], 1e-9);
  }
  const huge = [[1e308, 0], [0, 1e308]];
  const hugeFactors = qr({ matrix: huge });
  matrixClose(hugeFactors.r, [[-1e308, 0], [0, -1e308]], 1e-12);
  assert.equal(hugeFactors.rank, 2);
});

test('QR rank counts independent later columns after a zero leading column', () => {
  const matrix = [[0, 1], [0, 0]];
  const { q: qMatrix, r, rank } = qr({ matrix });
  assert.equal(rank, 1);
  matrixClose(multiply(qMatrix, r), matrix);
});

test('least squares reports coefficients, residuals, and residual norm', () => {
  const matrix = [[1, 0], [1, 1], [1, 2], [1, 3]];
  const { solution, residuals, residualNorm, rank } = leastSquares({ matrix, vector: [1, 3, 5, 7] });
  assert.equal(rank, 2);
  close(solution[0], 1);
  close(solution[1], 2);
  assert.ok(residualNorm < 1e-10);
  assert.ok(residuals.every((value) => Math.abs(value) < 1e-10));
});

test('Cholesky factor reconstructs a symmetric positive definite matrix', () => {
  const matrix = [[4, 2], [2, 3]];
  const { lower } = cholesky({ matrix });
  matrixClose(multiply(lower, transpose(lower)), matrix);
});

test('Jacobi eigenpairs are sorted, orthonormal, and scale-relative', () => {
  for (const scale of [1e-100, 1, 1e100]) {
    const matrix = [[2 * scale, scale], [scale, 2 * scale]];
    const { eigenvalues, eigenvectors, converged } = symmetricEigen({ matrix });
    assert.equal(converged, true);
    close(eigenvalues[0] / scale, 3);
    close(eigenvalues[1] / scale, 1);
    matrixClose(multiply(transpose(eigenvectors), eigenvectors), [[1, 0], [0, 1]]);
    for (let col = 0; col < eigenvalues.length; col += 1) {
      for (let row = 0; row < matrix.length; row += 1) {
        const lhs = matrix[row].reduce((sum, value, k) => sum + value * eigenvectors[k][col], 0);
        close(lhs / scale, (eigenvalues[col] / scale) * eigenvectors[row][col]);
      }
    }
  }
});

test('inverse quadratic form computes v-transpose A-inverse v', () => {
  assert.deepEqual(quadraticFormOfInverse({ matrix: [[2, 0], [0, 4]], vector: [2, 4] }), { value: 6 });
});

test('singular, rank-deficient, nonsymmetric, and invalid inputs fail clearly', () => {
  assert.throws(() => solve({ matrix: [[1, 2], [2, 4]], vector: [1, 2] }), /singular|rank/i);
  assert.throws(() => leastSquares({ matrix: [[1, 2], [2, 4], [3, 6]], vector: [1, 2, 3] }), /rank/i);
  assert.throws(() => symmetricEigen({ matrix: [[1, 2], [0, 1]] }), /symmetric/i);
  assert.throws(() => cholesky({ matrix: [[1, 2], [2, 1]] }), /positive definite/i);
  assert.throws(() => determinant({ matrix: [[1, 2], [3, Number.NaN]] }), /finite/i);
  assert.throws(() => solve({ matrix: [[1, 0], [0, 1]], vector: [1, ,] }), /missing|finite/i);
  assert.throws(() => matrixRank({ matrix: [[1, 0], [, 1]] }), /missing/i);
  assert.throws(() => qr({ matrix: [[1, 2, 3], [4, 5, 6]] }), /rows.*columns|at least/i);
});

test('public numerical operations never mutate caller-owned arrays', () => {
  const matrix = [[3, 1], [1, 2]];
  const vector = [9, 8];
  const beforeMatrix = structuredClone(matrix);
  const beforeVector = [...vector];
  solve({ matrix, vector });
  inverse({ matrix });
  qr({ matrix });
  leastSquares({ matrix: [[1, 0], [1, 1], [1, 2]], vector: [1, 3, 5] });
  cholesky({ matrix });
  symmetricEigen({ matrix });
  assert.deepEqual(matrix, beforeMatrix);
  assert.deepEqual(vector, beforeVector);
});

test('composed descriptors call their declared lower-level capabilities', () => {
  const byId = new Map(allCapabilities.map((capability) => [capability.id, capability]));
  const calls = [];
  const ctx = { call(id, input) {
    calls.push(id);
    const capability = byId.get(id);
    assert.ok(capability, `missing dependency ${id}`);
    return capability.run(input, ctx);
  } };
  const leastSquaresDescriptor = byId.get('linalg.leastSquares');
  leastSquaresDescriptor.run({ matrix: [[1, 0], [1, 1], [1, 2]], vector: [1, 3, 5] }, ctx);
  for (const dependency of leastSquaresDescriptor.dependsOn) {
    assert.ok(calls.includes(dependency), `declared dependency was not called: ${dependency}`);
  }
  assert.ok(calls.indexOf('linalg.qr') < calls.indexOf('linalg.transpose'));
  assert.ok(calls.indexOf('linalg.transpose') < calls.indexOf('linalg.matvec'));
  assert.ok(calls.indexOf('linalg.backSubstitute') < calls.lastIndexOf('linalg.matvec'));
  calls.length = 0;
  byId.get('linalg.quadraticFormOfInverse').run({ matrix: [[2, 0], [0, 4]], vector: [2, 4] }, ctx);
  assert.ok(calls.includes('linalg.inverse'));
  assert.ok(calls.includes('linalg.solve'));
  assert.ok(calls.includes('linalg.luDecompose'));
});

test('every numerical descriptor example passes strict registry execution and exact replay', () => {
  const registry = createRegistry(allCapabilities, { source: 'numerics-tests', version: '1' });
  for (const capability of numericalCapabilities) {
    for (const example of capability.examples) {
      const receipt = registry.execute(capability.id, example.input);
      assert.deepEqual(receipt.result, example.expected, `${capability.id} example result`);
      assert.equal(registry.replay(receipt).matches, true, `${capability.id} example replay`);
    }
  }
  assert.equal(registry.get('linalg.leastSquares').order, 3);
  assert.equal(registry.get('linalg.quadraticFormOfInverse').order, 3);
});
