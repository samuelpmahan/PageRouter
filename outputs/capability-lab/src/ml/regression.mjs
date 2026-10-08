// Bounded ordinary least squares built on the verified QR least-squares solver.
import { dot } from '../linalg/basics.mjs';
import { leastSquares } from '../linalg/numerics.mjs';

const MAX_ROWS = 10_000;
const MAX_FEATURES = 64;
const MAX_MATRIX_CELLS = 100_000;
const MODEL_KIND = 'linearRegression';
const MODEL_VERSION = 1;
const SOLVER = 'linalg.leastSquares';

function objectInput(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`unknown ${label} field ${key}`);
  }
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function finiteMatrix(value, label = 'features') {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROWS) {
    throw new RangeError(`${label} must contain 1 to ${MAX_ROWS} rows`);
  }
  if (!Array.isArray(value[0]) || value[0].length < 1 || value[0].length > MAX_FEATURES) {
    throw new RangeError(`${label} rows must contain 1 to ${MAX_FEATURES} features`);
  }
  const columns = value[0].length;
  const rows = [];
  for (let row = 0; row < value.length; row += 1) {
    if (!Array.isArray(value[row]) || value[row].length !== columns) {
      throw new RangeError(`${label} must be rectangular with the same feature count in every row`);
    }
    const copied = [];
    for (let column = 0; column < columns; column += 1) {
      copied.push(finiteNumber(value[row][column], `${label}[${row}][${column}]`));
    }
    rows.push(copied);
  }
  return { rows, rowCount: rows.length, featureCount: columns };
}

function finiteVector(value, label, expectedLength, maximum = MAX_ROWS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new RangeError(`${label} must contain 1 to ${maximum} values`);
  }
  if (value.length !== expectedLength) throw new RangeError(`${label} length must match the number of feature rows`);
  return value.map((entry, index) => finiteNumber(entry, `${label}[${index}]`));
}

function fitOptions(input) {
  const fitIntercept = input.fitIntercept ?? true;
  if (typeof fitIntercept !== 'boolean') throw new TypeError('fitIntercept must be a boolean');
  return fitIntercept;
}

function checkedTrainingInput(input) {
  objectInput(input, 'input');
  onlyKeys(input, new Set(['features', 'targets', 'fitIntercept']), 'fit input');
  const shape = finiteMatrix(input.features);
  const targets = finiteVector(input.targets, 'targets', shape.rowCount);
  const fitIntercept = fitOptions(input);
  const designColumns = shape.featureCount + Number(fitIntercept);
  if (shape.rowCount < designColumns) {
    throw new RangeError(`linear regression needs at least ${designColumns} rows for ${designColumns} fitted columns`);
  }
  if (shape.rowCount * designColumns > MAX_MATRIX_CELLS) {
    throw new RangeError(`linear regression design matrix exceeds ${MAX_MATRIX_CELLS} cells`);
  }
  const matrix = fitIntercept ? shape.rows.map(row => [1, ...row]) : shape.rows;
  return { matrix, features: shape.rows, targets, rowCount: shape.rowCount, featureCount: shape.featureCount, fitIntercept };
}

function fitUsing(input, leastSquaresCall) {
  const parsed = checkedTrainingInput(input);
  const solution = leastSquaresCall({ matrix: parsed.matrix, vector: parsed.targets });
  const expectedRank = parsed.matrix[0].length;
  if (solution.rank !== expectedRank) {
    throw new RangeError('linear regression design matrix is rank-deficient');
  }
  const intercept = parsed.fitIntercept ? solution.solution[0] : 0;
  const coefficients = parsed.fitIntercept ? solution.solution.slice(1) : [...solution.solution];
  finiteNumber(intercept, 'fitted intercept');
  coefficients.forEach((coefficient, index) => finiteNumber(coefficient, `fitted coefficient[${index}]`));
  const predictions = parsed.targets.map((target, index) => {
    const prediction = target - solution.residuals[index];
    if (!Number.isFinite(prediction)) throw new RangeError(`prediction[${index}] is outside the finite numeric range`);
    return prediction;
  });
  return {
    model: {
      kind: MODEL_KIND,
      version: MODEL_VERSION,
      coefficients,
      intercept,
      featureCount: parsed.featureCount,
      sampleCount: parsed.rowCount,
      fitIntercept: parsed.fitIntercept,
      solver: SOLVER,
    },
    diagnostics: {
      rank: solution.rank,
      predictions,
      residuals: [...solution.residuals],
      residualNorm: solution.residualNorm,
    },
  };
}

/** Fit ordinary least squares through the verified QR least-squares solver. */
export function fitLinearRegression(input) {
  return fitUsing(input, leastSquares);
}

function checkedModel(value) {
  const model = objectInput(value, 'model');
  onlyKeys(model, new Set([
    'kind', 'version', 'coefficients', 'intercept', 'featureCount', 'sampleCount', 'fitIntercept', 'solver',
  ]), 'model');
  if (model.kind !== MODEL_KIND) throw new TypeError(`model.kind must be ${MODEL_KIND}`);
  if (model.version !== MODEL_VERSION) throw new RangeError(`model.version must be ${MODEL_VERSION}`);
  const featureCount = safeInteger(model.featureCount, 'model.featureCount', 1, MAX_FEATURES);
  const sampleCount = safeInteger(model.sampleCount, 'model.sampleCount', 1, MAX_ROWS);
  const coefficients = finiteVector(model.coefficients, 'model.coefficients', featureCount, MAX_FEATURES);
  const intercept = finiteNumber(model.intercept, 'model.intercept');
  if (typeof model.fitIntercept !== 'boolean') throw new TypeError('model.fitIntercept must be a boolean');
  if (!model.fitIntercept && intercept !== 0) throw new RangeError('a model without an intercept must store intercept 0');
  if (model.solver !== SOLVER) throw new TypeError(`model.solver must be ${SOLVER}`);
  return { coefficients, intercept, featureCount, sampleCount, fitIntercept: model.fitIntercept };
}

