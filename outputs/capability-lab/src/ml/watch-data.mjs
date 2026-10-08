import { applyWatchAction, createWatchRun } from '../watches/index.mjs';

const MAX_CONDITIONS = 64;
const MIN_CONDITIONS = 4;
const MAX_SECONDS = 86_400;
const MAX_ROWS = 10_000;
const UINT32_MAX = 0xffff_ffff;
const DEFAULT_GRID = Array.from({ length: 13 }, (_, index) => ({
  numerator: 370 + index * 5,
  denominator: 100,
}));

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

function positiveSeconds(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SECONDS) {
    throw new RangeError(`${label} must be a positive integer from 1 through ${MAX_SECONDS} seconds`);
  }
  return value;
}

function gcd(a, b) {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left === 0n ? 1n : left;
}

function normalizeRate(value, label = 'mechanicalHz') {
  let numerator;
  let denominator;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} must be an integer or an exact {numerator, denominator} rational`);
    }
    numerator = BigInt(value);
    denominator = 1n;
  } else {
    objectInput(value, label);
    onlyKeys(value, new Set(['numerator', 'denominator']), label);
    if (!Object.hasOwn(value, 'numerator') || !Object.hasOwn(value, 'denominator')) {
      throw new TypeError(`${label} must be a positive safe integer or rational with numerator and denominator`);
    }
    if (!Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator) || value.denominator === 0) {
      throw new RangeError(`${label} numerator and nonzero denominator must be safe integers`);
    }
    numerator = BigInt(value.numerator);
    denominator = BigInt(value.denominator);
  }
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator <= 0n || denominator <= 0n) throw new RangeError(`${label} must be a positive rate`);
  if (numerator > 8n * denominator) throw new RangeError(`${label} cannot exceed 8 Hz`);
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} normalized numerator and denominator must be safe integers`);
  }
  return { numerator: Number(numerator), denominator: Number(denominator) };
}

function rateNumber(rate) {
  const result = rate.numerator / rate.denominator;
  if (!Number.isFinite(result) || result <= 0) throw new RangeError('mechanicalHz must be representable as a positive finite number');
  return result;
}

function normalizeConditions(conditions) {
  if (!Array.isArray(conditions) || conditions.length < MIN_CONDITIONS || conditions.length > MAX_CONDITIONS) {
    throw new RangeError(`conditions must contain ${MIN_CONDITIONS} to ${MAX_CONDITIONS} independent conditions`);
  }
  const seen = new Set();
  return conditions.map((item, index) => {
    objectInput(item, `conditions[${index}]`);
    onlyKeys(item, new Set(['conditionId', 'mechanicalHz']), `conditions[${index}]`);
    if (typeof item.conditionId !== 'string' || item.conditionId.trim() === '' || item.conditionId.length > 80) {
      throw new TypeError(`conditions[${index}].conditionId must be a nonempty string of at most 80 characters`);
    }
    if (seen.has(item.conditionId)) throw new RangeError('conditionId values must be unique');
    seen.add(item.conditionId);
    if (!Object.hasOwn(item, 'mechanicalHz')) throw new TypeError(`conditions[${index}].mechanicalHz is required`);
    return { conditionId: item.conditionId, mechanicalHz: normalizeRate(item.mechanicalHz, `conditions[${index}].mechanicalHz`) };
  });
}

