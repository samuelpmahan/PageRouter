import { covarianceMatrix } from '../composed/index.mjs';
import { dot, transpose, vectorSubtract } from '../linalg/basics.mjs';
import { symmetricEigen } from '../linalg/numerics.mjs';
import { mean } from '../statistics/core.mjs';

const MODEL_KIND = 'pca';
const DEFAULT_TOLERANCE = 1e-12;
const MAX_SAMPLES = 256;
const MAX_FEATURES = 32;
const MAX_EIGEN_ITERATIONS = 100_000;
const MAX_TRACE_BYTES = 4_096;
const NUMBER = { type: 'number' };
const VECTOR = { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: NUMBER };
const FEATURE_ROWS = { type: 'array', minItems: 2, maxItems: MAX_SAMPLES, items: VECTOR };
const MATRIX = { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: VECTOR };
const BOOLEAN = { type: 'boolean' };

function failType(message) { throw new TypeError(message); }
function failRange(message) { throw new RangeError(message); }

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) failType(`${label} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) failType(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) failType(`${label} must not have symbol properties`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) failType(`${label}.${key} must be a plain data property`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  plainObject(value, label);
  for (const key of Object.keys(value)) if (!allowed.has(key)) failType(`unknown ${label} field ${key}`);
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    failType(`${label} must contain exactly ${wanted.join(', ')}`);
  }
}

function array(value, label, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) failType(`${label} must be a plain array`);
  if (value.length < min || value.length > max) failRange(`${label} must contain ${min} through ${max} entries`);
  if (Object.getOwnPropertySymbols(value).length > 0) failType(`${label} must not have symbol properties`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) failType(`${label} has a non-index property`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) failType(`${label}[${index}] is missing`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) failType(`${label}[${index}] must be a plain data value`);
  }
  return value;
}

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) failType(`${label} must be finite`);
  return value;
}

function featureMatrix(value, label, minimumRows = 1) {
  array(value, label, minimumRows, MAX_SAMPLES);
  const first = array(value[0], `${label}[0]`, 1, MAX_FEATURES);
  const columns = first.length;
  if (value.length * columns > 8_192) failRange(`${label} exceeds the 8192 feature-value bound`);
  const rows = [];
  for (let row = 0; row < value.length; row += 1) {
    const source = array(value[row], `${label}[${row}]`, 1, MAX_FEATURES);
    if (source.length !== columns) failRange(`${label} must be rectangular; row ${row} has ${source.length} columns, expected ${columns}`);
    const copy = [];
    for (let column = 0; column < columns; column += 1) copy.push(finite(source[column], `${label}[${row}][${column}]`));
    rows.push(copy);
  }
  return { rows, rowCount: rows.length, columnCount: columns };
}

function tolerance(value = DEFAULT_TOLERANCE) {
  finite(value, 'tolerance');
  if (value < 0 || value >= 1) failRange('tolerance must be in [0, 1)');
  return value;
}

function iterations(value, featureCount) {
  const result = value ?? Math.min(MAX_EIGEN_ITERATIONS, Math.max(1, 50 * featureCount * featureCount));
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_EIGEN_ITERATIONS) {
    failRange(`maxIterations must be an integer from 1 to ${MAX_EIGEN_ITERATIONS}`);
  }
  return result;
}

function localCall(id, input) {
  switch (id) {
    case 'composed.covarianceMatrix': return covarianceMatrix(input);
    case 'statistics.mean': return mean(input);
    case 'linalg.symmetricEigen': return symmetricEigen(input);
    case 'linalg.transpose': return transpose(input.matrix);
    case 'linalg.vectorSubtract': return vectorSubtract(input.a, input.b);
    case 'linalg.dot': return dot(input.a, input.b);
    default: failRange(`no standalone PCA dependency is available for ${id}`);
  }
}

function canonicalAxis(axis) {
  let pivot = 0;
  for (let index = 1; index < axis.length; index += 1) {
    if (Math.abs(axis[index]) > Math.abs(axis[pivot])) pivot = index;
  }
  return axis[pivot] < 0 ? axis.map(value => -value) : axis.slice();
}

function outputSummary(value) {
  if (typeof value === 'number') return { value };
  if (Array.isArray(value)) {
    const numbers = value.flat(Infinity).filter(Number.isFinite);
    const summary = {
      rows: value.length,
      finiteValues: numbers.length,
      min: numbers.length ? Math.min(...numbers) : null,
      max: numbers.length ? Math.max(...numbers) : null,
    };
    if (Array.isArray(value[0])) summary.columns = value[0].length;
    return summary;
  }
  if (value && typeof value === 'object') {
    const summary = { keys: Object.keys(value).sort() };
    if (Array.isArray(value.matrix)) summary.matrix = outputSummary(value.matrix);
    if (Array.isArray(value.eigenvalues)) summary.eigenvalues = outputSummary(value.eigenvalues);
    if (Array.isArray(value.eigenvectors)) summary.eigenvectors = outputSummary(value.eigenvectors);
    for (const key of ['iterations', 'converged']) if (Object.hasOwn(value, key)) summary[key] = value[key];
    if (Object.hasOwn(value, 'value') && typeof value.value === 'number') summary.value = value.value;
    return summary;
  }
  return { type: typeof value };
}

function traceBytes(calls) {
  return new TextEncoder().encode(JSON.stringify(calls)).byteLength;
}

function fitPCAInternal(input, call, record) {
  onlyKeys(input, new Set(['features', 'components', 'tolerance', 'maxIterations']), 'PCA fit input');
  const { rows, rowCount, columnCount } = featureMatrix(input.features, 'features', 2);
  const componentCount = input.components ?? columnCount;
  if (!Number.isSafeInteger(componentCount) || componentCount < 1 || componentCount > columnCount) {
    failRange(`components must be an integer from 1 to featureCount (${columnCount})`);
  }
  const tol = tolerance(input.tolerance);
  const maxIterations = iterations(input.maxIterations, columnCount);
  const invoke = (id, stage, args) => {
    const result = call(id, args);
    if (record) record(id, stage, result);
    return result;
  };
  const covariance = invoke('composed.covarianceMatrix', 'sample-covariance', { observations: rows, denominator: 'sample' }).matrix;
  const means = Array.from({ length: columnCount }, (_, column) => invoke('statistics.mean', 'training-feature-mean', {
    values: rows.map(row => row[column]),
  }).value);
  const eigensystem = invoke('linalg.symmetricEigen', 'covariance-eigendecomposition', { matrix: covariance, tolerance: tol, maxIterations });
  if (!eigensystem.converged) {
    failRange(`PCA refused unconverged Jacobi eigenvectors after ${eigensystem.iterations} iterations`);
  }
  const scale = eigensystem.eigenvalues.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  const negativeTolerance = tol * scale;
  const nonnegativeEigenvalues = eigensystem.eigenvalues.map((value, index) => {
    if (value < -negativeTolerance) failRange(`PCA covariance eigenvalue ${index} is negative beyond roundoff tolerance`);
    return value < 0 ? 0 : value;
  });
  const eigenvectorRows = invoke('linalg.transpose', 'eigenvector-columns-to-component-rows', { matrix: eigensystem.eigenvectors });
  const directions = eigenvectorRows.slice(0, componentCount).map(canonicalAxis);
  const eigenvalues = nonnegativeEigenvalues.slice(0, componentCount);
  const fullScale = nonnegativeEigenvalues.reduce((largest, value) => Math.max(largest, value), 0);
  const scaledTotal = fullScale === 0 ? 0 : nonnegativeEigenvalues.reduce((sum, value) => sum + value / fullScale, 0);
  const explainedVarianceRatio = fullScale === 0
    ? eigenvalues.map(() => 0)
    : eigenvalues.map(value => (value / fullScale) / scaledTotal);
  for (const [label, values] of [['means', means], ['eigenvalues', eigenvalues], ['explained variance ratios', explainedVarianceRatio]]) {
    values.forEach((value, index) => finite(value, `${label}[${index}]`));
  }
  return {
    kind: MODEL_KIND,
    featureCount: columnCount,
    means,
    directions,
    eigenvalues,
    explainedVarianceRatio,
    components: componentCount,
    sampleCount: rowCount,
    converged: true,
  };
}

/** Fit covariance PCA using only the rows supplied as training features. */
export function fitPCA(input, call = localCall) {
  return fitPCAInternal(input, call, null);
}

/** Fit PCA and return compact summaries of the actual primitive calls made. */
export function fitPCAWithTrace(input, call = localCall) {
  const calls = [];
  const counts = new Map();
  const model = fitPCAInternal(input, call, (id, stage, output) => {
    const key = `${id}\0${stage}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const existing = calls.find(entry => entry.id === id && entry.stage === stage);
    if (existing) {
      existing.count = count;
      existing.outputs.push(outputSummary(output));
    } else {
      calls.push({ id, stage, count: 1, outputs: [outputSummary(output)] });
    }
  });
  // Keep the trace bounded while retaining exact dependency IDs, stages, counts, and output summaries.
  const compactCalls = calls.map(({ id, stage, count, outputs }) => {
    const scalars = outputs.map(value => value.value).filter(Number.isFinite);
    return {
      id,
      stage,
      count,
      output: scalars.length === outputs.length && scalars.length > 1
        ? { count: scalars.length, min: Math.min(...scalars), max: Math.max(...scalars) }
        : outputs.length === 1 ? outputs[0] : { count: outputs.length, last: outputs.at(-1) },
    };
  });
  const trace = { schema: 'ml.training-trace.v1', operation: 'fitPCA', calls: compactCalls, bytes: 0 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const measured = traceBytes(trace);
    if (trace.bytes === measured) break;
    trace.bytes = measured;
  }
  if (trace.bytes > MAX_TRACE_BYTES) failRange(`PCA trace exceeds ${MAX_TRACE_BYTES} bytes`);
  return { model, trace };
}

