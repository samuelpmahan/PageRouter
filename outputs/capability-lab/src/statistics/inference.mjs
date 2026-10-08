import { mean } from './core.mjs';
import { pairedDifferences } from './core.mjs';
import { quantile } from './order.mjs';

const UINT32_MAX = 0xffff_ffff;
const MAX_REPLICATES = 1_000;
const MAX_SAMPLE_WORK = 100_000;
const ZERO_SEED_STATE = 0x6d2b79f5;

function objectInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('input must be an object');
  }
  return input;
}

function finiteValues(values, minimumLength = 1) {
  if (!Array.isArray(values)) throw new TypeError('values must be an array');
  if (values.length < minimumLength) {
    throw new RangeError(`values must contain at least ${minimumLength} value${minimumLength === 1 ? '' : 's'}`);
  }
  if (values.length > MAX_SAMPLE_WORK) throw new RangeError(`values exceed the ${MAX_SAMPLE_WORK}-sample work limit`);
  for (let index = 0; index < values.length; index += 1) {
    if (typeof values[index] !== 'number' || !Number.isFinite(values[index])) {
      throw new TypeError(`values[${index}] must be a finite number`);
    }
  }
  return values;
}

function unsignedSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new RangeError('seed must be an unsigned 32-bit integer');
  }
  return seed;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  if (state === 0) state = ZERO_SEED_STATE;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function validateBootstrap(input) {
  objectInput(input);
  const values = finiteValues(input.values, 2);
  if (!Number.isInteger(input.replicates) || input.replicates < 1 || input.replicates > MAX_REPLICATES) {
    throw new RangeError(`replicates must be an integer from 1 through ${MAX_REPLICATES}`);
  }
  const seed = unsignedSeed(input.seed);
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence)
    || input.confidence <= 0 || input.confidence >= 1) {
    throw new RangeError('confidence must be between 0 and 1, exclusive');
  }
  if (input.replicates * values.length > MAX_SAMPLE_WORK) {
    throw new RangeError(`bootstrap sample-work limit is ${MAX_SAMPLE_WORK} values across all replicates`);
  }
  return { values, replicates: input.replicates, seed, confidence: input.confidence };
}

function validatePaired(input) {
  objectInput(input);
  if (!Array.isArray(input.x) || !Array.isArray(input.y)) {
    throw new TypeError('x and y must be arrays');
  }
  if (input.x.length !== input.y.length) throw new RangeError('x and y must have the same length');
  finiteValues(input.x, 2);
  finiteValues(input.y, 2);
  return pairedDifferences({ x: input.x, y: input.y }).values;
}

export function resampleWithReplacement(input) {
  objectInput(input);
  const values = finiteValues(input.values);
  const sampleSize = input.sampleSize;
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > MAX_SAMPLE_WORK) {
    throw new RangeError(`sampleSize must be an integer from 1 through ${MAX_SAMPLE_WORK}`);
  }
  const seed = unsignedSeed(input.seed);
  const random = randomGenerator(seed);
  const result = Array(sampleSize);
  for (let index = 0; index < sampleSize; index += 1) {
    result[index] = values[Math.floor(random() * values.length)];
  }
  return { values: result, seed };
}

function bootstrapMeanCIWith(call, rawInput) {
  const { values, replicates, seed, confidence } = validateBootstrap(rawInput);
  const estimate = call('statistics.mean', { values }).value;
  const sampled = call('statistics.resampleWithReplacement', {
    values, sampleSize: replicates * values.length, seed
  }).values;
  const means = Array(replicates);
  for (let index = 0; index < replicates; index += 1) {
    const start = index * values.length;
    means[index] = call('statistics.mean', { values: sampled.slice(start, start + values.length) }).value;
  }
  const alpha = (1 - confidence) / 2;
  const lower = call('statistics.quantile', { values: means, probability: alpha }).value;
  const upper = call('statistics.quantile', { values: means, probability: 1 - alpha }).value;
  return { estimate, lower, upper, replicates, seed, confidence };
}

export function bootstrapMeanCI(input) {
  const functions = {
    'statistics.mean': mean,
    'statistics.resampleWithReplacement': resampleWithReplacement,
    'statistics.quantile': quantile
  };
  return bootstrapMeanCIWith((id, dependencyInput) => functions[id](dependencyInput), input);
}

export function bootstrapPairedDifferenceCI(input) {
  const differences = validatePaired(input);
  return bootstrapMeanCI({
    values: differences,
    replicates: input.replicates,
    seed: input.seed,
    confidence: input.confidence
  });
}

