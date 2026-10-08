import {
  dot as basicDot,
  matvec as basicMatvec,
  norm as basicNorm,
  transpose as basicTranspose,
  vectorSubtract as basicVectorSubtract,
} from './basics.mjs';

const DEFAULT_TOLERANCE = 1e-12;
const MAX_EIGEN_ITERATIONS = 100_000;
const NUMBER_SCHEMA = { type: 'number' };
const TOLERANCE_SCHEMA = { type: 'number', minimum: 0, maximum: 0.9999999999999999 };
const VECTOR_SCHEMA = { type: 'array', minItems: 1, items: NUMBER_SCHEMA };
const MATRIX_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: { type: 'array', minItems: 1, items: NUMBER_SCHEMA },
};

function requireObject(input, label = 'input') {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  return input;
}

function readTolerance(value = DEFAULT_TOLERANCE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('tolerance must be a finite number in [0, 1)');
  }
  return value;
}

function readMatrix(value) {
  if (!Array.isArray(value) || value.length === 0 || !Array.isArray(value[0]) || value[0].length === 0) {
    throw new TypeError('matrix must be a nonempty rectangular array');
  }
  const columns = value[0].length;
  const matrix = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) throw new TypeError(`matrix row ${i} is missing`);
    const row = value[i];
    if (!Array.isArray(row) || row.length !== columns) {
      throw new TypeError(`matrix row ${i} has the wrong length; matrix must be rectangular`);
    }
    const copiedRow = [];
    for (let j = 0; j < columns; j += 1) {
      if (!Object.hasOwn(row, j)) throw new TypeError(`matrix[${i}][${j}] is missing`);
      const entry = row[j];
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw new TypeError(`matrix[${i}][${j}] must be finite`);
      }
      copiedRow.push(entry);
    }
    matrix.push(copiedRow);
  }
  return matrix;
}

function readVector(value, expectedLength, label = 'vector') {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty array`);
  if (expectedLength !== undefined && value.length !== expectedLength) {
    throw new RangeError(`${label} length must be ${expectedLength}`);
  }
  const vector = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i)) throw new TypeError(`${label}[${i}] is missing`);
    const entry = value[i];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new TypeError(`${label}[${i}] must be finite`);
    vector.push(entry);
  }
  return vector;
}

function readSquareMatrix(value) {
  const matrix = readMatrix(value);
  if (matrix.length !== matrix[0].length) throw new RangeError('matrix must be square');
  return matrix;
}

function maxAbs(matrix) {
  let scale = 0;
  for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  return scale;
}

function hypotValues(values) {
  return values.reduce((length, value) => Math.hypot(length, value), 0);
}

function checkFinite(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} overflowed the finite number range`);
  return value;
}

function schema(properties, required, additionalProperties = false) {
  return { type: 'object', properties, required, additionalProperties };
}

function matrixSchemaInput({ tolerance = false } = {}) {
  const properties = { matrix: MATRIX_SCHEMA };
  if (tolerance) properties.tolerance = TOLERANCE_SCHEMA;
  return schema(properties, ['matrix']);
}

function matrixVectorSchemaInput({ tolerance = false } = {}) {
  const properties = { matrix: MATRIX_SCHEMA, vector: VECTOR_SCHEMA };
  if (tolerance) properties.tolerance = TOLERANCE_SCHEMA;
  return schema(properties, ['matrix', 'vector']);
}

export function rowEchelon(input) {
  const { matrix: matrixInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readMatrix(matrixInput);
  const tolerance = readTolerance(toleranceInput);
  const rows = matrix.length;
  const columns = matrix[0].length;
  const scale = maxAbs(matrix);
  const threshold = tolerance * scale;
  let pivotRow = 0;
  const pivotColumns = [];

  for (let column = 0; column < columns && pivotRow < rows; column += 1) {
    let bestRow = pivotRow;
    for (let row = pivotRow + 1; row < rows; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[bestRow][column])) bestRow = row;
    }
    if (Math.abs(matrix[bestRow][column]) <= threshold) continue;
    [matrix[pivotRow], matrix[bestRow]] = [matrix[bestRow], matrix[pivotRow]];
    const pivot = matrix[pivotRow][column];
    for (let row = pivotRow + 1; row < rows; row += 1) {
      const factor = matrix[row][column] / pivot;
      matrix[row][column] = 0;
      for (let j = column + 1; j < columns; j += 1) {
        matrix[row][j] = checkFinite(matrix[row][j] - factor * matrix[pivotRow][j], 'echelon elimination');
      }
    }
    pivotColumns.push(column);
    pivotRow += 1;
  }
  return { matrix, pivotColumns };
}

