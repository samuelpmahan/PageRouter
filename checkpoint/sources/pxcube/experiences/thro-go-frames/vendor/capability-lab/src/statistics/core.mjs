const DENOMINATORS = new Set(['population', 'sample']);
const MAX = Number.MAX_VALUE;

function objectInput(input, label = 'input') {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  return input;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function finiteArray(values, label, minimumLength = 1) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  if (values.length < minimumLength) {
    throw new RangeError(`${label} must contain at least ${minimumLength} value${minimumLength === 1 ? '' : 's'}`);
  }
  for (let index = 0; index < values.length; index += 1) {
    finiteNumber(values[index], `${label}[${index}]`);
  }
  return values;
}

function denominator(value = 'population') {
  if (!DENOMINATORS.has(value)) {
    throw new RangeError("denominator must be 'population' or 'sample'");
  }
  return value;
}

function compensatedSum(values) {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    if (!Number.isFinite(next)) throw new RangeError('numeric result is outside the finite double range');
    if (Math.abs(sum) >= Math.abs(value)) correction += (sum - next) + value;
    else correction += (value - next) + sum;
    sum = next;
  }
  const result = sum + correction;
  if (!Number.isFinite(result)) throw new RangeError('numeric result is outside the finite double range');
  return result;
}

function stableMean(values) {
  // Divide first so a long list near Number.MAX_VALUE cannot overflow its sum.
  const direct = compensatedSum(values.map((value) => value / values.length));
  if (direct !== 0 || values.every((value) => value === 0)) return direct;

  // Division can erase subnormals (for example MIN_VALUE / 2). Recover that
  // case by averaging values on their own scale before restoring the scale.
  let scale = 0;
  for (const value of values) scale = Math.max(scale, Math.abs(value));
  const fraction = compensatedSum(values.map((value) => value / scale)) / values.length;
  const result = scale * fraction;
  if (!Number.isFinite(result)) throw new RangeError('mean is outside the finite double range');
  return result;
}

function varianceFromM2(m2, count, mode) {
  const selected = denominator(mode);
  if (selected === 'sample' && count < 2) {
    throw new RangeError('sample variance requires at least two values');
  }
  const result = m2 / (selected === 'sample' ? count - 1 : count);
  if (!Number.isFinite(result)) throw new RangeError('variance is outside the finite double range');
  return Math.max(0, result);
}

function validateOnlineState(state) {
  objectInput(state, 'state');
  const count = state.count;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('state.count must be a nonnegative safe integer');
  }
  const meanValue = finiteNumber(state.mean, 'state.mean');
  const m2 = finiteNumber(state.m2, 'state.m2');
  if (m2 < 0) throw new RangeError('state.m2 must be nonnegative');
  if (Object.prototype.hasOwnProperty.call(state, 'variance')) {
    const derivedVariance = finiteNumber(state.variance, 'state.variance');
    if (derivedVariance < 0) throw new RangeError('state.variance must be nonnegative');
  }
  if (count === 0 && (meanValue !== 0 || m2 !== 0)) {
    throw new RangeError('an empty online state must use mean 0 and m2 0');
  }
  if (count === 1 && m2 !== 0) {
    throw new RangeError('a one-value state must have m2 0');
  }
  return { count, mean: meanValue, m2 };
}

function updateState(state, value) {
  const item = finiteNumber(value, 'value');
  if (state.count === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('online count exceeded the safe integer limit');
  }
  const count = state.count + 1;
  if (state.count === 0) return { count, mean: item, m2: 0 };

  const delta = item - state.mean;
  if (!Number.isFinite(delta)) throw new RangeError('online update is outside the finite double range');
  const nextMean = state.mean + delta / count;
  const secondDelta = item - nextMean;
  const nextM2 = state.m2 + delta * secondDelta;
  if (!Number.isFinite(nextMean) || !Number.isFinite(nextM2)) {
    throw new RangeError('online moments are outside the finite double range');
  }
  return { count, mean: nextMean, m2: Math.max(0, nextM2) };
}