const valueArray = (minimumLength = 1, maximumLength = MAX_SAMPLE_WORK) => ({
  type: 'array', minItems: minimumLength, maxItems: maximumLength,
  items: { type: 'number' }
});
const objectSchema = (properties, required) => ({
  type: 'object', properties, required, additionalProperties: false
});
const numberSchema = { type: 'number' };
const uint32Schema = { type: 'integer', minimum: 0, maximum: UINT32_MAX };
const resultSchema = objectSchema({
  estimate: numberSchema,
  lower: numberSchema,
  upper: numberSchema,
  replicates: { type: 'integer', minimum: 1, maximum: MAX_REPLICATES },
  seed: uint32Schema,
  confidence: { type: 'number', minimum: 0, maximum: 1 }
}, ['estimate', 'lower', 'upper', 'replicates', 'seed', 'confidence']);
const bootstrapInputSchema = objectSchema({
  values: valueArray(2),
  replicates: { type: 'integer', minimum: 1, maximum: MAX_REPLICATES },
  seed: uint32Schema,
  confidence: { type: 'number', minimum: 0, maximum: 1 }
}, ['values', 'replicates', 'seed', 'confidence']);
const pairedBootstrapInputSchema = objectSchema({
  x: valueArray(2),
  y: valueArray(2),
  replicates: { type: 'integer', minimum: 1, maximum: MAX_REPLICATES },
  seed: uint32Schema,
  confidence: { type: 'number', minimum: 0, maximum: 1 }
}, ['x', 'y', 'replicates', 'seed', 'confidence']);

export const capabilities = [
  {
    id: 'statistics.resampleWithReplacement',
    title: 'Seeded resample with replacement',
    description: 'Draw a fixed-size sample using a recorded unsigned 32-bit seed.',
    kind: 'atomic',
    dependsOn: [],
    inputSchema: objectSchema({
      values: valueArray(),
      sampleSize: { type: 'integer', minimum: 1, maximum: MAX_SAMPLE_WORK },
      seed: uint32Schema
    }, ['values', 'sampleSize', 'seed']),
    outputSchema: objectSchema({ values: valueArray(), seed: uint32Schema }, ['values', 'seed']),
    examples: [{
      input: { values: [10, 20, 30], sampleSize: 6, seed: 1 },
      expected: { values: [10, 10, 20, 10, 20, 10], seed: 1 }
    }],
    run: (input) => resampleWithReplacement(input),
    formula: 'Xorshift32; each draw uses floor(u × n) to select an input index. Seed zero maps to a documented nonzero internal state. A bootstrap run draws all replicate samples from one continuous seeded stream.',
    caveats: `Sampling is with replacement; sampleSize is capped at ${MAX_SAMPLE_WORK}. The returned seed is the exact input seed.`
  },
  {
    id: 'statistics.bootstrapMeanCI',
    title: 'Bootstrap mean confidence interval',
    description: 'Build a percentile interval from deterministic bootstrap means.',
    kind: 'composed',
    dependsOn: ['statistics.resampleWithReplacement', 'statistics.mean', 'statistics.quantile'],
    inputSchema: bootstrapInputSchema,
    outputSchema: resultSchema,
    examples: [{
      input: { values: [0, 10], replicates: 1, seed: 1, confidence: 0.8 },
      expected: { estimate: 5, lower: 0, upper: 0, replicates: 1, seed: 1, confidence: 0.8 }
    }],
    run: (input, ctx) => bootstrapMeanCIWith((id, dependencyInput) => ctx.call(id, dependencyInput), input),
    formula: 'Percentile bootstrap: resample n observations with replacement; report quantiles at (1 - confidence)/2 and 1 - (1 - confidence)/2.',
    caveats: `Requires at least two observations. This is an approximate percentile interval and may exclude the point estimate; few replicates give very coarse bounds. Replicates are capped at ${MAX_REPLICATES}, and replicates × sample count at ${MAX_SAMPLE_WORK} to keep trace size bounded.`
  },
  {
    id: 'statistics.bootstrapPairedDifferenceCI',
    title: 'Paired bootstrap difference interval',
    description: 'Bootstrap the mean of matched first-minus-second differences.',
    kind: 'composed',
    dependsOn: ['statistics.pairedDifferences', 'statistics.bootstrapMeanCI'],
    inputSchema: pairedBootstrapInputSchema,
    outputSchema: resultSchema,
    examples: [{
      input: { x: [2, 2], y: [1, 1], replicates: 5, seed: 7, confidence: 0.9 },
      expected: { estimate: 1, lower: 1, upper: 1, replicates: 5, seed: 7, confidence: 0.9 }
    }],
    run: (input, ctx) => {
      const differences = ctx.call('statistics.pairedDifferences', { x: input.x, y: input.y }).values;
      return ctx.call('statistics.bootstrapMeanCI', {
        values: differences,
        replicates: input.replicates,
        seed: input.seed,
        confidence: input.confidence
      });
    },
    formula: 'dᵢ = xᵢ - yᵢ; apply the seeded percentile bootstrap to d.',
    caveats: 'Pairs must be matched and both groups need at least two observations. The interval targets the mean paired difference.'
  }
];