export function matrixRank(input) {
  const { matrix, tolerance } = requireObject(input);
  return rowEchelon({ matrix, tolerance }).pivotColumns.length;
}

export function luDecompose(input) {
  const { matrix: matrixInput, tolerance: toleranceInput } = requireObject(input);
  const upper = readSquareMatrix(matrixInput);
  const tolerance = readTolerance(toleranceInput);
  const size = upper.length;
  const scale = maxAbs(upper);
  const threshold = tolerance * scale;
  const lower = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => i === j ? 1 : 0));
  const permutation = Array.from({ length: size }, (_, i) => i);
  let pivotSign = 1;
  let singular = false;

  for (let column = 0; column < size; column += 1) {
    let bestRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(upper[row][column]) > Math.abs(upper[bestRow][column])) bestRow = row;
    }
    if (Math.abs(upper[bestRow][column]) <= threshold) {
      singular = true;
      break;
    }
    if (bestRow !== column) {
      [upper[column], upper[bestRow]] = [upper[bestRow], upper[column]];
      [permutation[column], permutation[bestRow]] = [permutation[bestRow], permutation[column]];
      for (let prior = 0; prior < column; prior += 1) {
        [lower[column][prior], lower[bestRow][prior]] = [lower[bestRow][prior], lower[column][prior]];
      }
      pivotSign *= -1;
    }
    const pivot = upper[column][column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = upper[row][column] / pivot;
      lower[row][column] = checkFinite(factor, 'LU multiplier');
      upper[row][column] = 0;
      for (let j = column + 1; j < size; j += 1) {
        upper[row][j] = checkFinite(upper[row][j] - factor * upper[column][j], 'LU elimination');
      }
    }
  }
  if (!singular) {
    for (let i = 0; i < size; i += 1) if (Math.abs(upper[i][i]) <= threshold) singular = true;
  }
  return { lower, upper, permutation, pivotSign, singular };
}

function checkTriangular(matrix, tolerance, direction) {
  const scale = maxAbs(matrix);
  const threshold = tolerance * scale;
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j < matrix.length; j += 1) {
      if (direction === 'lower' && j > i && Math.abs(matrix[i][j]) > threshold) {
        throw new TypeError('matrix must be lower triangular');
      }
      if (direction === 'upper' && j < i && Math.abs(matrix[i][j]) > threshold) {
        throw new TypeError('matrix must be upper triangular');
      }
    }
  }
  return threshold;
}