function validateModel(modelInput) {
  exactKeys(modelInput, ['kind', 'featureCount', 'means', 'directions', 'eigenvalues', 'explainedVarianceRatio', 'components', 'sampleCount', 'converged'], 'PCA model');
  const model = modelInput;
  if (model.kind !== MODEL_KIND) failType(`model.kind must be ${MODEL_KIND}`);
  if (!Number.isSafeInteger(model.featureCount) || model.featureCount < 1 || model.featureCount > MAX_FEATURES) failRange(`model.featureCount must be from 1 to ${MAX_FEATURES}`);
  if (!Number.isSafeInteger(model.components) || model.components < 1 || model.components > model.featureCount) failRange('model.components must be within its feature count');
  if (!Number.isSafeInteger(model.sampleCount) || model.sampleCount < 2 || model.sampleCount > MAX_SAMPLES) failRange('model.sampleCount must be from 2 to the sample bound');
  if (model.converged !== true) failRange('PCA model must contain converged directions');
  const means = array(model.means, 'model.means', model.featureCount, model.featureCount).map((value, index) => finite(value, `model.means[${index}]`));
  const directions = featureMatrix(model.directions, 'model.directions', model.components);
  if (directions.rowCount !== model.components || directions.columnCount !== model.featureCount) failRange('model direction dimensions do not match featureCount and components');
  for (let row = 0; row < directions.rowCount; row += 1) {
    let squaredNorm = 0;
    for (const value of directions.rows[row]) squaredNorm += value * value;
    if (!Number.isFinite(squaredNorm) || Math.abs(squaredNorm - 1) > 1e-8) failRange(`model.directions[${row}] must be a unit vector`);
    for (let previous = 0; previous < row; previous += 1) {
      let product = 0;
      for (let column = 0; column < model.featureCount; column += 1) product += directions.rows[row][column] * directions.rows[previous][column];
      if (Math.abs(product) > 1e-8) failRange('model PCA directions must be mutually orthogonal');
    }
  }
  const eigenvalues = array(model.eigenvalues, 'model.eigenvalues', model.components, model.components).map((value, index) => {
    finite(value, `model.eigenvalues[${index}]`);
    if (value < 0) failRange(`model.eigenvalues[${index}] must be nonnegative`);
    return value;
  });
  for (let index = 1; index < eigenvalues.length; index += 1) {
    if (eigenvalues[index] > eigenvalues[index - 1] + 1e-12 * Math.max(eigenvalues[index], eigenvalues[index - 1])) {
      failRange('model.eigenvalues must be in descending order');
    }
  }
  const ratios = array(model.explainedVarianceRatio, 'model.explainedVarianceRatio', model.components, model.components).map((value, index) => {
    finite(value, `model.explainedVarianceRatio[${index}]`);
    if (value < 0 || value > 1) failRange(`model.explainedVarianceRatio[${index}] must be in [0, 1]`);
    if (eigenvalues[index] === 0 && value !== 0) failRange(`model.explainedVarianceRatio[${index}] must be zero when its eigenvalue is zero`);
    return value;
  });
  if (ratios.reduce((sum, value) => sum + value, 0) > 1 + 1e-8) failRange('selected explained-variance ratios cannot exceed total variance');
  for (let index = 1; index < ratios.length; index += 1) {
    if (ratios[index] > ratios[index - 1] + 1e-10) failRange('explained-variance ratios must follow descending eigenvalue order');
  }
  const largestEigenvalue = eigenvalues.reduce((largest, value) => Math.max(largest, value), 0);
  if (largestEigenvalue > 0) {
    for (let left = 0; left < eigenvalues.length; left += 1) {
      for (let right = left + 1; right < eigenvalues.length; right += 1) {
        const leftProduct = ratios[left] * (eigenvalues[right] / largestEigenvalue);
        const rightProduct = ratios[right] * (eigenvalues[left] / largestEigenvalue);
        const scale = Math.max(Math.abs(leftProduct), Math.abs(rightProduct), Number.EPSILON);
        if (Math.abs(leftProduct - rightProduct) > 1e-8 * scale) failRange('explained-variance ratios must be proportional to their eigenvalues');
      }
    }
  } else if (ratios.some(value => value !== 0)) {
    failRange('explained-variance ratios must be zero when all eigenvalues are zero');
  }
  return { means, directions: directions.rows, eigenvalues, ratios };
}