function makeRandom(seed) {
  let state = seed === 0 ? 0x6d2b79f5 : seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function shuffle(items, randomUint32) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomUint32() % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function rateIdentity(rate) {
  const text = `${rate.numerator}/${rate.denominator}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function defaultConditions(seed) {
  const randomUint32 = makeRandom(seed);
  const selected = shuffle(DEFAULT_GRID, randomUint32).slice(0, 7);
  return selected.map(rate => {
    const mechanicalHz = normalizeRate(rate);
    return {
      conditionId: `synthetic-condition-${rateIdentity(mechanicalHz)}`,
      mechanicalHz,
    };
  });
}

function rationalNumber(value, label) {
  if (value === null || typeof value !== 'object' || !Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator) || value.denominator <= 0) {
    throw new TypeError(`${label} must be a normalized rational number`);
  }
  const result = value.numerator / value.denominator;
  if (!Number.isFinite(result)) throw new RangeError(`${label} is outside the finite numeric range`);
  return result;
}

function measuredMechanicalHz(cycleValue, operatingTimeValue) {
  const cycles = rationalNumber(cycleValue, 'mechanical cycle total');
  const operatingSeconds = rationalNumber(operatingTimeValue, 'mechanical operating time');
  if (operatingSeconds <= 0) throw new RangeError('early observation requires positive powered mechanical time');
  const rate = cycles / (2 * operatingSeconds);
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('early observed mechanical rate must be finite and positive');
  return rate;
}

function makeConditionRecord(condition, earlySeconds, horizonSeconds, seed) {
  let state = createWatchRun({ mechanicalHz: 4 });
  state = applyWatchAction(state, { type: 'rate', model: 'mechanical', hz: condition.mechanicalHz });
  state = applyWatchAction(state, { type: 'advance', duration: earlySeconds, origin: 'manual' });
  const earlyMechanicalCycles = { ...state.cycles.mechanicalBeats };
  const earlyOperatingTime = { ...state.operatingTime.mechanical };
  const earlyObservationWindowSeconds = { numerator: earlySeconds, denominator: 1 };
  const earlyObservedMechanicalHz = measuredMechanicalHz(earlyMechanicalCycles, earlyOperatingTime);
  const earlyClockErrorSeconds = rationalNumber(state.displayTime.mechanical, 'early display time') - earlySeconds;
  const earlyMechanicalBeats = state.counters.mechanicalBeats;
  const earlyDisplayTime = { ...state.displayTime.mechanical };

  state = applyWatchAction(state, {
    type: 'advance', duration: horizonSeconds - earlySeconds, origin: 'manual',
  });
  const horizonDisplayTime = { ...state.displayTime.mechanical };
  const horizonOperatingTime = { ...state.operatingTime.mechanical };
  const horizonMechanicalBeats = state.counters.mechanicalBeats;
  const target = rationalNumber(horizonDisplayTime, 'horizon display time') - horizonSeconds;
  if (!Number.isFinite(target)) throw new RangeError('horizon clock error is outside the finite numeric range');

  return {
    runId: `watch-run-${seed}-${earlySeconds}-${horizonSeconds}-${condition.conditionId}-${rateIdentity(condition.mechanicalHz)}`,
    conditionId: condition.conditionId,
    features: [earlyObservedMechanicalHz],
    target,
    observations: {
      earlyClockErrorSeconds,
      earlyMechanicalCycles,
      earlyMechanicalBeats,
      earlyOperatingTime,
      earlyObservationWindowSeconds,
      earlyDisplayTime,
      readoutKind: 'synthetic-teaching-phase-observation',
      formula: 'earlyMechanicalCycles/(2*earlyOperatingTime)',
      horizonMechanicalBeats,
      horizonOperatingTime,
      horizonDisplayTime,
    },
  };
}

/**
 * Build one synthetic observation per isolated watch-rate condition by advancing
 * the real watch transport and recording its retained early and later state.
 */
export function buildWatchCalibrationDataset(input = {}) {
  objectInput(input, 'input');
  onlyKeys(input, new Set(['conditions', 'earlySeconds', 'horizonSeconds', 'seed']), 'dataset input');
  const earlySeconds = positiveSeconds(input.earlySeconds ?? 5, 'earlySeconds');
  const horizonSeconds = positiveSeconds(input.horizonSeconds ?? 30, 'horizonSeconds');
  if (horizonSeconds <= earlySeconds) throw new RangeError('horizonSeconds must be greater than earlySeconds');
  const seed = input.seed ?? 1;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new RangeError(`seed must be an unsigned 32-bit safe integer from 0 through ${UINT32_MAX}`);
  }
  const conditions = input.conditions === undefined
    ? defaultConditions(seed)
    : normalizeConditions(input.conditions);
  const records = conditions.map(condition => makeConditionRecord(condition, earlySeconds, horizonSeconds, seed));
  return {
    sourceKind: 'synthetic-watch',
    featureNames: ['earlyObservedMechanicalHz'],
    targetName: 'horizonClockErrorSeconds',
    records,
    provenance: {
      model: 'mechanical-watch-transport',
      generatorVersion: 1,
      nominalMechanicalHz: { numerator: 4, denominator: 1 },
      earlySeconds,
      horizonSeconds,
      seed,
      configuredConditions: conditions.map(condition => ({
        conditionId: condition.conditionId,
        mechanicalHz: { ...condition.mechanicalHz },
      })),
      observationMethod: 'early rate is derived from retained mechanical cycles and powered operating time; target is later retained display time minus logical horizon',
    },
  };
}

/** Predict ideal continuous rate drift; real displayed counters may add a step-sized residual. */
export function predictAnalyticalWatchBaseline(input) {
  objectInput(input, 'input');
  onlyKeys(input, new Set(['features', 'nominalMechanicalHz', 'horizonSeconds']), 'baseline input');
  if (!Array.isArray(input.features) || input.features.length < 1 || input.features.length > MAX_ROWS) {
    throw new RangeError(`features must contain 1 to ${MAX_ROWS} rows`);
  }
  const nominalMechanicalHz = normalizeRate(input.nominalMechanicalHz, 'nominalMechanicalHz');
  const nominal = rateNumber(nominalMechanicalHz);
  const horizonSeconds = positiveSeconds(input.horizonSeconds, 'horizonSeconds');
  const predictions = input.features.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 1) throw new RangeError(`features[${index}] must contain exactly one observed rate`);
    const observed = row[0];
    if (typeof observed !== 'number' || !Number.isFinite(observed) || observed <= 0) {
      throw new TypeError(`features[${index}][0] must be a finite positive rate`);
    }
    const prediction = (observed / nominal - 1) * horizonSeconds;
    if (!Number.isFinite(prediction)) throw new RangeError(`prediction[${index}] is outside the finite numeric range`);
    return prediction;
  });
  return { predictions };
}