export function forwardSubstitute(input) {
  const { matrix: matrixInput, vector: vectorInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const vector = readVector(vectorInput, matrix.length);
  const tolerance = readTolerance(toleranceInput);
  const threshold = checkTriangular(matrix, tolerance, 'lower');
  const solution = Array(matrix.length).fill(0);
  for (let row = 0; row < matrix.length; row += 1) {
    let value = vector[row];
    for (let column = 0; column < row; column += 1) value -= matrix[row][column] * solution[column];
    if (Math.abs(matrix[row][row]) <= threshold) throw new RangeError('lower triangular matrix is singular at the requested tolerance');
    solution[row] = checkFinite(value / matrix[row][row], 'forward substitution');
  }
  return solution;
}

export function backSubstitute(input) {
  const { matrix: matrixInput, vector: vectorInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const vector = readVector(vectorInput, matrix.length);
  const tolerance = readTolerance(toleranceInput);
  const threshold = checkTriangular(matrix, tolerance, 'upper');
  const solution = Array(matrix.length).fill(0);
  for (let row = matrix.length - 1; row >= 0; row -= 1) {
    let value = vector[row];
    for (let column = row + 1; column < matrix.length; column += 1) value -= matrix[row][column] * solution[column];
    if (Math.abs(matrix[row][row]) <= threshold) throw new RangeError('upper triangular matrix is singular at the requested tolerance');
    solution[row] = checkFinite(value / matrix[row][row], 'back substitution');
  }
  return solution;
}

function localCall(id, input) {
  const direct = {
    'linalg.luDecompose': luDecompose,
    'linalg.forwardSubstitute': forwardSubstitute,
    'linalg.backSubstitute': backSubstitute,
    'linalg.solve': (payload) => solve(payload),
    'linalg.inverse': (payload) => inverse(payload),
    'linalg.qr': qr,
    'linalg.leastSquares': (payload) => leastSquares(payload),
    'linalg.transpose': ({ matrix }) => basicTranspose(matrix),
    'linalg.matvec': ({ matrix, vector }) => basicMatvec(matrix, vector),
    'linalg.vectorSubtract': ({ a, b }) => basicVectorSubtract(a, b),
    'linalg.norm': ({ vector }) => basicNorm(vector),
    'linalg.dot': ({ a, b }) => basicDot(a, b),
  };
  const operation = direct[id];
  if (!operation) throw new RangeError(`no standalone implementation is available for ${id}`);
  return operation(input);
}

export function determinant(input) {
  const { matrix: matrixInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const decomposition = luDecompose({ matrix, tolerance: 0 });
  if (decomposition.singular) return 0;
  let result = decomposition.pivotSign;
  for (let i = 0; i < matrix.length; i += 1) result = checkFinite(result * decomposition.upper[i][i], 'determinant');
  return result;
}

export function solve(input, call = localCall) {
  const { matrix: matrixInput, vector: vectorInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const vector = readVector(vectorInput, matrix.length);
  const tolerance = readTolerance(toleranceInput);
  const factors = call('linalg.luDecompose', { matrix, tolerance });
  if (factors.singular) throw new RangeError('matrix is singular or rank-deficient at the requested tolerance');
  const permutedVector = factors.permutation.map((row) => vector[row]);
  const intermediate = call('linalg.forwardSubstitute', { matrix: factors.lower, vector: permutedVector, tolerance });
  return call('linalg.backSubstitute', { matrix: factors.upper, vector: intermediate, tolerance });
}

export function inverse(input, call = localCall) {
  const { matrix: matrixInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const tolerance = readTolerance(toleranceInput);
  const size = matrix.length;
  const result = Array.from({ length: size }, () => Array(size).fill(0));
  for (let column = 0; column < size; column += 1) {
    const basis = Array.from({ length: size }, (_, row) => row === column ? 1 : 0);
    const solution = call('linalg.solve', { matrix, vector: basis, tolerance });
    for (let row = 0; row < size; row += 1) result[row][column] = solution[row];
  }
  return result;
}

export function householderFactor(input) {
  const { matrix: matrixInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readMatrix(matrixInput);
  readTolerance(toleranceInput);
  const rows = matrix.length;
  const columns = matrix[0].length;
  if (rows < columns) throw new RangeError('QR requires rows to be at least columns for an economy factorization');
  const r = matrix.map((row) => [...row]);
  const reflectors = [];

  for (let column = 0; column < columns; column += 1) {
    const segment = r.slice(column).map((row) => row[column]);
    let segmentScale = 0;
    for (const value of segment) segmentScale = Math.max(segmentScale, Math.abs(value));
    if (segmentScale === 0) {
      reflectors.push(null);
      continue;
    }
    const scaled = segment.map((value) => value / segmentScale);
    const scaledNorm = hypotValues(scaled);
    const alpha = scaled[0] >= 0 ? -scaledNorm : scaledNorm;
    const reflector = [...scaled];
    reflector[0] -= alpha;
    const reflectorNorm = hypotValues(reflector);
    if (reflectorNorm === 0 || !Number.isFinite(reflectorNorm)) throw new RangeError('Householder reflector could not be represented finitely');
    for (let i = 0; i < reflector.length; i += 1) reflector[i] /= reflectorNorm;
    reflectors.push(reflector);

    for (let j = column; j < columns; j += 1) {
      let columnScale = 0;
      for (let i = 0; i < reflector.length; i += 1) columnScale = Math.max(columnScale, Math.abs(r[column + i][j]));
      if (columnScale === 0) continue;
      let projection = 0;
      for (let i = 0; i < reflector.length; i += 1) projection += reflector[i] * (r[column + i][j] / columnScale);
      projection *= 2;
      for (let i = 0; i < reflector.length; i += 1) {
        const normalized = r[column + i][j] / columnScale - projection * reflector[i];
        r[column + i][j] = checkFinite(normalized * columnScale, 'Householder QR');
      }
    }
    for (let i = column + 1; i < rows; i += 1) r[i][column] = 0;
  }

  const q = Array.from({ length: rows }, (_, i) => Array.from({ length: columns }, (_, j) => i === j ? 1 : 0));
  for (let column = columns - 1; column >= 0; column -= 1) {
    const reflector = reflectors[column];
    if (!reflector) continue;
    for (let j = 0; j < columns; j += 1) {
      let projection = 0;
      for (let i = 0; i < reflector.length; i += 1) projection += reflector[i] * q[column + i][j];
      projection *= 2;
      for (let i = 0; i < reflector.length; i += 1) {
        q[column + i][j] = checkFinite(q[column + i][j] - projection * reflector[i], 'Householder Q');
      }
    }
  }
  return { q, r: r.slice(0, columns).map((row) => row.slice(0, columns)) };
}

export function qr(input) {
  const { matrix, tolerance } = requireObject(input);
  const factors = householderFactor({ matrix, tolerance });
  return { ...factors, rank: matrixRank({ matrix, tolerance }) };
}

export function leastSquares(input, call = localCall) {
  const { matrix: matrixInput, vector: vectorInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readMatrix(matrixInput);
  const vector = readVector(vectorInput, matrix.length);
  const tolerance = readTolerance(toleranceInput);
  if (matrix.length < matrix[0].length) throw new RangeError('leastSquares requires at least as many rows as columns');
  const factors = call('linalg.qr', { matrix, tolerance });
  if (factors.rank < matrix[0].length) throw new RangeError('leastSquares design matrix is rank-deficient at the requested tolerance');
  const transposedQ = call('linalg.transpose', { matrix: factors.q });
  const projected = call('linalg.matvec', { matrix: transposedQ, vector });
  const solution = call('linalg.backSubstitute', { matrix: factors.r, vector: projected, tolerance });
  const fitted = call('linalg.matvec', { matrix, vector: solution });
  const residuals = call('linalg.vectorSubtract', { a: vector, b: fitted });
  const residualNorm = call('linalg.norm', { vector: residuals });
  return { solution, residuals, residualNorm, rank: factors.rank };
}

export function cholesky(input) {
  const { matrix: matrixInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const tolerance = readTolerance(toleranceInput);
  const scale = maxAbs(matrix);
  if (scale === 0) throw new RangeError('matrix must be positive definite');
  const symmetryThreshold = tolerance * scale;
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = i + 1; j < matrix.length; j += 1) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > symmetryThreshold) {
        throw new TypeError('Cholesky requires a symmetric matrix within the requested tolerance');
      }
    }
  }
  const normalized = matrix.map((row) => row.map((value) => value / scale));
  const lower = Array.from({ length: matrix.length }, () => Array(matrix.length).fill(0));
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let value = normalized[i][j];
      for (let k = 0; k < j; k += 1) value -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!(value > tolerance)) throw new RangeError('matrix is not positive definite at the requested tolerance');
        lower[i][j] = Math.sqrt(value);
      } else {
        lower[i][j] = value / lower[j][j];
      }
    }
  }
  const rootScale = Math.sqrt(scale);
  for (let i = 0; i < lower.length; i += 1) {
    for (let j = 0; j <= i; j += 1) lower[i][j] = checkFinite(lower[i][j] * rootScale, 'Cholesky factor');
  }
  return { lower };
}