/** Project new rows using the training means and directions retained in model. */
export function transformPCA(input, call = localCall) {
  onlyKeys(input, new Set(['model', 'features']), 'PCA transform input');
  const model = validateModel(input.model);
  const { rows, columnCount } = featureMatrix(input.features, 'features');
  if (columnCount !== model.means.length) failRange(`features must have ${model.means.length} columns to match the fitted PCA model`);
  const projected = rows.map((row, rowIndex) => {
    const centered = call('linalg.vectorSubtract', { a: row, b: model.means });
    return model.directions.map((direction, component) => finite(
      call('linalg.dot', { a: centered, b: direction }),
      `projected[${rowIndex}][${component}]`,
    ));
  });
  return { projected };
}

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const fitInput = objectSchema({
  features: FEATURE_ROWS,
  components: { type: 'integer', minimum: 1, maximum: MAX_FEATURES },
  tolerance: { type: 'number', minimum: 0, maximum: 0.9999999999999999 },
  maxIterations: { type: 'integer', minimum: 1, maximum: MAX_EIGEN_ITERATIONS },
}, ['features']);
const modelSchema = objectSchema({
  kind: { type: 'string', enum: [MODEL_KIND] },
  featureCount: { type: 'integer', minimum: 1, maximum: MAX_FEATURES },
  means: VECTOR,
  directions: MATRIX,
  eigenvalues: { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: { type: 'number', minimum: 0 } },
  explainedVarianceRatio: { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: { type: 'number', minimum: 0, maximum: 1 } },
  components: { type: 'integer', minimum: 1, maximum: MAX_FEATURES },
  sampleCount: { type: 'integer', minimum: 2, maximum: MAX_SAMPLES },
  converged: BOOLEAN,
});
const modelOutput = modelSchema;