function pairedArrays(x, y, xLabel = 'x', yLabel = 'y', minimumLength = 1) {
  finiteArray(x, xLabel, minimumLength);
  finiteArray(y, yLabel, minimumLength);
  if (x.length !== y.length) throw new RangeError(`${xLabel} and ${yLabel} must have the same length`);
}

function normalizedWeights(weights) {
  let maxWeight = 0;
  for (const weight of weights) {
    if (weight < 0) throw new RangeError('weights must be nonnegative');
    if (weight > maxWeight) maxWeight = weight;
  }
  if (maxWeight === 0) throw new RangeError('weights must have a positive total');
  const scaled = weights.map((weight) => weight / maxWeight);
  const total = compensatedSum(scaled);
  if (total <= 0) throw new RangeError('weights must have a positive total');
  return { scaled, total };
}

function weightedMeanValue(values, weights) {
  const { scaled, total } = normalizedWeights(weights);
  let firstValue;
  let hasActiveValue = false;
  let allActiveValuesEqual = true;
  for (let index = 0; index < values.length; index += 1) {
    if (scaled[index] === 0) continue;
    if (!hasActiveValue) {
      firstValue = values[index];
      hasActiveValue = true;
    } else if (values[index] !== firstValue) {
      allActiveValuesEqual = false;
      break;
    }
  }
  if (allActiveValuesEqual && hasActiveValue) return firstValue;
  const direct = compensatedSum(values.map((value, index) => (scaled[index] / total) * value));
  if (direct !== 0 || values.every((value) => value === 0)) return direct;

  // Preserve a representable subnormal average when multiplying each value
  // by its weight fraction would round every term to zero.
  let scale = 0;
  for (const value of values) scale = Math.max(scale, Math.abs(value));
  const fraction = compensatedSum(values.map((value, index) => (scaled[index] / total) * (value / scale)));
  const result = scale * fraction;
  if (!Number.isFinite(result)) throw new RangeError('weighted mean is outside the finite double range');
  return result;
}

function weightedVarianceValue(values, weights, center) {
  const { scaled, total } = normalizedWeights(weights);
  const active = [];
  for (let index = 0; index < values.length; index += 1) {
    if (scaled[index] === 0) continue;
    const value = values[index];
    const difference = value - center;
    if (!Number.isFinite(difference)) throw new RangeError('weighted variance is outside the finite double range');
    active.push({ difference, weight: scaled[index] });
  }
  let scale = 0;
  for (const { difference } of active) scale = Math.max(scale, Math.abs(difference));
  if (scale === 0) return 0;
  const normalizedSquares = compensatedSum(active.map(({ difference, weight }) => {
    const ratio = difference / scale;
    return (weight / total) * ratio * ratio;
  }));
  const standardDeviation = scale * Math.sqrt(normalizedSquares);
  if (!Number.isFinite(standardDeviation) || standardDeviation > Math.sqrt(MAX)) {
    throw new RangeError('weighted variance is outside the finite double range');
  }
  const result = standardDeviation * standardDeviation;
  if (!Number.isFinite(result)) throw new RangeError('weighted variance is outside the finite double range');
  return result;
}

function welchResult(meanA, meanB, varianceA, varianceB, countA, countB) {
  const difference = meanA - meanB;
  if (!Number.isFinite(difference)) throw new RangeError('mean difference is outside the finite double range');
  const componentA = varianceA / countA;
  const componentB = varianceB / countB;
  const standardError = Math.hypot(Math.sqrt(componentA), Math.sqrt(componentB));
  if (!Number.isFinite(standardError)) throw new RangeError('Welch standard error is outside the finite double range');
  if (standardError === 0) throw new RangeError('Welch standard error must be positive for an inferential comparison');
  const scale = Math.max(componentA, componentB);
  const scaledA = componentA / scale;
  const scaledB = componentB / scale;
  const degreesOfFreedom = ((scaledA + scaledB) ** 2)
    / (scaledA ** 2 / (countA - 1) + scaledB ** 2 / (countB - 1));
  const testStatistic = difference / standardError;
  if (!Number.isFinite(degreesOfFreedom) || !Number.isFinite(testStatistic)) {
    throw new RangeError('Welch result is outside the finite double range');
  }
  return { meanA, meanB, difference, standardError, degreesOfFreedom, testStatistic };
}

