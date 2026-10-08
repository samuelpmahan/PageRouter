// Browser-safe exact teaching models for mechanical and quartz watch mechanisms.
// Counters come from the shared transport; this module never rebuilds accrued
// cycles from the current oscillator rate.

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DEFAULT_MECHANICAL_HZ = { numerator: 4, denominator: 1 };
const DEFAULT_QUARTZ_HZ = { numerator: 32_768, denominator: 1 };
const DEFAULT_DIVIDER_STAGES = 15;

function objectInput(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function safeInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function finiteBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function gcdBigInt(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function fraction(numerator, denominator = 1n, label = 'rational') {
  let n = typeof numerator === 'bigint' ? numerator : BigInt(numerator);
  let d = typeof denominator === 'bigint' ? denominator : BigInt(denominator);
  if (d === 0n) throw new RangeError(`${label} denominator must not be zero`);
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcdBigInt(n, d);
  n /= divisor;
  d /= divisor;
  if (n < -MAX_SAFE || n > MAX_SAFE || d > MAX_SAFE) {
    throw new RangeError(`${label} is outside the safe rational range`);
  }
  return { numerator: Number(n), denominator: Number(d) };
}

function readRational(value, label, { nonnegative = false, positive = false } = {}) {
  objectInput(value, label);
  if (!Object.hasOwn(value, 'numerator') || !Object.hasOwn(value, 'denominator')) {
    throw new TypeError(`${label} must contain numerator and denominator`);
  }
  const numerator = safeInteger(value.numerator, `${label}.numerator`);
  const denominator = safeInteger(value.denominator, `${label}.denominator`, { minimum: 1 });
  const reduced = fraction(BigInt(numerator), BigInt(denominator), label);
  if (nonnegative && reduced.numerator < 0) throw new RangeError(`${label} must be nonnegative`);
  if (positive && reduced.numerator <= 0) throw new RangeError(`${label} must be positive`);
  return reduced;
}

function readRate(value, label, { allowZero = false } = {}) {
  if (Number.isSafeInteger(value)) {
    if (value < (allowZero ? 0 : 1)) throw new RangeError(`${label} must be ${allowZero ? 'nonnegative' : 'positive'}`);
    return { numerator: value, denominator: 1 };
  }
  return readRational(value, label, allowZero ? { nonnegative: true } : { positive: true });
}

function asBigFraction(value) {
  return { n: BigInt(value.numerator), d: BigInt(value.denominator) };
}

function add(a, b, label) {
  const x = asBigFraction(a), y = asBigFraction(b);
  return fraction(x.n * y.d + y.n * x.d, x.d * y.d, label);
}

function multiply(a, b, label) {
  const x = asBigFraction(a), y = asBigFraction(b);
  return fraction(x.n * y.n, x.d * y.d, label);
}

function divide(a, b, label) {
  const x = asBigFraction(a), y = asBigFraction(b);
  if (y.n === 0n) throw new RangeError(`${label} divisor must not be zero`);
  return fraction(x.n * y.d, x.d * y.n, label);
}

function negate(value, label) {
  const x = asBigFraction(value);
  return fraction(-x.n, x.d, label);
}

function floorFraction(value, label) {
  const x = asBigFraction(value);
  const whole = x.n / x.d;
  const rounded = x.n < 0n && x.n % x.d !== 0n ? whole - 1n : whole;
  if (rounded < -MAX_SAFE || rounded > MAX_SAFE) throw new RangeError(`${label} exceeds the safe integer range`);
  return Number(rounded);
}

function floorFractionDividedBy(value, positiveInteger, label) {
  const x = asBigFraction(value);
  const divisor = typeof positiveInteger === 'bigint' ? positiveInteger : BigInt(positiveInteger);
  if (divisor <= 0n) throw new RangeError(`${label} divisor must be positive`);
  const denominator = x.d * divisor;
  const whole = x.n / denominator;
  const rounded = x.n < 0n && x.n % denominator !== 0n ? whole - 1n : whole;
  if (rounded < -MAX_SAFE || rounded > MAX_SAFE) throw new RangeError(`${label} exceeds the safe integer range`);
  return Number(rounded);
}

function fractionalPart(value, label) {
  const x = asBigFraction(value);
  let remainder = x.n % x.d;
  if (remainder < 0n) remainder += x.d;
  return fraction(remainder, x.d, label);
}

function compareFraction(value, numerator, denominator = 1) {
  const x = asBigFraction(value);
  const left = x.n * BigInt(denominator);
  const right = BigInt(numerator) * x.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

function moduloTurnAngle(turns, label) {
  const phase = fractionalPart(turns, label);
  return (phase.numerator / phase.denominator) * 360;
}

function handTurnsFor(displayTime) {
  const seconds = readRational(displayTime, 'displayTime', { nonnegative: true });
  return {
    second: divide(seconds, { numerator: 60, denominator: 1 }, 'second-hand turns'),
    minute: divide(seconds, { numerator: 3_600, denominator: 1 }, 'minute-hand turns'),
    hour: divide(seconds, { numerator: 43_200, denominator: 1 }, 'hour-hand turns'),
  };
}

function handAnglesFromTurns(turns) {
  return {
    second: moduloTurnAngle(turns.second, 'second-hand turns'),
    minute: moduloTurnAngle(turns.minute, 'minute-hand turns'),
    hour: moduloTurnAngle(turns.hour, 'hour-hand turns'),
  };
}

/** Exact clock-hand angles from nominal display time, in degrees modulo 360. */
export function handAnglesAt(input) {
  objectInput(input, 'input');
  const turns = handTurnsFor(input.displayTime);
  return handAnglesFromTurns(turns);
}

/**
 * One ideal external gear mesh reverses direction and scales turns by the
 * driver-to-driven tooth ratio. Teeth and input turns remain exact integers.
 */
export function externalGearPair(input) {
  objectInput(input, 'input');
  const turns = readRational(input.driverTurns, 'driverTurns');
  const driverTeeth = safeInteger(input.driverTeeth, 'driverTeeth', { minimum: 1 });
  const drivenTeeth = safeInteger(input.drivenTeeth, 'drivenTeeth', { minimum: 1 });
  const teethRatio = fraction(BigInt(driverTeeth), BigInt(drivenTeeth), 'teeth ratio');
  const drivenTurns = negate(multiply(turns, teethRatio, 'driven turns'), 'driven turns');
  return {
    driverTurns: turns,
    drivenTurns,
    teethRatio,
    driverTeeth,
    drivenTeeth,
    direction: 'opposite',
  };
}

/**
 * A deliberately generic four-mesh teaching train. Two external meshes make
 * each indicated hand turn in the same direction as the prior hand.
 */
export function teachingHandTrain(input) {
  objectInput(input, 'input');
  const seconds = readRational(input.displayTime, 'displayTime', { nonnegative: true });
  const secondTurns = divide(seconds, { numerator: 60, denominator: 1 }, 'second-hand turns');
  const secondToMinute = [
    externalGearPair({ driverTurns: secondTurns, driverTeeth: 20, drivenTeeth: 120 }),
    null,
  ];
  secondToMinute[1] = externalGearPair({
    driverTurns: secondToMinute[0].drivenTurns,
    driverTeeth: 20,
    drivenTeeth: 200,
  });
  const minuteTurns = secondToMinute[1].drivenTurns;

  const minuteToHour = [
    externalGearPair({ driverTurns: minuteTurns, driverTeeth: 20, drivenTeeth: 60 }),
    null,
  ];
  minuteToHour[1] = externalGearPair({
    driverTurns: minuteToHour[0].drivenTurns,
    driverTeeth: 20,
    drivenTeeth: 80,
  });
  const handTurns = {
    second: secondTurns,
    minute: secondToMinute[1].drivenTurns,
    hour: minuteToHour[1].drivenTurns,
  };
  return {
    handTurns,
    gearPairs: { secondToMinute, minuteToHour },
    handAnglesDegrees: handAnglesFromTurns(handTurns),
  };
}

function readSnapshot(configInput, snapshotInput) {
  const config = objectInput(configInput ?? {}, 'config');
  const snapshot = objectInput(snapshotInput, 'snapshot');
  const time = readRational(snapshot.time, 'snapshot.time', { nonnegative: true });
  const operatingTimeInput = objectInput(snapshot.operatingTime, 'snapshot.operatingTime');
  const displayTimeInput = objectInput(snapshot.displayTime, 'snapshot.displayTime');
  const cyclesInput = objectInput(snapshot.cycles, 'snapshot.cycles');
  const countersInput = objectInput(snapshot.counters, 'snapshot.counters');
  const energyInput = objectInput(snapshot.energy, 'snapshot.energy');

  const mechanicalOperatingTime = readRational(operatingTimeInput.mechanical, 'snapshot.operatingTime.mechanical', { nonnegative: true });
  const quartzOperatingTime = readRational(operatingTimeInput.quartz, 'snapshot.operatingTime.quartz', { nonnegative: true });
  const mechanicalDisplayTime = readRational(displayTimeInput.mechanical, 'snapshot.displayTime.mechanical', { nonnegative: true });
  const quartzDisplayTime = readRational(displayTimeInput.quartz, 'snapshot.displayTime.quartz', { nonnegative: true });
  // Validate software's time too, though this adapter does not produce its model.
  readRational(displayTimeInput.software, 'snapshot.displayTime.software', { nonnegative: true });

  const mechanicalCycles = readRational(cyclesInput.mechanicalBeats, 'snapshot.cycles.mechanicalBeats', { nonnegative: true });
  const quartzCycles = readRational(cyclesInput.quartzCycles, 'snapshot.cycles.quartzCycles', { nonnegative: true });
  const mechanicalBeats = safeInteger(countersInput.mechanicalBeats, 'snapshot.counters.mechanicalBeats', { minimum: 0 });
  const referenceCycles = safeInteger(countersInput.quartzCycles, 'snapshot.counters.quartzCycles', { minimum: 0 });
  const motorCommands = safeInteger(countersInput.motorCommands, 'snapshot.counters.motorCommands', { minimum: 0 });
  if (floorFraction(mechanicalCycles, 'mechanical beat count') !== mechanicalBeats) {
    throw new RangeError('mechanical beat counter must equal the floor of accrued mechanical cycles');
  }
  if (floorFraction(quartzCycles, 'quartz cycle count') !== referenceCycles) {
    throw new RangeError('quartz cycle counter must equal the floor of accrued quartz cycles');
  }

  const mainspring = finiteBoolean(energyInput.mainspring, 'snapshot.energy.mainspring');
  const battery = finiteBoolean(energyInput.battery, 'snapshot.energy.battery');
  const nominalMechanicalHz = readRate(config.mechanicalHz ?? DEFAULT_MECHANICAL_HZ, 'config.mechanicalHz');
  const nominalQuartzHz = readRate(config.quartzHz ?? DEFAULT_QUARTZ_HZ, 'config.quartzHz');
  const ratesInput = snapshot.rates === undefined ? {} : objectInput(snapshot.rates, 'snapshot.rates');
  const mechanicalHz = ratesInput.mechanicalHz === undefined
    ? nominalMechanicalHz : readRate(ratesInput.mechanicalHz, 'snapshot.rates.mechanicalHz', { allowZero: true });
  const quartzHz = ratesInput.quartzHz === undefined
    ? nominalQuartzHz : readRate(ratesInput.quartzHz, 'snapshot.rates.quartzHz', { allowZero: true });
  const dividerStages = safeInteger(config.dividerStages ?? DEFAULT_DIVIDER_STAGES, 'config.dividerStages', { minimum: 0, maximum: 30 });
  const motorDivisor = 2n ** BigInt(dividerStages);
  const expectedCommands = floorFractionDividedBy(quartzCycles, motorDivisor, 'motor command count');
  if (motorCommands !== expectedCommands) {
    throw new RangeError('motor command counter must equal the terminal divider-stage output');
  }

  const expectedMechanicalDisplayTime = fraction(
    BigInt(mechanicalBeats) * BigInt(nominalMechanicalHz.denominator),
    2n * BigInt(nominalMechanicalHz.numerator),
    'nominal mechanical display time'
  );
  const expectedQuartzDisplayTime = fraction(
    BigInt(motorCommands) * motorDivisor * BigInt(nominalQuartzHz.denominator),
    BigInt(nominalQuartzHz.numerator),
    'nominal quartz display time'
  );
  if (expectedMechanicalDisplayTime.numerator !== mechanicalDisplayTime.numerator
    || expectedMechanicalDisplayTime.denominator !== mechanicalDisplayTime.denominator) {
    throw new RangeError('mechanical displayTime must match accumulated beats at the nominal mechanical rate');
  }
  if (expectedQuartzDisplayTime.numerator !== quartzDisplayTime.numerator
    || expectedQuartzDisplayTime.denominator !== quartzDisplayTime.denominator) {
    throw new RangeError('quartz displayTime must match accumulated motor commands at the nominal quartz rate');
  }

  return {
    time,
    mechanicalOperatingTime,
    quartzOperatingTime,
    mechanicalDisplayTime,
    quartzDisplayTime,
    mechanicalCycles,
    quartzCycles,
    mechanicalBeats,
    referenceCycles,
    motorCommands,
    mainspring,
    battery,
    nominalMechanicalHz,
    nominalQuartzHz,
    mechanicalHz,
    quartzHz,
    dividerStages,
  };
}

function phaseName(phaseWithinBeat) {
  if (compareFraction(phaseWithinBeat, 1, 2) < 0) return 'lock';
  if (compareFraction(phaseWithinBeat, 3, 4) < 0) return 'release';
  return 'impulse';
}

function dividerStageCounts(cycles, stages) {
  const result = [];
  for (let stage = 1; stage <= stages; stage += 1) {
    const divisor = 2n ** BigInt(stage);
    result.push({
      stage,
      divisor: 2,
      outputCount: floorFractionDividedBy(cycles, divisor, `divider stage ${stage} output`),
    });
  }
  return result;
}

function modelOutput(data, training) {
  const mechanicalPhaseWithinBeat = fractionalPart(data.mechanicalCycles, 'mechanical beat phase');
  const oscillatorCycles = divide(data.mechanicalCycles, { numerator: 2, denominator: 1 }, 'mechanical oscillator cycles');
  const oscillatorPhase = fractionalPart(oscillatorCycles, 'mechanical oscillator phase');
  const mechanicalGearTrain = training({ displayTime: data.mechanicalDisplayTime });
  const quartzGearTrain = training({ displayTime: data.quartzDisplayTime });

  return {
    mechanical: {
      logicalTime: data.time,
      operatingTime: data.mechanicalOperatingTime,
      displayTime: data.mechanicalDisplayTime,
      frequencyHz: data.mechanicalHz,
      nominalFrequencyHz: data.nominalMechanicalHz,
      energy: { available: data.mainspring, source: 'mainspring' },
      timing: { available: data.mainspring && data.mechanicalHz.numerator > 0, source: 'balance and hairspring' },
      counts: { beats: data.mechanicalBeats, fullOscillations: floorFraction(oscillatorCycles, 'full oscillation count') },
      oscillator: { cycles: oscillatorCycles, phase: oscillatorPhase },
      escapement: {
        eventIndex: data.mechanicalBeats,
        phase: phaseName(mechanicalPhaseWithinBeat),
        phaseWithinBeat: mechanicalPhaseWithinBeat,
        modelKind: 'illustrative-schematic',
      },
      handAnglesDegrees: mechanicalGearTrain.handAnglesDegrees,
      gearTrain: mechanicalGearTrain,
    },
    quartz: {
      logicalTime: data.time,
      operatingTime: data.quartzOperatingTime,
      displayTime: data.quartzDisplayTime,
      frequencyHz: data.quartzHz,
      nominalFrequencyHz: data.nominalQuartzHz,
      energy: { available: data.battery, source: 'battery' },
      timing: { available: data.battery && data.quartzHz.numerator > 0, source: 'quartz resonator and oscillator circuit' },
      counts: { referenceCycles: data.referenceCycles, motorCommands: data.motorCommands },
      oscillator: { cycles: data.quartzCycles, phase: fractionalPart(data.quartzCycles, 'quartz oscillator phase') },
      dividerStages: dividerStageCounts(data.quartzCycles, data.dividerStages),
      handAnglesDegrees: quartzGearTrain.handAnglesDegrees,
      gearTrain: quartzGearTrain,
    },
  };
}

function mechanismSnapshotWith(config, snapshot, training) {
  const data = readSnapshot(config, snapshot);
  return modelOutput(data, training);
}

/** Build mechanical and quartz outputs from exact transport totals. */
export function mechanismSnapshot(config, snapshot) {
  return mechanismSnapshotWith(config, snapshot, teachingHandTrain);
}

const objectSchema = { type: 'object' };
const rationalSchema = {
  type: 'object',
  properties: {
    numerator: { type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    denominator: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
  required: ['numerator', 'denominator'],
  additionalProperties: false,
};
const positiveIntegerSchema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const exampleSnapshot = {
  time: { numerator: 0, denominator: 1 },
  operatingTime: { mechanical: { numerator: 0, denominator: 1 }, quartz: { numerator: 0, denominator: 1 } },
  displayTime: {
    mechanical: { numerator: 0, denominator: 1 }, quartz: { numerator: 0, denominator: 1 }, software: { numerator: 0, denominator: 1 },
  },
  cycles: { mechanicalBeats: { numerator: 0, denominator: 1 }, quartzCycles: { numerator: 0, denominator: 1 } },
  counters: { mechanicalBeats: 0, quartzCycles: 0, motorCommands: 0 },
  energy: { mainspring: true, battery: true },
};

const ZERO_RATIONAL = { numerator: 0, denominator: 1 };
const ZERO_HAND_ANGLES = { second: 0, minute: 0, hour: 0 };
const ZERO_GEAR_TRAIN = {
  handTurns: { second: ZERO_RATIONAL, minute: ZERO_RATIONAL, hour: ZERO_RATIONAL },
  gearPairs: {
    secondToMinute: [
      { driverTurns: ZERO_RATIONAL, drivenTurns: ZERO_RATIONAL, teethRatio: { numerator: 1, denominator: 6 }, driverTeeth: 20, drivenTeeth: 120, direction: 'opposite' },
      { driverTurns: ZERO_RATIONAL, drivenTurns: ZERO_RATIONAL, teethRatio: { numerator: 1, denominator: 10 }, driverTeeth: 20, drivenTeeth: 200, direction: 'opposite' },
    ],
    minuteToHour: [
      { driverTurns: ZERO_RATIONAL, drivenTurns: ZERO_RATIONAL, teethRatio: { numerator: 1, denominator: 3 }, driverTeeth: 20, drivenTeeth: 60, direction: 'opposite' },
      { driverTurns: ZERO_RATIONAL, drivenTurns: ZERO_RATIONAL, teethRatio: { numerator: 1, denominator: 4 }, driverTeeth: 20, drivenTeeth: 80, direction: 'opposite' },
    ],
  },
  handAnglesDegrees: ZERO_HAND_ANGLES,
};
const ZERO_DIVIDER_STAGES = [
  { stage: 1, divisor: 2, outputCount: 0 }, { stage: 2, divisor: 2, outputCount: 0 },
  { stage: 3, divisor: 2, outputCount: 0 }, { stage: 4, divisor: 2, outputCount: 0 },
  { stage: 5, divisor: 2, outputCount: 0 }, { stage: 6, divisor: 2, outputCount: 0 },
  { stage: 7, divisor: 2, outputCount: 0 }, { stage: 8, divisor: 2, outputCount: 0 },
  { stage: 9, divisor: 2, outputCount: 0 }, { stage: 10, divisor: 2, outputCount: 0 },
  { stage: 11, divisor: 2, outputCount: 0 }, { stage: 12, divisor: 2, outputCount: 0 },
  { stage: 13, divisor: 2, outputCount: 0 }, { stage: 14, divisor: 2, outputCount: 0 },
  { stage: 15, divisor: 2, outputCount: 0 },
];
const ZERO_MECHANISM_EXAMPLE = {
  mechanical: {
    logicalTime: ZERO_RATIONAL, operatingTime: ZERO_RATIONAL, displayTime: ZERO_RATIONAL,
    frequencyHz: { numerator: 4, denominator: 1 }, nominalFrequencyHz: { numerator: 4, denominator: 1 },
    energy: { available: true, source: 'mainspring' },
    timing: { available: true, source: 'balance and hairspring' },
    counts: { beats: 0, fullOscillations: 0 },
    oscillator: { cycles: ZERO_RATIONAL, phase: ZERO_RATIONAL },
    escapement: { eventIndex: 0, phase: 'lock', phaseWithinBeat: ZERO_RATIONAL, modelKind: 'illustrative-schematic' },
    handAnglesDegrees: ZERO_HAND_ANGLES, gearTrain: ZERO_GEAR_TRAIN,
  },
  quartz: {
    logicalTime: ZERO_RATIONAL, operatingTime: ZERO_RATIONAL, displayTime: ZERO_RATIONAL,
    frequencyHz: { numerator: 32_768, denominator: 1 }, nominalFrequencyHz: { numerator: 32_768, denominator: 1 },
    energy: { available: true, source: 'battery' },
    timing: { available: true, source: 'quartz resonator and oscillator circuit' },
    counts: { referenceCycles: 0, motorCommands: 0 },
    oscillator: { cycles: ZERO_RATIONAL, phase: ZERO_RATIONAL },
    dividerStages: ZERO_DIVIDER_STAGES,
    handAnglesDegrees: ZERO_HAND_ANGLES, gearTrain: ZERO_GEAR_TRAIN,
  },
};

function capability(id, title, kind, dependsOn, inputSchema, examples, run, formula, caveats) {
  return {
    id: `statistics.${id}`,
    title,
    description: `${title} for the generic, exact-time watch teaching model.`,
    kind,
    dependsOn,
    inputSchema,
    outputSchema: objectSchema,
    examples,
    run,
    formula,
    caveats,
  };
}

export const capabilities = [
  capability(
    'externalGearPair', 'External gear pair', 'atomic', [],
    {
      type: 'object',
      properties: {
        driverTurns: rationalSchema,
        driverTeeth: positiveIntegerSchema,
        drivenTeeth: positiveIntegerSchema,
      },
      required: ['driverTurns', 'driverTeeth', 'drivenTeeth'],
      additionalProperties: false,
    },
    [{
      input: { driverTurns: ZERO_RATIONAL, driverTeeth: 20, drivenTeeth: 120 },
      expected: { driverTurns: ZERO_RATIONAL, drivenTurns: ZERO_RATIONAL, teethRatio: { numerator: 1, denominator: 6 }, driverTeeth: 20, drivenTeeth: 120, direction: 'opposite' },
    }],
    externalGearPair,
    'driven turns = -driver turns × driver teeth / driven teeth',
    'An idealized external mesh reverses direction. The chosen teaching tooth counts are not from a specific watch caliber.'
  ),
  capability(
    'teachingHandTrain', 'Teaching hand gear train', 'composed', ['statistics.externalGearPair'],
    {
      type: 'object', properties: { displayTime: rationalSchema }, required: ['displayTime'], additionalProperties: false,
    },
    [{ input: { displayTime: ZERO_RATIONAL }, expected: ZERO_GEAR_TRAIN }],
    (input, ctx) => teachingHandTrainWith(input, (payload) => ctx
      ? ctx.call('statistics.externalGearPair', payload)
      : externalGearPair(payload)),
    'Two external meshes make each hand turn in the same direction; the illustrative ratios are 1:60 for seconds-to-minutes and 1:12 for minutes-to-hours.',
    'This is a generic teaching train. It does not reproduce a watch caliber or assert physical tooth geometry.'
  ),
  capability(
    'mechanismSnapshot', 'Mechanical and quartz snapshot', 'composed', ['statistics.teachingHandTrain'],
    {
      type: 'object',
      properties: { config: objectSchema, snapshot: objectSchema },
      required: ['config', 'snapshot'],
      additionalProperties: false,
    },
    [{ input: { config: {}, snapshot: exampleSnapshot }, expected: ZERO_MECHANISM_EXAMPLE }],
    (input, ctx) => mechanismSnapshotWith(input.config, input.snapshot,
      (payload) => ctx
        ? ctx.call('statistics.teachingHandTrain', payload)
        : teachingHandTrain(payload)),
    'Reported oscillator/counter totals and display time are passed through from the shared exact-time transport; current frequency never rebuilds accumulated totals.',
    'The default examples (4 Hz mechanical, 32,768 Hz quartz, fifteen divide-by-two stages) are generic teaching parameters, not universal specifications. Escapement phase windows and gear teeth are illustrative.'
  ),
];

function teachingHandTrainWith(input, callGearPair) {
  objectInput(input, 'input');
  const seconds = readRational(input.displayTime, 'displayTime', { nonnegative: true });
  const secondTurns = divide(seconds, { numerator: 60, denominator: 1 }, 'second-hand turns');
  const firstMinuteMesh = callGearPair({ driverTurns: secondTurns, driverTeeth: 20, drivenTeeth: 120 });
  const secondMinuteMesh = callGearPair({ driverTurns: firstMinuteMesh.drivenTurns, driverTeeth: 20, drivenTeeth: 200 });
  const firstHourMesh = callGearPair({ driverTurns: secondMinuteMesh.drivenTurns, driverTeeth: 20, drivenTeeth: 60 });
  const secondHourMesh = callGearPair({ driverTurns: firstHourMesh.drivenTurns, driverTeeth: 20, drivenTeeth: 80 });
  const handTurns = {
    second: secondTurns,
    minute: secondMinuteMesh.drivenTurns,
    hour: secondHourMesh.drivenTurns,
  };
  return {
    handTurns,
    gearPairs: {
      secondToMinute: [firstMinuteMesh, secondMinuteMesh],
      minuteToHour: [firstHourMesh, secondHourMesh],
    },
    handAnglesDegrees: handAnglesFromTurns(handTurns),
  };
}