function readEigenOptions(input, size) {
  const tolerance = readTolerance(input.tolerance);
  const maxIterations = input.maxIterations ?? Math.min(MAX_EIGEN_ITERATIONS, Math.max(1, 50 * size * size));
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_EIGEN_ITERATIONS) {
    throw new RangeError(`maxIterations must be an integer in [1, ${MAX_EIGEN_ITERATIONS}]`);
  }
  return { tolerance, maxIterations };
}

export function symmetricEigen(input) {
  const object = requireObject(input);
  const matrix = readSquareMatrix(object.matrix);
  const size = matrix.length;
  const { tolerance, maxIterations } = readEigenOptions(object, size);
  const scale = maxAbs(matrix);
  const symmetryThreshold = tolerance * scale;
  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > symmetryThreshold) {
        throw new TypeError('symmetricEigen requires a symmetric matrix within the requested tolerance');
      }
    }
  }
  if (scale === 0) {
    return {
      eigenvalues: Array(size).fill(0),
      eigenvectors: Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => i === j ? 1 : 0)),
      iterations: 0,
      converged: true,
    };
  }
  const a = matrix.map((row) => row.map((value) => value / scale));
  const vectors = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => i === j ? 1 : 0));
  let iterations = 0;
  let converged = false;

  while (iterations < maxIterations) {
    let p = 0;
    let q = 0;
    let largest = 0;
    for (let i = 0; i < size; i += 1) {
      for (let j = i + 1; j < size; j += 1) {
        if (Math.abs(a[i][j]) > largest) {
          largest = Math.abs(a[i][j]);
          p = i;
          q = j;
        }
      }
    }
    if (largest <= tolerance) {
      converged = true;
      break;
    }

    const apq = a[p][q];
    const tau = (a[q][q] - a[p][p]) / (2 * apq);
    const t = (tau < 0 ? -1 : 1) / (Math.abs(tau) + Math.hypot(1, tau));
    const cosine = 1 / Math.hypot(1, t);
    const sine = t * cosine;
    const app = a[p][p];
    const aqq = a[q][q];
    a[p][p] = checkFinite(app - t * apq, 'Jacobi eigenvalue iteration');
    a[q][q] = checkFinite(aqq + t * apq, 'Jacobi eigenvalue iteration');
    a[p][q] = 0;
    a[q][p] = 0;
    for (let k = 0; k < size; k += 1) {
      if (k === p || k === q) continue;
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = a[p][k] = checkFinite(cosine * akp - sine * akq, 'Jacobi eigenvector iteration');
      a[k][q] = a[q][k] = checkFinite(sine * akp + cosine * akq, 'Jacobi eigenvector iteration');
    }
    for (let k = 0; k < size; k += 1) {
      const vkp = vectors[k][p];
      const vkq = vectors[k][q];
      vectors[k][p] = cosine * vkp - sine * vkq;
      vectors[k][q] = sine * vkp + cosine * vkq;
    }
    iterations += 1;
  }
  if (!converged) {
    let largest = 0;
    for (let i = 0; i < size; i += 1) for (let j = i + 1; j < size; j += 1) largest = Math.max(largest, Math.abs(a[i][j]));
    converged = largest <= tolerance;
  }
  const order = Array.from({ length: size }, (_, i) => i).sort((left, right) => a[right][right] - a[left][left]);
  const eigenvalues = order.map((index) => checkFinite(a[index][index] * scale, 'eigenvalue rescaling'));
  const eigenvectors = Array.from({ length: size }, (_, row) => order.map((index) => vectors[row][index]));
  return { eigenvalues, eigenvectors, iterations, converged };
}