export function mean(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  return { value: stableMean(values) };
}

export function variance(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  const mode = denominator(input.denominator);
  const state = values.reduce((current, value) => updateState(current, value), { count: 0, mean: 0, m2: 0 });
  return { value: varianceFromM2(state.m2, state.count, mode) };
}

export function standardDeviation(input) {
  const result = variance(input).value;
  return { value: Math.sqrt(result) };
}

export function weightedMean(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  const weights = finiteArray(input.weights, 'weights');
  if (values.length !== weights.length) throw new RangeError('values and weights must have the same length');
  return { value: weightedMeanValue(values, weights) };
}

export function weightedVariance(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  const weights = finiteArray(input.weights, 'weights');
  if (values.length !== weights.length) throw new RangeError('values and weights must have the same length');
  const center = weightedMeanValue(values, weights);
  return { value: weightedVarianceValue(values, weights, center) };
}

export function onlineUpdate(input) {
  objectInput(input);
  const state = validateOnlineState(input.state);
  const next = updateState(state, input.value);
  return { ...next, variance: varianceFromM2(next.m2, next.count, input.denominator) };
}

export function onlineMoments(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  const mode = denominator(input.denominator);
  const state = values.reduce((current, value) => updateState(current, value), { count: 0, mean: 0, m2: 0 });
  return { ...state, variance: varianceFromM2(state.m2, state.count, mode) };
}

export function covariance(input) {
  objectInput(input);
  const { x, y } = input;
  pairedArrays(x, y);
  const mode = denominator(input.denominator);
  let meanX = 0;
  let meanY = 0;
  let coMoment = 0;
  for (let index = 0; index < x.length; index += 1) {
    const count = index + 1;
    const deltaX = x[index] - meanX;
    const deltaY = y[index] - meanY;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      throw new RangeError('covariance is outside the finite double range');
    }
    meanX += deltaX / count;
    meanY += deltaY / count;
    coMoment += deltaX * (y[index] - meanY);
    if (!Number.isFinite(meanX) || !Number.isFinite(meanY) || !Number.isFinite(coMoment)) {
      throw new RangeError('covariance is outside the finite double range');
    }
  }
  if (mode === 'sample' && x.length < 2) {
    throw new RangeError('sample covariance requires at least two paired values');
  }
  return { value: coMoment / (mode === 'sample' ? x.length - 1 : x.length) };
}

export function correlation(input) {
  objectInput(input);
  const { x, y } = input;
  pairedArrays(x, y);
  const covarianceValue = covariance({ x, y, denominator: 'population' }).value;
  const varianceX = variance({ values: x, denominator: 'population' }).value;
  const varianceY = variance({ values: y, denominator: 'population' }).value;
  const sdX = Math.sqrt(varianceX);
  const sdY = Math.sqrt(varianceY);
  if (sdX === 0 || sdY === 0) throw new RangeError('correlation is undefined for zero variance');
  const result = (covarianceValue / sdX) / sdY;
  if (!Number.isFinite(result)) throw new RangeError('correlation is outside the finite double range');
  return { value: Math.max(-1, Math.min(1, result)) };
}

export function zScores(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  const center = mean({ values }).value;
  const sd = standardDeviation({ values, denominator: input.denominator }).value;
  if (sd === 0) throw new RangeError('z scores are undefined for zero variance');
  const standardized = values.map((value) => {
    const score = (value - center) / sd;
    if (!Number.isFinite(score)) throw new RangeError('z score is outside the finite double range');
    return score;
  });
  return { values: standardized, mean: center, standardDeviation: sd };
}

export function standardizedSummary(input) {
  objectInput(input);
  const values = finiteArray(input.values, 'values');
  const mode = denominator(input.denominator);
  return {
    mean: mean({ values }).value,
    standardDeviation: standardDeviation({ values, denominator: mode }).value,
    zScores: zScores({ values, denominator: mode }).values
  };
}

export function pairedDifferences(input) {
  objectInput(input);
  const { x, y } = input;
  pairedArrays(x, y);
  const values = x.map((value, index) => {
    const difference = value - y[index];
    if (!Number.isFinite(difference)) throw new RangeError('paired difference is outside the finite double range');
    return difference;
  });
  return { values };
}

