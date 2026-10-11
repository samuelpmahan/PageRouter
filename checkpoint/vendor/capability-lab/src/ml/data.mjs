// Small dependency-free data, preprocessing, split, and evaluation primitives.
// This module works only with declared record fields and never infers features.

const MAX_RECORDS = 10_000;
const MAX_FEATURES = 256;

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label, { min = 0, max = MAX_RECORDS } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length < min || value.length > max) {
    throw new RangeError(`${label} must contain between ${min} and ${max} entries`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function safeCount(value, label, { min = 1, max = MAX_RECORDS } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a safe integer from ${min} through ${max}`);
  }
  return value;
}

function vector(value, label, { min = 1, max = MAX_FEATURES } = {}) {
  requireArray(value, label, { min, max });
  return value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
}

function numericSeries(value, label) {
  requireArray(value, label, { min: 1, max: MAX_RECORDS });
  return value.map((item, index) => finiteNumber(item, `${label}[${index}]`));
}

function matrix(value, label) {
  requireArray(value, label, { min: 1, max: MAX_RECORDS });
  const rows = value.map((row, index) => vector(row, `${label}[${index}]`));
  const width = rows[0].length;
  if (rows.some(row => row.length !== width)) throw new RangeError(`${label} rows must have the same feature count`);
  return { rows, width };
}

// Scale before summing so a mean of large finite values does not overflow.
function finiteMean(values, label) {
  const anchor = values[0];
  const centered = values.map(value => value - anchor);
  if (centered.every(Number.isFinite)) {
    const result = anchor + scaledMean(centered, label);
    if (Number.isFinite(result)) return result;
  }
  return scaledMean(values, label);
}

function scaledMean(values, label) {
  const maxAbs = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  if (maxAbs === 0) return 0;
  let sum = 0, correction = 0;
  for (const value of values) {
    const term = value / maxAbs - correction;
    const next = sum + term;
    correction = (next - sum) - term;
    sum = next;
  }
  const result = (sum / values.length) * maxAbs;
  if (!Number.isFinite(result)) throw new RangeError(`${label} is outside the finite numeric range`);
  return result;
}

function kahanAdd(state, value) {
  const adjusted = value - state.correction;
  const next = state.sum + adjusted;
  state.correction = (next - state.sum) - adjusted;
  state.sum = next;
}

function validateFeatures(features, label) {
  const parsed = matrix(features, label);
  return parsed;
}

/**
 * Split records by connected groups. Records sharing a runId, conditionId,
 * or any selected groupBy field stay on the same side of the split.
 */
export function splitByGroup(input) {
  requireObject(input, 'input');
  const records = requireArray(input.records, 'records', { min: 2 });
  const fraction = finiteNumber(input.testFraction ?? 0.2, 'testFraction');
  if (!(fraction > 0 && fraction < 1)) throw new RangeError('testFraction must be greater than 0 and less than 1');
  const seed = input.seed ?? 0;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError('seed must be an unsigned 32-bit integer');
  }
  const selectedFields = input.groupBy === undefined ? ['conditionId'] : [input.groupBy];
  if (typeof selectedFields[0] !== 'string' || selectedFields[0].length === 0) {
    throw new TypeError('groupBy must be a non-empty field name');
  }
  const groupFields = [...new Set(['runId', 'conditionId', ...selectedFields])];
  const parsedRecords = records.map((record, index) => {
    requireObject(record, `records[${index}]`);
    for (const field of ['runId', 'conditionId']) {
      if (typeof record[field] !== 'string' || record[field].length === 0) {
        throw new TypeError(`records[${index}].${field} must be a non-empty string`);
      }
    }
    for (const field of groupFields) {
      if (!Object.hasOwn(record, field) || !isGroupScalar(record[field])) {
        throw new TypeError(`records[${index}].${field} must be a present string, finite number, or boolean`);
      }
    }
    return record;
  });

  const parents = records.map((_, index) => index);
  const find = index => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (left, right) => {
    const a = find(left), b = find(right);
    if (a !== b) parents[Math.max(a, b)] = Math.min(a, b);
  };
  for (const field of groupFields) {
    const firstByValue = new Map();
    for (let index = 0; index < parsedRecords.length; index += 1) {
      const key = `${typeof parsedRecords[index][field]}:${String(parsedRecords[index][field])}`;
      if (firstByValue.has(key)) join(index, firstByValue.get(key));
      else firstByValue.set(key, index);
    }
  }

  const groupIndices = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const root = find(index);
    if (!groupIndices.has(root)) groupIndices.set(root, []);
    groupIndices.get(root).push(index);
  }
  const groups = [...groupIndices.entries()].map(([id, indices]) => ({ id, indices }));
  if (groups.length < 2) throw new RangeError('at least two independent connected groups are required for a train/test split');

  const random = mulberry32(seed);
  for (let index = groups.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [groups[index], groups[swap]] = [groups[swap], groups[index]];
  }
  const testGroupCount = Math.min(groups.length - 1, Math.max(1, Math.round(groups.length * fraction)));
  const testGroupIds = new Set(groups.slice(0, testGroupCount).map(group => group.id));
  const trainIndices = [], testIndices = [], trainGroupIds = [], testGroupIdsList = [];
  for (const group of [...groupIndices.entries()].map(([id, indices]) => ({ id, indices }))) {
    const isTest = testGroupIds.has(group.id);
    (isTest ? testGroupIdsList : trainGroupIds).push(group.id);
    (isTest ? testIndices : trainIndices).push(...group.indices);
  }
  trainIndices.sort((a, b) => a - b);
  testIndices.sort((a, b) => a - b);
  trainGroupIds.sort((a, b) => a - b);
  testGroupIdsList.sort((a, b) => a - b);
  const groupBy = selectedFields[0];
  return {
    train: trainIndices.map(index => cloneJson(records[index])),
    test: testIndices.map(index => cloneJson(records[index])),
    trainIndices,
    testIndices,
    groups: { train: trainGroupIds, test: testGroupIdsList },
    groupCount: groups.length,
    seed,
    testFraction: fraction,
    groupBy,
  };
}

function isGroupScalar(value) {
  return typeof value === 'string' && value.length > 0
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

/** Fit population standard-deviation scaling using training rows only. */
export function fitStandardizer(input) {
  requireObject(input, 'input');
  const { rows, width } = validateFeatures(input.features, 'features');
  const means = [], scales = [], constantColumns = [];
  for (let column = 0; column < width; column += 1) {
    const values = rows.map(row => row[column]);
    const first = values[0];
    const constant = values.every(value => value === first);
    if (constant) {
      means.push(first);
      scales.push(1);
      constantColumns.push(true);
      continue;
    }
    const mean = finiteMean(values, `features column ${column}`);
    if (!Number.isFinite(mean)) throw new RangeError(`features column ${column} mean is outside the finite numeric range`);
    const deviations = values.map(value => value - mean);
    const centeredIsFinite = deviations.every(Number.isFinite);
    const scaleBase = centeredIsFinite
      ? deviations.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0)
      : values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
    const scaled = centeredIsFinite
      ? deviations.map(value => scaleBase === 0 ? 0 : value / scaleBase)
      : values.map(value => scaleBase === 0 ? 0 : value / scaleBase - mean / scaleBase);
    const scaledMeanValue = centeredIsFinite ? 0 : finiteMean(scaled, `features column ${column}`);
    const varianceAccumulator = { sum: 0, correction: 0 };
    for (const value of scaled) kahanAdd(varianceAccumulator, (value - scaledMeanValue) ** 2);
    let scale = scaleBase * Math.sqrt(varianceAccumulator.sum / values.length);
    if (!Number.isFinite(scale)) throw new RangeError(`features column ${column} scale is outside the finite numeric range`);
    if (scale === 0) scale = Number.MIN_VALUE;
    means.push(mean);
    scales.push(scale);
    constantColumns.push(false);
  }
  return {
    kind: 'standardizer',
    version: 1,
    means,
    scales,
    constantColumns,
    featureCount: width,
    sampleCount: rows.length,
    scaleMethod: 'population-standard-deviation',
  };
}

/** Apply a fitted standardizer without learning from these rows. */
export function transformStandardizer(input) {
  requireObject(input, 'input');
  const model = requireObject(input.model, 'model');
  if (model.kind !== 'standardizer' || model.version !== 1) throw new TypeError('model must be a standardizer version 1');
  const means = vector(model.means, 'model.means');
  const scales = vector(model.scales, 'model.scales');
  const constants = requireArray(model.constantColumns, 'model.constantColumns', { min: 1, max: MAX_FEATURES });
  safeCount(model.sampleCount, 'model.sampleCount');
  if (model.scaleMethod !== 'population-standard-deviation') throw new TypeError('model.scaleMethod must be population-standard-deviation');
  if (!Number.isSafeInteger(model.featureCount) || means.length !== scales.length || means.length !== constants.length || model.featureCount !== means.length) {
    throw new RangeError('standardizer model feature dimensions do not match');
  }
  scales.forEach((scale, index) => {
    if (!(scale > 0)) throw new RangeError(`model.scales[${index}] must be positive`);
    if (typeof constants[index] !== 'boolean') throw new TypeError(`model.constantColumns[${index}] must be boolean`);
    if (constants[index] && scale !== 1) throw new RangeError(`constant feature ${index} must use scale 1`);
  });
  const { rows, width } = validateFeatures(input.features, 'features');
  if (width !== means.length) throw new RangeError(`features must have ${means.length} columns to match the standardizer`);
  const transformed = rows.map((row, rowIndex) => row.map((value, column) => {
    const difference = value - means[column];
    const result = Number.isFinite(difference)
      ? difference / scales[column]
      : value / scales[column] - means[column] / scales[column];
    if (!Number.isFinite(result)) throw new RangeError(`transformed feature [${rowIndex}][${column}] is outside the finite numeric range`);
    return result;
  }));
  return { features: transformed };
}

/** Evaluate numeric predictions; r2 is null when actual targets are constant. */
export function regressionMetrics(input) {
  requireObject(input, 'input');
  const actual = numericSeries(input.actual, 'actual');
  const predicted = numericSeries(input.predicted, 'predicted');
  if (actual.length !== predicted.length) throw new RangeError('actual and predicted must have the same length');
  const residuals = actual.map((value, index) => {
    const residual = predicted[index] - value;
    if (!Number.isFinite(residual)) throw new RangeError(`residual at index ${index} is outside the finite numeric range`);
    return residual;
  });
  const maxResidual = residuals.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  const scaledAbsolute = maxResidual === 0 ? residuals : residuals.map(value => Math.abs(value) / maxResidual);
  const scaledSquares = maxResidual === 0 ? 0 : residuals.reduce((sum, value) => sum + (value / maxResidual) ** 2, 0) / actual.length;
  const mae = maxResidual * finiteMean(scaledAbsolute, 'scaled absolute error mean');
  const mse = maxResidual * (maxResidual * scaledSquares);
  const rmse = maxResidual * Math.sqrt(scaledSquares);
  if (![mae, mse, rmse].every(Number.isFinite)) throw new RangeError('regression metrics are outside the finite numeric range');
  const mean = finiteMean(actual, 'actual mean');
  const constantActual = actual.every(value => value === actual[0]);
  let r2 = null;
  if (!constantActual) {
    const centered = actual.map(value => value - mean);
    const centeredIsFinite = centered.every(Number.isFinite);
    const maxDeviation = centeredIsFinite
      ? centered.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0)
      : actual.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
    const total = centeredIsFinite
      ? centered.reduce((sum, value) => sum + (value / maxDeviation) ** 2, 0)
      : actual.reduce((sum, value) => sum + (value / maxDeviation - mean / maxDeviation) ** 2, 0);
    const error = actual.reduce((sum, value, index) => {
      const residual = predicted[index] - value;
      const scaledResidual = Number.isFinite(residual)
        ? residual / maxDeviation
        : predicted[index] / maxDeviation - value / maxDeviation;
      return sum + scaledResidual ** 2;
    }, 0);
    r2 = 1 - error / total;
    if (!Number.isFinite(r2)) throw new RangeError('r2 is outside the finite numeric range');
  }
  return { count: actual.length, mae, mse, rmse, r2 };
}

/** Fit a constant-prediction baseline from training targets only. */
export function fitMeanBaseline(input) {
  requireObject(input, 'input');
  const targets = numericSeries(input.targets, 'targets');
  return { kind: 'meanBaseline', mean: finiteMean(targets, 'training target mean'), sampleCount: targets.length };
}

/** Predict with a fitted training-mean baseline for a requested row count. */
export function predictMeanBaseline(input) {
  requireObject(input, 'input');
  const model = requireObject(input.model, 'model');
  if (model.kind !== 'meanBaseline' || !Number.isSafeInteger(model.sampleCount) || model.sampleCount < 1) {
    throw new TypeError('model must be a fitted meanBaseline model');
  }
  const mean = finiteNumber(model.mean, 'model.mean');
  const count = safeCount(input.count, 'count');
  return { predictions: Array(count).fill(mean) };
}

/** Metrics for integer class labels; absent class denominators score as zero. */
export function classificationMetrics(input) {
  requireObject(input, 'input');
  const actual = labels(input.actual, 'actual');
  const predicted = labels(input.predicted, 'predicted');
  if (actual.length !== predicted.length) throw new RangeError('actual and predicted must have the same length');
  const classes = [...new Set([...actual, ...predicted])].sort((a, b) => a - b);
  if (classes.length > MAX_FEATURES) throw new RangeError(`classification supports at most ${MAX_FEATURES} classes`);
  const indexByLabel = new Map(classes.map((label, index) => [label, index]));
  const confusionMatrix = classes.map(() => classes.map(() => 0));
  let correct = 0;
  for (let index = 0; index < actual.length; index += 1) {
    confusionMatrix[indexByLabel.get(actual[index])][indexByLabel.get(predicted[index])] += 1;
    if (actual[index] === predicted[index]) correct += 1;
  }
  let precisionTotal = 0, recallTotal = 0, f1Total = 0;
  for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
    const truePositive = confusionMatrix[classIndex][classIndex];
    const predictedCount = confusionMatrix.reduce((sum, row) => sum + row[classIndex], 0);
    const actualCount = confusionMatrix[classIndex].reduce((sum, count) => sum + count, 0);
    const precision = predictedCount === 0 ? 0 : truePositive / predictedCount;
    const recall = actualCount === 0 ? 0 : truePositive / actualCount;
    precisionTotal += precision;
    recallTotal += recall;
    f1Total += precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  }
  return {
    count: actual.length,
    classes,
    confusionMatrix,
    accuracy: correct / actual.length,
    macroPrecision: precisionTotal / classes.length,
    macroRecall: recallTotal / classes.length,
    macroF1: f1Total / classes.length,
  };
}

function labels(value, label) {
  const result = requireArray(value, label, { min: 1 });
  result.forEach((item, index) => {
    if (!Number.isSafeInteger(item)) throw new TypeError(`${label}[${index}] must be a safe integer class label`);
  });
  return result.slice();
}

/** Select declared dataset columns and reject known direct leakage names. */
export function selectFeatures(input) {
  requireObject(input, 'input');
  const dataset = validateDataset(input.dataset);
  const requested = requireArray(input.featureNames, 'featureNames', { min: 1, max: MAX_FEATURES });
  if (requested.some(name => typeof name !== 'string' || name.length === 0)) {
    throw new TypeError('featureNames entries must be non-empty strings');
  }
  if (new Set(requested).size !== requested.length) throw new RangeError('featureNames must not contain duplicates');
  const featureIndices = requested.map(name => {
    if (isKnownLeakageName(name, dataset) || name === dataset.targetName) {
      throw new RangeError(`feature ${name} is a known target, identifier, future, hidden, or configured-fault field`);
    }
    const index = dataset.featureNames.indexOf(name);
    if (index < 0) throw new RangeError(`unknown dataset feature ${name}`);
    return index;
  });
  return { featureNames: requested.slice(), featureIndices };
}

function isKnownLeakageName(name, dataset) {
  if (dataset?.sourceKind === 'synthetic-watch' && ['mechanicalHz', 'quartzHz', 'softwareHz'].includes(name)) return true;
  const tokens = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some(token => [
    'id', 'runid', 'conditionid', 'target', 'label', 'future', 'horizon', 'next', 'lead',
    'hidden', 'fault', 'configured', 'injected', 'groundtruth', 'truth',
  ].includes(token));
}

function validateDataset(value) {
  const dataset = requireObject(value, 'dataset');
  if (typeof dataset.sourceKind !== 'string' || dataset.sourceKind.trim() === '') {
    throw new TypeError('dataset.sourceKind must be a non-empty string');
  }
  const featureNames = requireArray(dataset.featureNames, 'dataset.featureNames', { min: 1, max: MAX_FEATURES });
  if (featureNames.some(name => typeof name !== 'string' || name.length === 0) || new Set(featureNames).size !== featureNames.length) {
    throw new TypeError('dataset.featureNames must contain unique non-empty strings');
  }
  if (dataset.targetName !== undefined && (typeof dataset.targetName !== 'string' || dataset.targetName.length === 0)) {
    throw new TypeError('dataset.targetName must be a non-empty string when supplied');
  }
  const records = requireArray(dataset.records, 'dataset.records', { min: 1 });
  records.forEach((record, index) => {
    requireObject(record, `dataset.records[${index}]`);
    if (typeof record.runId !== 'string' || record.runId.length === 0) throw new TypeError(`dataset.records[${index}].runId must be a non-empty string`);
    if (typeof record.conditionId !== 'string' || record.conditionId.length === 0) throw new TypeError(`dataset.records[${index}].conditionId must be a non-empty string`);
    const features = vector(record.features, `dataset.records[${index}].features`);
    if (features.length !== featureNames.length) throw new RangeError(`dataset.records[${index}].features must align with dataset.featureNames`);
    if (Object.hasOwn(record, 'target')) finiteNumber(record.target, `dataset.records[${index}].target`);
  });
  return { ...dataset, featureNames, records };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

const objectSchema = { type: 'object' };
const numberArraySchema = { type: 'array', minItems: 1, maxItems: MAX_RECORDS, items: { type: 'number' } };
const matrixSchema = { type: 'array', minItems: 1, maxItems: MAX_RECORDS, items: { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: { type: 'number' } } };
const stringArraySchema = { type: 'array', minItems: 1, maxItems: MAX_FEATURES, items: { type: 'string' } };
const recordArraySchema = { type: 'array', minItems: 2, maxItems: MAX_RECORDS, items: objectSchema };

function descriptor(id, title, inputSchema, exampleInput, expected, run, formula, caveats) {
  return {
    id: `ml.${id}`,
    title,
    description: title,
    kind: 'atomic',
    dependsOn: [],
    inputSchema,
    outputSchema: objectSchema,
    examples: [{ input: exampleInput, expected }],
    run,
    formula,
    caveats,
  };
}

export const capabilities = [
  descriptor('splitByGroup', 'Split records by connected groups', {
    type: 'object', properties: { records: recordArraySchema, groupBy: { type: 'string' }, testFraction: { type: 'number', minimum: 0, maximum: 1 }, seed: { type: 'integer', minimum: 0, maximum: 4_294_967_295 } }, required: ['records'], additionalProperties: false,
  }, { records: [{ runId: 'r1', conditionId: 'c1' }, { runId: 'r2', conditionId: 'c2' }], testFraction: 0.5, seed: 7 }, {
    train: [{ runId: 'r1', conditionId: 'c1' }], test: [{ runId: 'r2', conditionId: 'c2' }],
    trainIndices: [0], testIndices: [1], groups: { train: [0], test: [1] }, groupCount: 2, seed: 7, testFraction: 0.5, groupBy: 'conditionId',
  }, splitByGroup, 'Deterministically shuffle connected run/condition groups with a seeded PRNG, then hold out a rounded fraction of groups.', 'Groups joined through runId, conditionId, and selected groupBy fields never cross splits. Small connected datasets may have too few independent groups; semantic leakage requires domain review.'),
  descriptor('fitStandardizer', 'Fit training feature scaling', {
    type: 'object', properties: { features: matrixSchema }, required: ['features'], additionalProperties: false,
  }, { features: [[1, 5], [3, 5]] }, {
    kind: 'standardizer', version: 1, means: [2, 5], scales: [1, 1], constantColumns: [false, true], featureCount: 2, sampleCount: 2, scaleMethod: 'population-standard-deviation',
  }, fitStandardizer, 'For each feature, subtract the training mean and divide by the population standard deviation. Constant training features use scale 1, so their training values transform to zero while later changed values remain visible.', 'Fit on training records only. Applying it to holdout data must reuse this model unchanged.'),
  descriptor('transformStandardizer', 'Transform features with a fitted scaler', {
    type: 'object', properties: { model: objectSchema, features: matrixSchema }, required: ['model', 'features'], additionalProperties: false,
  }, { model: { kind: 'standardizer', version: 1, means: [2], scales: [1], constantColumns: [false], featureCount: 1, sampleCount: 2, scaleMethod: 'population-standard-deviation' }, features: [[3]] }, { features: [[1]] }, transformStandardizer, 'Apply (value - training mean) / training scale independently per feature.', 'No parameters are refit from the input rows.'),
  descriptor('regressionMetrics', 'Measure numeric prediction errors', {
    type: 'object', properties: { actual: numberArraySchema, predicted: numberArraySchema }, required: ['actual', 'predicted'], additionalProperties: false,
  }, { actual: [1, 3], predicted: [2, 2] }, { count: 2, mae: 1, mse: 1, rmse: 1, r2: 0 }, regressionMetrics, 'MAE is mean absolute error; MSE is mean squared error; RMSE is its square root; R² compares residual squared error with variation around the actual mean.', 'R² is null when all actual values are identical. Metrics do not fit or expose a baseline from evaluation targets.'),
  descriptor('fitMeanBaseline', 'Fit a training-mean baseline', {
    type: 'object', properties: { targets: numberArraySchema }, required: ['targets'], additionalProperties: false,
  }, { targets: [1, 3, 5] }, { kind: 'meanBaseline', mean: 3, sampleCount: 3 }, fitMeanBaseline, 'Predict the mean of the supplied training targets for every row.', 'Fit with training targets only; do not fit this baseline using held-out actual targets.'),
  descriptor('predictMeanBaseline', 'Predict with a fitted mean baseline', {
    type: 'object', properties: { model: objectSchema, count: { type: 'integer', minimum: 1, maximum: MAX_RECORDS } }, required: ['model', 'count'], additionalProperties: false,
  }, { model: { kind: 'meanBaseline', mean: 3, sampleCount: 3 }, count: 2 }, { predictions: [3, 3] }, predictMeanBaseline, 'Repeat the fitted training mean for the requested row count.', 'This baseline contains no learned relationship between features and target.'),
  descriptor('classificationMetrics', 'Measure integer-label classification', {
    type: 'object', properties: { actual: { type: 'array', minItems: 1, maxItems: MAX_RECORDS, items: { type: 'integer' } }, predicted: { type: 'array', minItems: 1, maxItems: MAX_RECORDS, items: { type: 'integer' } } }, required: ['actual', 'predicted'], additionalProperties: false,
  }, { actual: [0, 1, 1], predicted: [0, 0, 1] }, { count: 3, classes: [0, 1], confusionMatrix: [[1, 0], [1, 1]], accuracy: 2 / 3, macroPrecision: 0.75, macroRecall: 0.75, macroF1: 2 / 3 }, classificationMetrics, 'Rows of the confusion matrix are actual classes and columns are predicted classes. Macro scores average each class equally.', 'Labels are safe integers. A class with no predicted or actual examples receives zero for the corresponding precision or recall.'),
  descriptor('selectFeatures', 'Select declared safe feature columns', {
    type: 'object', properties: { dataset: objectSchema, featureNames: stringArraySchema }, required: ['dataset', 'featureNames'], additionalProperties: false,
  }, { dataset: { sourceKind: 'fixture', featureNames: ['earlyRate', 'ambient'], targetName: 'lateError', records: [{ runId: 'r1', conditionId: 'c1', features: [4, 20], target: 1 }] }, featureNames: ['ambient', 'earlyRate'] }, { featureNames: ['ambient', 'earlyRate'], featureIndices: [1, 0] }, selectFeatures, 'Map explicitly selected declared feature names to their numeric-vector positions.', 'Rejects known ID, target, future, hidden, and configured-fault names; cannot detect arbitrary disguised semantic leakage.'),
];