export function quadraticFormOfInverse(input, call = localCall) {
  const { matrix: matrixInput, vector: vectorInput, tolerance: toleranceInput } = requireObject(input);
  const matrix = readSquareMatrix(matrixInput);
  const vector = readVector(vectorInput, matrix.length);
  const tolerance = readTolerance(toleranceInput);
  const inverseMatrix = call('linalg.inverse', { matrix, tolerance });
  const transformed = call('linalg.matvec', { matrix: inverseMatrix, vector });
  const value = call('linalg.dot', { a: vector, b: transformed });
  return { value: checkFinite(value, 'inverse quadratic form') };
}

const commonExamples = {
  rowEchelon: { input: { matrix: [[1, 2], [2, 4]] }, expected: { matrix: [[2, 4], [0, 0]], pivotColumns: [0] } },
  rank: { input: { matrix: [[1, 2], [2, 4]] }, expected: 1 },
  luDecompose: { input: { matrix: [[0, 2], [1, 3]] }, expected: { lower: [[1, 0], [0, 1]], upper: [[1, 3], [0, 2]], permutation: [1, 0], pivotSign: -1, singular: false } },
  forwardSubstitute: { input: { matrix: [[1, 0], [2, 1]], vector: [3, 5] }, expected: [3, -1] },
  backSubstitute: { input: { matrix: [[2, 1], [0, 3]], vector: [5, 6] }, expected: [1.5, 2] },
  determinant: { input: { matrix: [[1, 2], [3, 4]] }, expected: -2 },
  solve: { input: { matrix: [[0, 2], [1, 3]], vector: [4, 7] }, expected: [1, 2] },
  inverse: { input: { matrix: [[1, 2], [0, 1]] }, expected: [[1, -2], [0, 1]] },
  householderFactor: { input: { matrix: [[3, 0], [0, 2], [0, 0]] }, expected: { q: [[-1, 0], [0, -1], [0, 0]], r: [[-3, 0], [0, -2]] } },
  qr: { input: { matrix: [[3, 0], [0, 2], [0, 0]] }, expected: { q: [[-1, 0], [0, -1], [0, 0]], r: [[-3, 0], [0, -2]], rank: 2 } },
  leastSquares: { input: { matrix: [[1, 0], [0, 1], [0, 0]], vector: [1, 2, 0] }, expected: { solution: [1, 2], residuals: [0, 0, 0], residualNorm: 0, rank: 2 } },
  cholesky: { input: { matrix: [[4, 2], [2, 3]] }, expected: { lower: [[2, 0], [1, Math.sqrt(2)]] } },
  symmetricEigen: { input: { matrix: [[2, 0], [0, 1]] }, expected: { eigenvalues: [2, 1], eigenvectors: [[1, 0], [0, 1]], iterations: 0, converged: true } },
  quadraticFormOfInverse: { input: { matrix: [[2, 0], [0, 4]], vector: [2, 4] }, expected: { value: 6 } },
};