function predictUsing(input, dotCall) {
  objectInput(input, 'input');
  onlyKeys(input, new Set(['model', 'features']), 'prediction input');
  const model = checkedModel(input.model);
  const parsed = finiteMatrix(input.features);
  if (parsed.featureCount !== model.featureCount) {
    throw new RangeError(`features must contain ${model.featureCount} columns to match the model`);
  }
  if (parsed.rowCount * parsed.featureCount > MAX_MATRIX_CELLS) {
    throw new RangeError(`prediction matrix exceeds ${MAX_MATRIX_CELLS} cells`);
  }
  const predictions = parsed.rows.map((row, index) => {
    const product = dotCall(row, model.coefficients);
    const prediction = product + model.intercept;
    if (!Number.isFinite(prediction)) throw new RangeError(`prediction[${index}] is outside the finite numeric range`);
    return prediction;
  });
  return { predictions };
}

/** Predict from model coefficients and feature rows; targets are not accepted. */
export function predictLinearRegression(input) {
  return predictUsing(input, dot);
}

const numberSchema = { type: 'number' };
const numberVectorSchema = { type: 'array', minItems: 1, maxItems: MAX_ROWS, items: numberSchema };
const featureRowSchema = { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: numberSchema };
const featureMatrixSchema = { type: 'array', minItems: 1, maxItems: MAX_ROWS, items: featureRowSchema };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const modelSchema = schema({
  kind: { type: 'string', enum: [MODEL_KIND] },
  version: { type: 'integer', minimum: MODEL_VERSION, maximum: MODEL_VERSION },
  coefficients: { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: numberSchema },
  intercept: numberSchema,
  featureCount: { type: 'integer', minimum: 1, maximum: MAX_FEATURES },
  sampleCount: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
  fitIntercept: { type: 'boolean' },
  solver: { type: 'string', enum: [SOLVER] },
}, ['kind', 'version', 'coefficients', 'intercept', 'featureCount', 'sampleCount', 'fitIntercept', 'solver']);
const fitInputSchema = schema({
  features: featureMatrixSchema,
  targets: numberVectorSchema,
  fitIntercept: { type: 'boolean' },
}, ['features', 'targets']);
const fitOutputSchema = schema({
  model: modelSchema,
  diagnostics: schema({
    rank: { type: 'integer', minimum: 1, maximum: MAX_FEATURES + 1 },
    predictions: numberVectorSchema,
    residuals: numberVectorSchema,
    residualNorm: { type: 'number', minimum: 0 },
  }, ['rank', 'predictions', 'residuals', 'residualNorm']),
}, ['model', 'diagnostics']);
const predictInputSchema = schema({ model: modelSchema, features: featureMatrixSchema }, ['model', 'features']);
const predictOutputSchema = schema({ predictions: numberVectorSchema }, ['predictions']);

const fitExampleInput = {
  features: [[1, 0], [0, 1]],
  targets: [2, 3],
  fitIntercept: false,
};
const fitExampleExpected = {
  model: {
    kind: 'linearRegression', version: 1, coefficients: [2, 3], intercept: 0,
    featureCount: 2, sampleCount: 2, fitIntercept: false, solver: 'linalg.leastSquares',
  },
  diagnostics: { rank: 2, predictions: [2, 3], residuals: [0, 0], residualNorm: 0 },
};
const predictExampleInput = {
  model: fitExampleExpected.model,
  features: [[2, 0], [0, -1], [1, 1]],
};

export const capabilities = [
  {
    id: 'ml.fitLinearRegression',
    title: 'Fit linear regression',
    description: 'Fit a linear model with optional intercept using the verified QR least-squares solver.',
    kind: 'composed',
    dependsOn: ['linalg.leastSquares'],
    inputSchema: fitInputSchema,
    outputSchema: fitOutputSchema,
    examples: [{ input: fitExampleInput, expected: fitExampleExpected }],
    run: (input, ctx) => fitUsing(input, payload => ctx.call('linalg.leastSquares', payload)),
    formula: 'targets ≈ intercept + features · coefficients; the coefficients minimize squared residuals through QR least squares.',
    caveats: 'Requires a full-column-rank design matrix and at least as many rows as fitted columns. A fit is association, not causation.',
  },
  {
    id: 'ml.predictLinearRegression',
    title: 'Predict with linear regression',
    description: 'Apply a retained linear-regression model to feature rows.',
    kind: 'composed',
    dependsOn: ['linalg.dot'],
    inputSchema: predictInputSchema,
    outputSchema: predictOutputSchema,
    examples: [{ input: predictExampleInput, expected: { predictions: [4, -3, 5] } }],
    run: (input, ctx) => predictUsing(input, (row, coefficients) => ctx.call('linalg.dot', { a: row, b: coefficients })),
    formula: 'prediction = intercept + Σ(featureᵢ × coefficientᵢ).',
    caveats: 'Each row must have the same feature count used to fit the model. Targets and future labels are not read.',
  },
];