export const pcaCapabilities = [
  {
    id: 'ml.fitPCA',
    title: 'Fit principal component analysis',
    description: 'Centers training rows, diagonalizes their sample covariance, and retains the leading principal directions.',
    kind: 'composed',
    dependsOn: ['composed.covarianceMatrix', 'statistics.mean', 'linalg.symmetricEigen', 'linalg.transpose'],
    inputSchema: fitInput,
    outputSchema: modelOutput,
    examples: [{
      input: { features: [[8, 20], [10, 20], [12, 20]] },
      expected: {
        kind: 'pca', featureCount: 2, means: [10, 20], directions: [[1, 0], [0, 1]],
        eigenvalues: [4, 0], explainedVarianceRatio: [1, 0], components: 2, sampleCount: 3, converged: true,
      },
    }],
    formula: 'C = sampleCovariance(X); C vⱼ = λⱼvⱼ; scoreᵢⱼ = (xᵢ − μtrain) · vⱼ.',
    caveats: [
      'PCA subtracts its retained training means and does not standardize feature scales; the workbench may fit a standardizer on training rows first.',
      'A nonconverged symmetric eigensolve is rejected. Repeated eigenvalues define a subspace, so individual directions within that subspace are not unique.',
      'When the training data have zero total variance, explained-variance ratios are defined as zero.',
    ],
    run: (input, ctx) => fitPCA(input, (id, args) => ctx.call(id, args)),
  },
  {
    id: 'ml.transformPCA',
    title: 'Project rows with fitted PCA',
    description: 'Projects rows using means and principal directions retained by a fitted PCA model.',
    kind: 'composed',
    dependsOn: ['linalg.vectorSubtract', 'linalg.dot'],
    inputSchema: objectSchema({ model: modelSchema, features: { ...FEATURE_ROWS, minItems: 1 } }),
    outputSchema: objectSchema({ projected: { type: 'array', minItems: 1, maxItems: MAX_SAMPLES, items: { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: NUMBER } } }),
    examples: [{
      input: {
        model: {
          kind: 'pca', featureCount: 2, means: [10, 20], directions: [[1, 0], [0, 1]],
          eigenvalues: [4, 0], explainedVarianceRatio: [1, 0], components: 2, sampleCount: 3, converged: true,
        },
        features: [[14, 21]],
      },
      expected: { projected: [[4, 1]] },
    }],
    formula: 'zᵢⱼ = (xᵢ − μtrain) · vⱼ.',
    caveats: ['The transform uses only the fitted model; holdout or prediction rows do not refit means or directions.'],
    run: (input, ctx) => transformPCA(input, (id, args) => ctx.call(id, args)),
  },
];