function descriptor({ id, title, description, dependsOn = [], inputSchema, outputSchema, example, formula, caveats, run }) {
  return {
    id,
    title,
    description,
    kind: dependsOn.length === 0 ? 'atomic' : 'composed',
    dependsOn,
    inputSchema,
    outputSchema,
    examples: [example],
    ...(formula ? { formula } : {}),
    ...(caveats ? { caveats: Array.isArray(caveats) ? caveats : [caveats] } : {}),
    run,
  };
}

const matrixObject = { matrix: MATRIX_SCHEMA };
const matrixVectorObject = { matrix: MATRIX_SCHEMA, vector: VECTOR_SCHEMA };
const toleranceInput = { tolerance: TOLERANCE_SCHEMA };
const factorSchema = schema({ lower: MATRIX_SCHEMA, upper: MATRIX_SCHEMA, permutation: VECTOR_SCHEMA, pivotSign: NUMBER_SCHEMA, singular: { type: 'boolean' } }, ['lower', 'upper', 'permutation', 'pivotSign', 'singular']);
const eigenInput = schema({ ...matrixObject, ...toleranceInput, maxIterations: { type: 'integer', minimum: 1, maximum: MAX_EIGEN_ITERATIONS } }, ['matrix']);

export const numericalCapabilities = [
  descriptor({
    id: 'linalg.rowEchelon', title: 'Row echelon form', description: 'Uses partial row pivoting and a relative pivot threshold to expose pivot columns.',
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: schema({ matrix: MATRIX_SCHEMA, pivotColumns: { type: 'array', items: { type: 'integer', minimum: 0 } } }, ['matrix', 'pivotColumns']),
    example: commonExamples.rowEchelon, formula: 'Eliminate entries below each accepted pivot.',
    caveats: 'The returned form is row echelon, not reduced row echelon. Tolerance is relative to the largest absolute input entry.',
    run: ({ matrix, tolerance }) => rowEchelon({ matrix, tolerance }),
  }),
  descriptor({
    id: 'linalg.rank', title: 'Matrix rank', description: 'Counts scale-aware pivots from row echelon elimination.', dependsOn: ['linalg.rowEchelon'],
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: { type: 'integer', minimum: 0 },
    example: commonExamples.rank, formula: 'rank(A) = number of accepted pivot columns.',
    caveats: 'Numerical rank depends on the relative tolerance; small singular values can be treated as zero.',
    run: ({ matrix, tolerance }, ctx) => ctx.call('linalg.rowEchelon', tolerance === undefined ? { matrix } : { matrix, tolerance }).pivotColumns.length,
  }),
  descriptor({
    id: 'linalg.luDecompose', title: 'Pivoted LU decomposition', description: 'Factors a square matrix as P A = L U using partial row pivoting.',
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: factorSchema, example: commonExamples.luDecompose,
    formula: 'P A = L U.', caveats: 'The singular flag uses a relative pivot threshold based on the largest absolute input entry.',
    run: ({ matrix, tolerance }) => luDecompose({ matrix, tolerance }),
  }),
  descriptor({
    id: 'linalg.forwardSubstitute', title: 'Forward substitution', description: 'Solves L y = b for a lower-triangular L.',
    inputSchema: matrixVectorSchemaInput({ tolerance: true }), outputSchema: VECTOR_SCHEMA, example: commonExamples.forwardSubstitute,
    formula: 'yᵢ = (bᵢ − Σⱼ<ᵢ Lᵢⱼ yⱼ) / Lᵢᵢ.', caveats: 'Rejects non-lower-triangular or numerically singular input.',
    run: ({ matrix, vector, tolerance }) => forwardSubstitute({ matrix, vector, tolerance }),
  }),
  descriptor({
    id: 'linalg.backSubstitute', title: 'Back substitution', description: 'Solves U x = b for an upper-triangular U.',
    inputSchema: matrixVectorSchemaInput({ tolerance: true }), outputSchema: VECTOR_SCHEMA, example: commonExamples.backSubstitute,
    formula: 'xᵢ = (bᵢ − Σⱼ>ᵢ Uᵢⱼ xⱼ) / Uᵢᵢ.', caveats: 'Rejects non-upper-triangular or numerically singular input.',
    run: ({ matrix, vector, tolerance }) => backSubstitute({ matrix, vector, tolerance }),
  }),
  descriptor({
    id: 'linalg.determinant', title: 'Determinant', description: 'Computes the determinant from a pivoted LU factorization.', dependsOn: ['linalg.luDecompose'],
    inputSchema: matrixSchemaInput(), outputSchema: NUMBER_SCHEMA, example: commonExamples.determinant, formula: 'det(A) = sign(P) × Πᵢ Uᵢᵢ.',
    caveats: ['Exact zero pivots return zero. The diagonal product is accumulated left to right, so an intermediate overflow is rejected even if later factors could reduce the exact product.'],
    run: ({ matrix }, ctx) => {
      const factors = ctx.call('linalg.luDecompose', { matrix, tolerance: 0 });
      if (factors.singular) return 0;
      let value = factors.pivotSign;
      for (let i = 0; i < factors.upper.length; i += 1) value = checkFinite(value * factors.upper[i][i], 'determinant');
      return value;
    },
  }),
  descriptor({
    id: 'linalg.solve', title: 'Pivoted square solve', description: 'Solves A x = b by LU factorization and triangular substitution.',
    dependsOn: ['linalg.luDecompose', 'linalg.forwardSubstitute', 'linalg.backSubstitute'],
    inputSchema: matrixVectorSchemaInput({ tolerance: true }), outputSchema: VECTOR_SCHEMA, example: commonExamples.solve,
    formula: 'P A = L U; solve L y = P b, then U x = y.', caveats: 'Rejects matrices whose pivots fall below the scale-relative tolerance.',
    run: (input, ctx) => solve(input, (id, args) => ctx.call(id, args)),
  }),
  descriptor({
    id: 'linalg.inverse', title: 'Matrix inverse', description: 'Builds inverse columns by solving against each coordinate basis vector.', dependsOn: ['linalg.solve'],
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: MATRIX_SCHEMA, example: commonExamples.inverse,
    formula: 'A⁻¹ eⱼ is column j of A⁻¹.', caveats: 'Rejects singular or numerically rank-deficient matrices; inversion can amplify rounding error.',
    run: (input, ctx) => inverse(input, (id, args) => ctx.call(id, args)),
  }),
  descriptor({
    id: 'linalg.householderFactor', title: 'Householder QR factor', description: 'Builds economy Q and upper-triangular R with normalized Householder reflectors.',
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: schema({ q: MATRIX_SCHEMA, r: MATRIX_SCHEMA }, ['q', 'r']),
    example: commonExamples.householderFactor, formula: 'A = Q R, Qᵀ Q = I.',
    caveats: ['Requires rows >= columns. Reflector vectors and target columns are scaled before dot products to avoid avoidable overflow.'],
    run: ({ matrix, tolerance }) => householderFactor({ matrix, tolerance }),
  }),
  descriptor({
    id: 'linalg.qr', title: 'Householder QR', description: 'Computes an economy QR factorization with Householder reflections and a robust hypot norm.',
    dependsOn: ['linalg.householderFactor', 'linalg.rank'],
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: schema({ q: MATRIX_SCHEMA, r: MATRIX_SCHEMA, rank: { type: 'integer', minimum: 0 } }, ['q', 'r', 'rank']),
    example: commonExamples.qr, formula: 'A = Q R, Qᵀ Q = I.',
    caveats: ['Requires rows >= columns. Numerical rank uses the separate scale-aware echelon capability; Householder QR itself does not pivot columns.'],
    run: ({ matrix, tolerance }, ctx) => {
      const args = tolerance === undefined ? { matrix } : { matrix, tolerance };
      const factors = ctx.call('linalg.householderFactor', args);
      const rank = ctx.call('linalg.rank', args);
      return { ...factors, rank };
    },
  }),
  descriptor({
    id: 'linalg.leastSquares', title: 'Full-rank least squares', description: 'Solves an overdetermined full-column-rank system with Householder QR and reports residuals.',
    dependsOn: ['linalg.qr', 'linalg.transpose', 'linalg.matvec', 'linalg.backSubstitute', 'linalg.vectorSubtract', 'linalg.norm'],
    inputSchema: matrixVectorSchemaInput({ tolerance: true }),
    outputSchema: schema({ solution: VECTOR_SCHEMA, residuals: VECTOR_SCHEMA, residualNorm: NUMBER_SCHEMA, rank: { type: 'integer', minimum: 0 } }, ['solution', 'residuals', 'residualNorm', 'rank']),
    example: commonExamples.leastSquares, formula: 'x = R⁻¹ Qᵀ b; residuals = b − A x.',
    caveats: 'Requires rows >= columns and full column rank. Rank-deficient systems need a separate minimum-norm method.',
    run: (input, ctx) => leastSquares(input, (id, args) => ctx.call(id, args)),
  }),
  descriptor({
    id: 'linalg.cholesky', title: 'Cholesky factorization', description: 'Factors a symmetric positive-definite matrix as L Lᵀ, scaling the work matrix first.',
    inputSchema: matrixSchemaInput({ tolerance: true }), outputSchema: schema({ lower: MATRIX_SCHEMA }, ['lower']),
    example: commonExamples.cholesky, formula: 'A = L Lᵀ with positive diagonal entries in L.',
    caveats: 'Rejects nonsymmetric matrices and pivots that are not positive at the scale-relative tolerance.',
    run: ({ matrix, tolerance }) => cholesky({ matrix, tolerance }),
  }),
  descriptor({
    id: 'linalg.symmetricEigen', title: 'Symmetric Jacobi eigen decomposition', description: 'Uses largest-off-diagonal Jacobi rotations and sorts eigenpairs by descending eigenvalue.',
    inputSchema: eigenInput,
    outputSchema: schema({ eigenvalues: VECTOR_SCHEMA, eigenvectors: MATRIX_SCHEMA, iterations: { type: 'integer', minimum: 0 }, converged: { type: 'boolean' } }, ['eigenvalues', 'eigenvectors', 'iterations', 'converged']),
    example: commonExamples.symmetricEigen, formula: 'A V = V Λ; columns of V are orthonormal eigenvectors.',
    caveats: 'Requires symmetry within tolerance. `maxIterations` is capped at 100000; inspect `converged` before using an incomplete result.',
    run: ({ matrix, tolerance, maxIterations }) => symmetricEigen({ matrix, tolerance, maxIterations }),
  }),
  descriptor({
    id: 'linalg.quadraticFormOfInverse', title: 'Quadratic form of an inverse', description: 'Computes vᵀ A⁻¹ v by composing matrix inversion, matrix-vector multiplication, and dot product.',
    dependsOn: ['linalg.inverse', 'linalg.matvec', 'linalg.dot'], inputSchema: matrixVectorSchemaInput({ tolerance: true }),
    outputSchema: schema({ value: NUMBER_SCHEMA }, ['value']), example: commonExamples.quadraticFormOfInverse,
    formula: 'vᵀ A⁻¹ v.', caveats: 'A must be nonsingular at tolerance. For indefinite or nonsymmetric A this is only an algebraic quadratic form, not a distance.',
    run: (input, ctx) => quadraticFormOfInverse(input, (id, args) => ctx.call(id, args)),
  }),
];