export function welchMeanDifference(input) {
  objectInput(input);
  const a = finiteArray(input.a, 'a', 2);
  const b = finiteArray(input.b, 'b', 2);
  return welchResult(
    mean({ values: a }).value,
    mean({ values: b }).value,
    variance({ values: a, denominator: 'sample' }).value,
    variance({ values: b, denominator: 'sample' }).value,
    a.length,
    b.length
  );
}

const numberArray = (minimumLength = 1) => ({
  type: 'array',
  items: { type: 'number' },
  minItems: minimumLength
});
const denominatorProperty = { type: 'string', enum: ['population', 'sample'] };
const schema = (properties, required) => ({
  type: 'object', properties, required, additionalProperties: false
});
const valuesSchema = numberArray();
const valuesDenominatorSchema = schema({ values: valuesSchema, denominator: denominatorProperty }, ['values']);
const valuesWeightsSchema = schema({ values: valuesSchema, weights: valuesSchema }, ['values', 'weights']);
const pairedSchema = schema({ x: valuesSchema, y: valuesSchema }, ['x', 'y']);
const scalarSchema = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false };
const valuesResultSchema = { type: 'object', properties: { values: numberArray() }, required: ['values'], additionalProperties: false };
const denominatorFor = (input) => input.denominator ?? 'population';
const descriptor = (id, title, description, kind, dependsOn, inputSchema, outputSchema, example, run, formula, caveats = '') => ({
  id: `statistics.${id}`,
  title,
  description,
  kind,
  dependsOn,
  inputSchema,
  outputSchema,
  examples: [example],
  run,
  formula,
  caveats
});

export const capabilities = [
  descriptor('mean', 'Arithmetic mean', 'The central average of a nonempty finite sample.', 'atomic', [],
    schema({ values: valuesSchema }, ['values']), scalarSchema,
    { input: { values: [1, 2, 3] }, expected: { value: 2 } },
    (input) => mean(input), 'sum(xᵢ / n), using compensated summation.'),
  descriptor('variance', 'Variance', 'Population or sample spread, computed with Welford updates to reduce cancellation.', 'atomic', [],
    valuesDenominatorSchema, scalarSchema,
    { input: { values: [1, 2, 3], denominator: 'population' }, expected: { value: 2 / 3 } },
    (input) => variance(input), 'M₂ / n for population variance; M₂ / (n - 1) for sample variance.', 'Sample variance requires at least two values; population variance accepts one.'),
  descriptor('weightedMean', 'Weighted mean', 'Average with nonnegative weights and a positive total weight.', 'atomic', [],
    valuesWeightsSchema, scalarSchema,
    { input: { values: [1, 3, 10], weights: [1, 2, 1] }, expected: { value: 4.25 } },
    (input) => weightedMean(input), 'Σ(wᵢxᵢ) / Σwᵢ; weights are scaled before summing.'),
  descriptor('weightedVariance', 'Weighted population variance', 'Spread around the weighted mean using a population denominator.', 'composed', ['statistics.weightedMean'],
    valuesWeightsSchema, scalarSchema,
    { input: { values: [1, 3, 10], weights: [1, 2, 1] }, expected: { value: 11.6875 } },
    (input, ctx) => ({ value: weightedVarianceValue(input.values, input.weights,
      ctx.call('statistics.weightedMean', { values: input.values, weights: input.weights }).value) }),
    'Σ(wᵢ(xᵢ - μw)²) / Σwᵢ; weighted mean is obtained through the declared dependency.',
    'This is a population-weighted variance. Reliability-weight sample corrections are not applied.'),
  descriptor('onlineUpdate', 'Online moment update', 'Add one observation to a retained count, mean, and M₂ state without storing past values.', 'atomic', [],
    schema({
      state: schema({ count: { type: 'integer', minimum: 0 }, mean: { type: 'number' }, m2: { type: 'number', minimum: 0 }, variance: { type: 'number', minimum: 0 } }, ['count', 'mean', 'm2']),
      value: { type: 'number' }, denominator: denominatorProperty
    }, ['state', 'value']),
    schema({ count: { type: 'integer', minimum: 1 }, mean: { type: 'number' }, m2: { type: 'number', minimum: 0 }, variance: { type: 'number', minimum: 0 } }, ['count', 'mean', 'm2', 'variance']),
    { input: { state: { count: 0, mean: 0, m2: 0 }, value: 5 }, expected: { count: 1, mean: 5, m2: 0, variance: 0 } },
    (input) => onlineUpdate(input), 'Welford update: δ = x - μ; μ′ = μ + δ/n′; M₂′ = M₂ + δ(x - μ′).',
    'The empty state is explicitly {count: 0, mean: 0, m2: 0}. A returned variance may be passed back as optional derived metadata; it is validated, ignored, and recomputed from count/mean/m2. Sample variance is undefined until the count reaches two.'),
  descriptor('onlineMoments', 'Online moments', 'Summarize observations with the same bounded-state Welford update used for streaming.', 'atomic', [],
    valuesDenominatorSchema,
    schema({ count: { type: 'integer', minimum: 1 }, mean: { type: 'number' }, m2: { type: 'number', minimum: 0 }, variance: { type: 'number', minimum: 0 } }, ['count', 'mean', 'm2', 'variance']),
    { input: { values: [1, 2, 3], denominator: 'population' }, expected: { count: 3, mean: 2, m2: 2, variance: 2 / 3 } },
    (input) => onlineMoments(input), 'Welford updates with constant memory; M₂ is the accumulated squared deviation.'),
  descriptor('covariance', 'Covariance', 'Joint linear variation for paired samples.', 'atomic', [],
    schema({ x: valuesSchema, y: valuesSchema, denominator: denominatorProperty }, ['x', 'y']), scalarSchema,
    { input: { x: [2, 4, 6], y: [1, 3, 5], denominator: 'sample' }, expected: { value: 4 } },
    (input) => covariance(input), 'Running co-moment divided by n for population or n - 1 for sample covariance.',
    'The two arrays must be nonempty and equal in length; sample covariance requires at least two pairs.'),
  descriptor('correlation', 'Pearson correlation', 'Scale-free linear association for two paired numeric samples.', 'composed', ['statistics.covariance', 'statistics.variance'],
    pairedSchema, scalarSchema,
    { input: { x: [2, 4, 6], y: [1, 3, 5] }, expected: { value: 1 } },
    (input, ctx) => {
      const covarianceValue = ctx.call('statistics.covariance', { x: input.x, y: input.y, denominator: 'population' }).value;
      const varianceX = ctx.call('statistics.variance', { values: input.x, denominator: 'population' }).value;
      const varianceY = ctx.call('statistics.variance', { values: input.y, denominator: 'population' }).value;
      const sdX = Math.sqrt(varianceX);
      const sdY = Math.sqrt(varianceY);
      if (sdX === 0 || sdY === 0) throw new RangeError('correlation is undefined for zero variance');
      return { value: Math.max(-1, Math.min(1, (covarianceValue / sdX) / sdY)) };
    }, 'Cov(X,Y) / (sd(X) sd(Y)); the same population denominator is used for each term.',
    'Undefined if either input has zero variance.'),
  descriptor('standardDeviation', 'Standard deviation', 'Square root of variance with an explicit denominator convention.', 'composed', ['statistics.variance'],
    valuesDenominatorSchema, scalarSchema,
    { input: { values: [1, 2, 3], denominator: 'sample' }, expected: { value: 1 } },
    (input, ctx) => ({ value: Math.sqrt(ctx.call('statistics.variance', { values: input.values, denominator: denominatorFor(input) }).value) }),
    'sqrt(variance).'),
  descriptor('zScores', 'Z scores', 'Center values at their mean and divide by their selected standard deviation.', 'composed', ['statistics.mean', 'statistics.standardDeviation'],
    valuesDenominatorSchema,
    schema({ values: numberArray(), mean: { type: 'number' }, standardDeviation: { type: 'number', minimum: 0 } }, ['values', 'mean', 'standardDeviation']),
    { input: { values: [2, 4, 6] }, expected: { values: [-Math.sqrt(3 / 2), 0, Math.sqrt(3 / 2)], mean: 4, standardDeviation: Math.sqrt(8 / 3) } },
    (input, ctx) => {
      const center = ctx.call('statistics.mean', { values: input.values }).value;
      const sd = ctx.call('statistics.standardDeviation', { values: input.values, denominator: denominatorFor(input) }).value;
      if (sd === 0) throw new RangeError('z scores are undefined for zero variance');
      const standardized = input.values.map((value) => {
        const score = (value - center) / sd;
        if (!Number.isFinite(score)) throw new RangeError('z score is outside the finite double range');
        return score;
      });
      return { values: standardized, mean: center, standardDeviation: sd };
    }, '(xᵢ - mean(x)) / sd(x).', 'Constant samples have no finite z scores and are rejected.'),
  descriptor('standardizedSummary', 'Standardized summary', 'Report the mean and spread together with their derived z scores.', 'composed', ['statistics.mean', 'statistics.standardDeviation', 'statistics.zScores'],
    valuesDenominatorSchema,
    schema({ mean: { type: 'number' }, standardDeviation: { type: 'number', minimum: 0 }, zScores: numberArray() }, ['mean', 'standardDeviation', 'zScores']),
    { input: { values: [2, 4, 6] }, expected: { mean: 4, standardDeviation: Math.sqrt(8 / 3), zScores: [-Math.sqrt(3 / 2), 0, Math.sqrt(3 / 2)] } },
    (input, ctx) => {
      const mode = denominatorFor(input);
      const center = ctx.call('statistics.mean', { values: input.values }).value;
      const sd = ctx.call('statistics.standardDeviation', { values: input.values, denominator: mode }).value;
      const scores = ctx.call('statistics.zScores', { values: input.values, denominator: mode }).values;
      return { mean: center, standardDeviation: sd, zScores: scores };
    }, 'Combines the declared mean, standard-deviation, and z-score capabilities.',
    'This composition has dependency depth three from variance → standard deviation → z scores → summary.'),
  descriptor('pairedDifferences', 'Paired differences', 'Subtract the second observation from its matched first observation.', 'atomic', [],
    pairedSchema, valuesResultSchema,
    { input: { x: [4, 8, 3], y: [1, 5, 7] }, expected: { values: [3, 3, -4] } },
    (input) => pairedDifferences(input), 'dᵢ = xᵢ - yᵢ.', 'Pair order and equal array lengths are required.'),
  descriptor('welchMeanDifference', 'Welch independent-groups comparison', 'Estimate the mean difference with a Welch standard error and degrees of freedom.', 'composed', ['statistics.mean', 'statistics.variance'],
    schema({ a: numberArray(2), b: numberArray(2) }, ['a', 'b']),
    schema({ meanA: { type: 'number' }, meanB: { type: 'number' }, difference: { type: 'number' }, standardError: { type: 'number', minimum: 0 }, degreesOfFreedom: { type: 'number', minimum: 0 }, testStatistic: { type: 'number' } }, ['meanA', 'meanB', 'difference', 'standardError', 'degreesOfFreedom', 'testStatistic']),
    { input: { a: [2, 4, 6], b: [1, 2, 3] }, expected: { meanA: 4, meanB: 2, difference: 2, standardError: Math.sqrt(5 / 3), degreesOfFreedom: 50 / 17, testStatistic: 2 / Math.sqrt(5 / 3) } },
    (input, ctx) => {
      const meanA = ctx.call('statistics.mean', { values: input.a }).value;
      const meanB = ctx.call('statistics.mean', { values: input.b }).value;
      const varianceA = ctx.call('statistics.variance', { values: input.a, denominator: 'sample' }).value;
      const varianceB = ctx.call('statistics.variance', { values: input.b, denominator: 'sample' }).value;
      return welchResult(meanA, meanB, varianceA, varianceB, input.a.length, input.b.length);
    }, 'Difference = mean(A) - mean(B); Welch SE = sqrt(sA²/nA + sB²/nB), with Welch-Satterthwaite degrees of freedom.',
    'This reports a test statistic but no p-value because no t-distribution CDF is included. Samples must each contain at least two observations; zero standard error is rejected.')
];
