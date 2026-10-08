const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_EXPANSION_EVENTS = 512;
const MAX_RETAINED_ACTIONS = 20_000;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
const DEFAULT_CONFIG = Object.freeze({
  mechanicalHz: 4,
  quartzHz: 32_768,
  softwareHz: 256,
  dividerStages: 15,
  energy: Object.freeze({ mainspring: true, battery: true }),
  limits: Object.freeze({ maxActions: 2_000, maxBytes: 1_048_576, maxExpandEvents: 512 }),
});

export class WatchTransportError extends Error {
  constructor(message, code = 'WATCH_TRANSPORT_ERROR') {
    super(message);
    this.name = 'WatchTransportError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new WatchTransportError(message, code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function absolute(value) { return value < 0n ? -value : value; }

function gcd(left, right) {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function safeBigInt(value, label) {
  if (absolute(value) > MAX_SAFE) fail(`${label} exceeds the safe integer range`, 'SAFE_INTEGER_OVERFLOW');
  return Number(value);
}

function internalRational(numerator, denominator = 1n) {
  if (denominator === 0n) fail('rational denominator must not be zero', 'INVALID_RATIONAL');
  let n = numerator;
  let d = denominator;
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d);
  return { n: n / divisor, d: d / divisor };
}

function publicRational(value, label = 'rational') {
  const normalized = internalRational(value.n, value.d);
  return {
    numerator: safeBigInt(normalized.n, `${label} numerator`),
    denominator: safeBigInt(normalized.d, `${label} denominator`),
  };
}

function toInternal(value, label = 'rational') {
  canonicalWatchJson(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail(`${label} must be a safe integer or rational object`, 'INVALID_RATIONAL');
    return internalRational(BigInt(value));
  }
  if (!isPlainObject(value) || !Object.hasOwn(value, 'numerator') || !Object.hasOwn(value, 'denominator')) {
    fail(`${label} must be a safe integer or {numerator, denominator}`, 'INVALID_RATIONAL');
  }
  for (const key of Object.keys(value)) if (key !== 'numerator' && key !== 'denominator') {
    fail(`${label} has an unknown field ${key}`, 'INVALID_RATIONAL');
  }
  const { numerator, denominator } = value;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    fail(`${label} numerator and nonzero denominator must be safe integers`, 'INVALID_RATIONAL');
  }
  return internalRational(BigInt(numerator), BigInt(denominator));
}

export function normalizeRational(value, label = 'rational') {
  return publicRational(toInternal(value, label), label);
}

function addInternal(left, right) {
  return internalRational(left.n * right.d + right.n * left.d, left.d * right.d);
}

function subtractInternal(left, right) {
  return internalRational(left.n * right.d - right.n * left.d, left.d * right.d);
}

function multiplyInternal(left, right) {
  return internalRational(left.n * right.n, left.d * right.d);
}

function divideInternal(left, right) {
  if (right.n === 0n) fail('cannot divide a rational by zero', 'DIVIDE_BY_ZERO');
  return internalRational(left.n * right.d, left.d * right.n);
}

function compareInternal(left, right) {
  const difference = left.n * right.d - right.n * left.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function floorInternal(value) {
  let quotient = value.n / value.d;
  if (value.n < 0n && value.n % value.d !== 0n) quotient -= 1n;
  return quotient;
}

export function addRational(left, right) {
  return publicRational(addInternal(toInternal(left), toInternal(right)));
}

export function subtractRational(left, right) {
  return publicRational(subtractInternal(toInternal(left), toInternal(right)));
}

export function multiplyRational(left, right) {
  return publicRational(multiplyInternal(toInternal(left), toInternal(right)));
}

export function divideRational(left, right) {
  return publicRational(divideInternal(toInternal(left), toInternal(right)));
}

export function compareRational(left, right) {
  return compareInternal(toInternal(left), toInternal(right));
}

export function floorRational(value) {
  return safeBigInt(floorInternal(toInternal(value)), 'rational floor');
}

export function canonicalWatchJson(value) {
  const ancestors = new Set();
  function visit(item, path) {
    if (item === null) return 'null';
    if (typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail(`${path} must contain only finite numbers`, 'INVALID_JSON_VALUE');
      return Object.is(item, -0) ? '0' : String(item);
    }
    if (typeof item !== 'object') fail(`${path} contains a non-JSON value (${typeof item})`, 'INVALID_JSON_VALUE');
    if (ancestors.has(item)) fail(`${path} contains a cycle`, 'INVALID_JSON_VALUE');
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      for (const key of Reflect.ownKeys(item)) {
        if (key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length)) {
          fail(`${path} contains a non-index array property`, 'INVALID_JSON_VALUE');
        }
      }
      const entries = [];
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) fail(`${path}[${index}] is a sparse array entry`, 'INVALID_JSON_VALUE');
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || descriptor.get || descriptor.set) fail(`${path}[${index}] must be a plain data value`, 'INVALID_JSON_VALUE');
        entries.push(visit(item[index], `${path}[${index}]`));
      }
      result = `[${entries.join(',')}]`;
    } else {
      if (!isPlainObject(item) || Object.getOwnPropertySymbols(item).length > 0) fail(`${path} must be a plain JSON object`, 'INVALID_JSON_VALUE');
      const descriptors = Object.getOwnPropertyDescriptors(item);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || descriptor.get || descriptor.set) fail(`${path}.${key} must be an enumerable data property`, 'INVALID_JSON_VALUE');
      }
      const keys = Object.keys(item).sort();
      result = `{${keys.map((key) => {
        if (item[key] === undefined) fail(`${path}.${key} is undefined`, 'INVALID_JSON_VALUE');
        return `${JSON.stringify(key)}:${visit(item[key], `${path}.${key}`)}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return visit(value, '$');
}

function utf8Length(value) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function cloneJson(value) {
  return JSON.parse(canonicalWatchJson(value));
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`, 'INVALID_INPUT');
  return value;
}

function nonnegativeRational(value, label) {
  const rational = toInternal(value, label);
  if (rational.n < 0n) fail(`${label} must be nonnegative`, 'INVALID_RATIONAL');
  return publicRational(rational, label);
}

function positiveRate(value, label, allowZero = false) {
  const rate = toInternal(value, label);
  if (rate.n < 0n || (!allowZero && rate.n === 0n)) {
    fail(`${label} must be ${allowZero ? 'nonnegative' : 'positive'}`, 'INVALID_RATE');
  }
  return publicRational(rate, label);
}

function safeLimit(value, fallback, label, allowZero = false) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1)) fail(`${label} must be a ${allowZero ? 'nonnegative' : 'positive'} safe integer`, 'INVALID_LIMIT');
  return result;
}

function normalizeConfig(input = {}) {
  requireObject(input, 'config');
  const allowed = new Set(['mechanicalHz', 'quartzHz', 'softwareHz', 'dividerStages', 'energy', 'limits']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`unknown config field ${key}`, 'INVALID_CONFIG');
  const energyInput = input.energy ?? {};
  const limitsInput = input.limits ?? {};
  requireObject(energyInput, 'config.energy');
  requireObject(limitsInput, 'config.limits');
  const energy = {
    mainspring: energyInput.mainspring ?? DEFAULT_CONFIG.energy.mainspring,
    battery: energyInput.battery ?? DEFAULT_CONFIG.energy.battery,
  };
  for (const [key, value] of Object.entries(energy)) if (typeof value !== 'boolean') fail(`config.energy.${key} must be boolean`, 'INVALID_CONFIG');
  for (const key of Object.keys(energyInput)) if (!Object.hasOwn(energy, key)) fail(`unknown energy source ${key}`, 'INVALID_CONFIG');
  const limits = {
    maxActions: safeLimit(limitsInput.maxActions, DEFAULT_CONFIG.limits.maxActions, 'limits.maxActions'),
    maxBytes: safeLimit(limitsInput.maxBytes, DEFAULT_CONFIG.limits.maxBytes, 'limits.maxBytes'),
    maxExpandEvents: safeLimit(limitsInput.maxExpandEvents, DEFAULT_CONFIG.limits.maxExpandEvents, 'limits.maxExpandEvents'),
  };
  if (limits.maxActions > MAX_RETAINED_ACTIONS) fail(`limits.maxActions cannot exceed ${MAX_RETAINED_ACTIONS}`, 'INVALID_LIMIT');
  if (limits.maxBytes > MAX_HISTORY_BYTES) fail(`limits.maxBytes cannot exceed ${MAX_HISTORY_BYTES}`, 'INVALID_LIMIT');
  for (const key of Object.keys(limitsInput)) if (!Object.hasOwn(limits, key)) fail(`unknown history limit ${key}`, 'INVALID_CONFIG');
  if (limits.maxExpandEvents > MAX_EXPANSION_EVENTS) fail(`limits.maxExpandEvents cannot exceed ${MAX_EXPANSION_EVENTS}`, 'INVALID_LIMIT');
  const minimumHistoryBytes = historyByteCount([], []);
  if (limits.maxBytes < minimumHistoryBytes) fail(`limits.maxBytes must fit the ${minimumHistoryBytes}-byte empty history payload`, 'INVALID_LIMIT');
  const dividerStages = input.dividerStages ?? DEFAULT_CONFIG.dividerStages;
  if (!Number.isSafeInteger(dividerStages) || dividerStages < 0 || dividerStages > 30) fail('dividerStages must be an integer from 0 through 30', 'INVALID_CONFIG');
  return {
    mechanicalHz: positiveRate(input.mechanicalHz ?? DEFAULT_CONFIG.mechanicalHz, 'initial mechanicalHz'),
    quartzHz: positiveRate(input.quartzHz ?? DEFAULT_CONFIG.quartzHz, 'initial quartzHz'),
    softwareHz: positiveRate(input.softwareHz ?? DEFAULT_CONFIG.softwareHz, 'initial softwareHz'),
    dividerStages,
    energy,
    limits,
  };
}

function counterFromCycles(cycles, label) {
  const value = floorInternal(toInternal(cycles, `${label} cycles`));
  if (value > MAX_SAFE) fail(`${label} counter exceeds the safe integer range`, 'COUNTER_OVERFLOW');
  return Number(value);
}

function rationalFromCount(count) {
  return { n: BigInt(count), d: 1n };
}

function displayTimes(config, counters) {
  const divisor = 2n ** BigInt(config.dividerStages);
  const mechanicalRate = multiplyInternal(toInternal(config.mechanicalHz), internalRational(2n));
  const motorRate = divideInternal(toInternal(config.quartzHz), internalRational(divisor));
  return {
    mechanical: publicRational(divideInternal(rationalFromCount(counters.mechanicalBeats), mechanicalRate), 'mechanical display time'),
    quartz: publicRational(divideInternal(rationalFromCount(counters.motorCommands), motorRate), 'quartz display time'),
    software: publicRational(divideInternal(rationalFromCount(counters.softwareUpdates), toInternal(config.softwareHz)), 'software display time'),
  };
}

function angleAt(displayTime, periodSeconds) {
  const time = toInternal(displayTime, 'display time');
  const periodNumerator = BigInt(periodSeconds) * time.d;
  let remainder = time.n % periodNumerator;
  if (remainder < 0n) remainder += periodNumerator;
  const secondsWithinTurn = Number(remainder) / Number(time.d);
  return (secondsWithinTurn * 360) / periodSeconds;
}

function softwareModelFor(state) {
  return {
    timingHz: cloneJson(state.rates.softwareHz),
    nominalTimingHz: cloneJson(state.config.softwareHz),
    operatingTime: cloneJson(state.operatingTime.software),
    displayTime: cloneJson(state.displayTime.software),
    counts: { updates: state.counters.softwareUpdates },
    handAnglesDegrees: {
      second: angleAt(state.displayTime.software, 60),
      minute: angleAt(state.displayTime.software, 3_600),
      hour: angleAt(state.displayTime.software, 43_200),
    },
    transportPolicy: 'shared-logical-time',
  };
}

function refreshDerived(state) {
  const motorCommands = floorInternal(divideInternal(toInternal(state.cycles.quartzCycles), internalRational(2n ** BigInt(state.config.dividerStages))));
  if (motorCommands > MAX_SAFE) fail('motor command counter exceeds the safe integer range', 'COUNTER_OVERFLOW');
  state.counters = {
    mechanicalBeats: counterFromCycles(state.cycles.mechanicalBeats, 'mechanical beat'),
    quartzCycles: counterFromCycles(state.cycles.quartzCycles, 'quartz cycle'),
    motorCommands: Number(motorCommands),
    softwareUpdates: counterFromCycles(state.cycles.softwareUpdates, 'software update'),
  };
  state.displayTime = displayTimes(state.config, state.counters);
  state.models = { software: softwareModelFor(state) };
  state.softwareTransport = { policy: 'shared-logical-time', enabled: true };
}

function initialCycles() {
  return { mechanicalBeats: { numerator: 0, denominator: 1 }, quartzCycles: { numerator: 0, denominator: 1 }, softwareUpdates: { numerator: 0, denominator: 1 } };
}

function initialOperatingTime() {
  return { mechanical: { numerator: 0, denominator: 1 }, quartz: { numerator: 0, denominator: 1 }, software: { numerator: 0, denominator: 1 } };
}

function historyByteCount(actions, events) {
  return utf8Length(canonicalWatchJson({ actions, events }));
}

function makeState(config, session = 1) {
  const rates = { mechanicalHz: cloneJson(config.mechanicalHz), quartzHz: cloneJson(config.quartzHz), softwareHz: cloneJson(config.softwareHz) };
  const state = {
    schema: 'watch-run.v1',
    config: cloneJson(config),
    rates,
    time: { numerator: 0, denominator: 1 },
    paused: true,
    visibilityHidden: false,
    energy: cloneJson(config.energy),
    operatingTime: initialOperatingTime(),
    cycles: initialCycles(),
    counters: { mechanicalBeats: 0, quartzCycles: 0, motorCommands: 0, softwareUpdates: 0 },
    displayTime: { mechanical: { numerator: 0, denominator: 1 }, quartz: { numerator: 0, denominator: 1 }, software: { numerator: 0, denominator: 1 } },
    softwareTransport: { policy: 'shared-logical-time', enabled: true },
    models: {},
    history: { actions: [], events: [], bytes: historyByteCount([], []), limits: cloneJson(config.limits), session },
  };
  refreshDerived(state);
  return freezeDeep(state);
}

export function createWatchRun(config = {}) {
  canonicalWatchJson(config);
  return makeState(normalizeConfig(config));
}

const ALLOWED_ACTIONS = new Set(['advance', 'step', 'pause', 'resume', 'reset', 'energy', 'rate', 'visibility']);
const STEP_EVENTS = new Set(['mechanicalBeat', 'quartzCycle', 'motorCommand', 'softwareUpdate']);
const RATE_MODELS = new Set(['mechanical', 'quartz', 'software']);

function onlyKeys(object, allowed, label) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) fail(`unknown ${label} field ${key}`, 'INVALID_ACTION');
}

function normalizeAction(input) {
  requireObject(input, 'action');
  if (typeof input.type !== 'string' || !ALLOWED_ACTIONS.has(input.type)) fail(`unknown watch action ${String(input.type)}`, 'UNKNOWN_ACTION');
  switch (input.type) {
    case 'advance': {
      onlyKeys(input, new Set(['type', 'duration', 'origin']), 'advance action');
      const duration = nonnegativeRational(input.duration, 'advance duration');
      const origin = input.origin ?? 'manual';
      if (origin !== 'manual' && origin !== 'autoplay') fail('advance origin must be manual or autoplay', 'INVALID_ACTION');
      return { type: 'advance', duration, origin };
    }
    case 'step': {
      onlyKeys(input, new Set(['type', 'event']), 'step action');
      if (!STEP_EVENTS.has(input.event)) fail(`step event must be one of ${[...STEP_EVENTS].join(', ')}`, 'INVALID_ACTION');
      return { type: 'step', event: input.event };
    }
    case 'pause':
    case 'resume':
    case 'reset':
      onlyKeys(input, new Set(['type']), `${input.type} action`);
      return { type: input.type };
    case 'energy': {
      onlyKeys(input, new Set(['type', 'source', 'enabled']), 'energy action');
      if (input.source !== 'mainspring' && input.source !== 'battery') fail('energy source must be mainspring or battery', 'INVALID_ACTION');
      if (typeof input.enabled !== 'boolean') fail('energy enabled must be boolean', 'INVALID_ACTION');
      return { type: 'energy', source: input.source, enabled: input.enabled };
    }
    case 'rate': {
      onlyKeys(input, new Set(['type', 'model', 'hz']), 'rate action');
      if (!RATE_MODELS.has(input.model)) fail('rate model must be mechanical, quartz, or software', 'INVALID_ACTION');
      return { type: 'rate', model: input.model, hz: positiveRate(input.hz, `${input.model} rate`, true) };
    }
    case 'visibility':
      onlyKeys(input, new Set(['type', 'hidden']), 'visibility action');
      if (typeof input.hidden !== 'boolean') fail('visibility hidden must be boolean', 'INVALID_ACTION');
      return { type: 'visibility', hidden: input.hidden };
    default:
      fail(`unsupported watch action ${input.type}`, 'UNKNOWN_ACTION');
  }
}

function requireExactKeys(value, expected, label) {
  requireObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly ${wanted.join(', ')}`, 'INVALID_STATE');
  }
}

function validateStateRational(value, label) {
  let normalized;
  try {
    const internal = toInternal(value, label);
    if (internal.n < 0n) fail(`${label} must be nonnegative`, 'INVALID_STATE');
    normalized = publicRational(internal, label);
  } catch (error) {
    if (error instanceof WatchTransportError && error.code === 'INVALID_STATE') throw error;
    fail(`${label} is not a valid safe rational`, 'INVALID_STATE');
  }
  if (canonicalWatchJson(normalized) !== canonicalWatchJson(value)) fail(`${label} must be normalized`, 'INVALID_STATE');
  return normalized;
}

function validateState(state) {
  requireObject(state, 'state');
  if (state.schema !== 'watch-run.v1') fail('state schema must be watch-run.v1', 'INVALID_STATE');
  canonicalWatchJson(state);
  const normalizedConfig = normalizeConfig(state.config);
  if (canonicalWatchJson(normalizedConfig) !== canonicalWatchJson(state.config)) fail('state config is not canonical', 'INVALID_STATE');
  if (typeof state.paused !== 'boolean' || typeof state.visibilityHidden !== 'boolean') fail('state paused and visibilityHidden must be booleans', 'INVALID_STATE');
  requireExactKeys(state.energy, ['mainspring', 'battery'], 'state.energy');
  if (typeof state.energy.mainspring !== 'boolean' || typeof state.energy.battery !== 'boolean') fail('state energy values must be booleans', 'INVALID_STATE');
  requireExactKeys(state.rates, ['mechanicalHz', 'quartzHz', 'softwareHz'], 'state.rates');
  for (const [key, value] of Object.entries(state.rates)) {
    validateStateRational(value, `state.rates.${key}`);
  }
  const logicalTime = validateStateRational(state.time, 'state.time');
  requireExactKeys(state.operatingTime, ['mechanical', 'quartz', 'software'], 'state.operatingTime');
  for (const [key, value] of Object.entries(state.operatingTime)) {
    const operatingTime = validateStateRational(value, `state.operatingTime.${key}`);
    if (compareInternal(toInternal(operatingTime), toInternal(logicalTime)) > 0) fail(`state.operatingTime.${key} cannot exceed common logical time`, 'INVALID_STATE');
  }
  requireExactKeys(state.cycles, ['mechanicalBeats', 'quartzCycles', 'softwareUpdates'], 'state.cycles');
  for (const [key, value] of Object.entries(state.cycles)) validateStateRational(value, `state.cycles.${key}`);
  requireExactKeys(state.counters, ['mechanicalBeats', 'quartzCycles', 'motorCommands', 'softwareUpdates'], 'state.counters');
  for (const [key, value] of Object.entries(state.counters)) {
    if (!Number.isSafeInteger(value) || value < 0) fail(`state.counters.${key} must be a nonnegative safe integer`, 'INVALID_STATE');
  }
  const expectedCounters = {
    mechanicalBeats: counterFromCycles(state.cycles.mechanicalBeats, 'mechanical beat'),
    quartzCycles: counterFromCycles(state.cycles.quartzCycles, 'quartz cycle'),
    motorCommands: Number(floorInternal(divideInternal(toInternal(state.cycles.quartzCycles), internalRational(2n ** BigInt(state.config.dividerStages))))),
    softwareUpdates: counterFromCycles(state.cycles.softwareUpdates, 'software update'),
  };
  if (canonicalWatchJson(expectedCounters) !== canonicalWatchJson(state.counters)) fail('state counters do not match exact accumulated cycles', 'INVALID_STATE');
  const expectedDisplayTime = displayTimes(state.config, state.counters);
  requireExactKeys(state.displayTime, ['mechanical', 'quartz', 'software'], 'state.displayTime');
  for (const [key, value] of Object.entries(state.displayTime)) validateStateRational(value, `state.displayTime.${key}`);
  if (canonicalWatchJson(expectedDisplayTime) !== canonicalWatchJson(state.displayTime)) fail('state displayTime does not match visible counters and initial nominal gearing', 'INVALID_STATE');
  requireObject(state.models, 'state.models');
  if (canonicalWatchJson(softwareModelFor(state)) !== canonicalWatchJson(state.models.software)) fail('state software model does not match its transport fields', 'INVALID_STATE');
  if (canonicalWatchJson(state.softwareTransport) !== canonicalWatchJson({ policy: 'shared-logical-time', enabled: true })) fail('state software transport policy is invalid', 'INVALID_STATE');
  requireExactKeys(state.history, ['actions', 'events', 'bytes', 'limits', 'session'], 'state.history');
  if (!Array.isArray(state.history.actions) || !Array.isArray(state.history.events)) fail('state history is invalid', 'INVALID_STATE');
  if (canonicalWatchJson(state.history.limits) !== canonicalWatchJson(state.config.limits)) fail('state history limits do not match config', 'INVALID_STATE');
  if (!Number.isSafeInteger(state.history.session) || state.history.session < 1) fail('state history session must be a positive safe integer', 'INVALID_STATE');
  const actionSession = [];
  let replaySession = 1;
  for (const action of state.history.actions) {
    const normalized = normalizeAction(action);
    if (canonicalWatchJson(normalized) !== canonicalWatchJson(action)) fail('state action history must contain normalized actions', 'INVALID_STATE');
    actionSession.push(replaySession);
    if (action.type === 'reset') replaySession += 1;
  }
  if (replaySession !== state.history.session) fail('state history session does not match retained reset actions', 'INVALID_STATE');
  const previousEnd = new Map();
  const previousTime = new Map();
  const seenSequenceEvent = new Set();
  const lastCurrentCounter = new Map();
  let previousSequence = 0;
  for (const event of state.history.events) {
    requireExactKeys(event, ['event', 'model', 'start', 'end', 'timeStart', 'timeEnd', 'session', 'sequence'], 'state history event');
    if (!STEP_EVENTS.has(event.event) || !['mechanical', 'quartz', 'software'].includes(event.model)) fail('state history event has an invalid event or model', 'INVALID_STATE');
    const expectedModel = event.event === 'mechanicalBeat' ? 'mechanical' : event.event === 'softwareUpdate' ? 'software' : 'quartz';
    if (event.model !== expectedModel) fail('state history event model does not match its event', 'INVALID_STATE');
    if (!Number.isSafeInteger(event.start) || !Number.isSafeInteger(event.end) || event.start < 1 || event.end < event.start) fail('state history event has invalid inclusive counter bounds', 'INVALID_STATE');
    if (!Number.isSafeInteger(event.session) || event.session < 1 || event.session > state.history.session || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence > state.history.actions.length) fail('state history event has invalid session or sequence', 'INVALID_STATE');
    if (event.sequence < previousSequence || actionSession[event.sequence - 1] !== event.session) fail('state history event order does not match its action session', 'INVALID_STATE');
    previousSequence = event.sequence;
    const actionType = state.history.actions[event.sequence - 1].type;
    if (actionType !== 'advance' && actionType !== 'step') fail('state history events must reference advance or step actions', 'INVALID_STATE');
    const firstEventTime = validateStateRational(event.timeStart, 'state history event timeStart');
    const lastEventTime = validateStateRational(event.timeEnd, 'state history event timeEnd');
    if (compareInternal(toInternal(lastEventTime), toInternal(firstEventTime)) < 0 || (event.end > event.start && compareInternal(toInternal(lastEventTime), toInternal(firstEventTime)) === 0)) fail('state history event times do not increase with their counter range', 'INVALID_STATE');
    if (event.session === state.history.session && compareInternal(toInternal(lastEventTime), toInternal(logicalTime)) > 0) fail('current-session event cannot occur after common logical time', 'INVALID_STATE');
    const key = `${event.session}:${event.event}`;
    const sequenceEvent = `${event.sequence}:${event.event}`;
    if (seenSequenceEvent.has(sequenceEvent)) fail('an action cannot record two ranges for one event type', 'INVALID_STATE');
    seenSequenceEvent.add(sequenceEvent);
    const expectedStart = (previousEnd.get(key) ?? 0) + 1;
    if (event.start !== expectedStart) fail('state history event ranges must be contiguous within each session and event type', 'INVALID_STATE');
    const priorTime = previousTime.get(key);
    if (priorTime && compareInternal(toInternal(firstEventTime), priorTime) <= 0) fail('state history event times must increase within each session and event type', 'INVALID_STATE');
    previousEnd.set(key, event.end);
    previousTime.set(key, toInternal(lastEventTime));
    if (event.session === state.history.session) lastCurrentCounter.set(event.event, event.end);
  }
  const currentEventCounters = {
    mechanicalBeat: state.counters.mechanicalBeats,
    quartzCycle: state.counters.quartzCycles,
    motorCommand: state.counters.motorCommands,
    softwareUpdate: state.counters.softwareUpdates,
  };
  for (const [event, count] of Object.entries(currentEventCounters)) {
    if ((lastCurrentCounter.get(event) ?? 0) !== count) fail(`state history does not account for current ${event} counter`, 'INVALID_STATE');
  }
  const computedBytes = historyByteCount(state.history.actions, state.history.events);
  if (state.history.bytes !== computedBytes || computedBytes > state.config.limits.maxBytes) fail('state history byte count is invalid', 'INVALID_STATE');
  if (state.history.actions.length > state.config.limits.maxActions) fail('state action count exceeds its limit', 'INVALID_STATE');
  return state;
}

function currentRate(state, model) {
  const key = `${model}Hz`;
  if (!Object.hasOwn(state.rates, key)) fail(`unknown rate model ${model}`, 'INVALID_ACTION');
  return toInternal(state.rates[key], `${model} rate`);
}

function eventRate(state, event) {
  const divider = 2n ** BigInt(state.config.dividerStages);
  if (event === 'mechanicalBeat') return multiplyInternal(currentRate(state, 'mechanical'), internalRational(2n));
  if (event === 'quartzCycle') return currentRate(state, 'quartz');
  if (event === 'motorCommand') return divideInternal(currentRate(state, 'quartz'), internalRational(divider));
  if (event === 'softwareUpdate') return currentRate(state, 'software');
  fail(`unknown event ${event}`, 'INVALID_ACTION');
}

function eventPhase(state, event) {
  const divider = 2n ** BigInt(state.config.dividerStages);
  if (event === 'mechanicalBeat') return toInternal(state.cycles.mechanicalBeats);
  if (event === 'quartzCycle') return toInternal(state.cycles.quartzCycles);
  if (event === 'motorCommand') return divideInternal(toInternal(state.cycles.quartzCycles), internalRational(divider));
  if (event === 'softwareUpdate') return toInternal(state.cycles.softwareUpdates);
  fail(`unknown event ${event}`, 'INVALID_ACTION');
}

function eventCounter(state, event) {
  if (event === 'mechanicalBeat') return state.counters.mechanicalBeats;
  if (event === 'quartzCycle') return state.counters.quartzCycles;
  if (event === 'motorCommand') return state.counters.motorCommands;
  if (event === 'softwareUpdate') return state.counters.softwareUpdates;
  fail(`unknown event ${event}`, 'INVALID_ACTION');
}

function sourceEnabled(state, event) {
  if (event === 'mechanicalBeat') return state.energy.mainspring;
  if (event === 'quartzCycle' || event === 'motorCommand') return state.energy.battery;
  return true;
}

function timeAtBoundary(startTime, startPhase, boundary, rate) {
  const offset = divideInternal(subtractInternal(internalRational(BigInt(boundary)), startPhase), rate);
  return publicRational(addInternal(toInternal(startTime), offset), 'event time');
}

function rangeForAdvance(state, event, startPhase, startCounter, endCounter, rate, startTime, sequence) {
  if (endCounter <= startCounter) return null;
  const first = startCounter + 1;
  return {
    event,
    model: event === 'mechanicalBeat' ? 'mechanical' : event === 'softwareUpdate' ? 'software' : 'quartz',
    start: first,
    end: endCounter,
    timeStart: timeAtBoundary(startTime, startPhase, first, rate),
    timeEnd: timeAtBoundary(startTime, startPhase, endCounter, rate),
    session: state.history.session,
    sequence,
  };
}

function addRange(state, range) {
  if (range) state.history.events.push(range);
}

function advanceState(state, durationPublic, sequence) {
  const duration = toInternal(durationPublic, 'advance duration');
  const startTime = cloneJson(state.time);
  const startCycles = cloneJson(state.cycles);
  const startCounters = { ...state.counters };
  const rates = {
    mechanicalBeat: multiplyInternal(currentRate(state, 'mechanical'), internalRational(2n)),
    quartzCycle: currentRate(state, 'quartz'),
    motorCommand: divideInternal(currentRate(state, 'quartz'), internalRational(2n ** BigInt(state.config.dividerStages))),
    softwareUpdate: currentRate(state, 'software'),
  };

  if (state.energy.mainspring) {
    state.operatingTime.mechanical = publicRational(addInternal(toInternal(state.operatingTime.mechanical), duration), 'mechanical operating time');
    state.cycles.mechanicalBeats = addCycles(state.cycles.mechanicalBeats, multiplyInternal(duration, rates.mechanicalBeat), 'mechanical beat');
  }
  if (state.energy.battery) {
    state.operatingTime.quartz = publicRational(addInternal(toInternal(state.operatingTime.quartz), duration), 'quartz operating time');
    state.cycles.quartzCycles = addCycles(state.cycles.quartzCycles, multiplyInternal(duration, rates.quartzCycle), 'quartz cycle');
  }
  state.operatingTime.software = publicRational(addInternal(toInternal(state.operatingTime.software), duration), 'software operating time');
  state.cycles.softwareUpdates = addCycles(state.cycles.softwareUpdates, multiplyInternal(duration, rates.softwareUpdate), 'software update');
  state.time = publicRational(addInternal(toInternal(state.time), duration), 'logical time');
  refreshDerived(state);

  if (state.energy.mainspring && rates.mechanicalBeat.n > 0n) {
    addRange(state, rangeForAdvance(state, 'mechanicalBeat', toInternal(startCycles.mechanicalBeats), startCounters.mechanicalBeats, state.counters.mechanicalBeats, rates.mechanicalBeat, startTime, sequence));
  }
  if (state.energy.battery && rates.quartzCycle.n > 0n) {
    addRange(state, rangeForAdvance(state, 'quartzCycle', toInternal(startCycles.quartzCycles), startCounters.quartzCycles, state.counters.quartzCycles, rates.quartzCycle, startTime, sequence));
    const divider = internalRational(2n ** BigInt(state.config.dividerStages));
    addRange(state, rangeForAdvance(
      state, 'motorCommand', divideInternal(toInternal(startCycles.quartzCycles), divider), startCounters.motorCommands,
      state.counters.motorCommands, rates.motorCommand, startTime, sequence,
    ));
  }
  if (rates.softwareUpdate.n > 0n) {
    addRange(state, rangeForAdvance(state, 'softwareUpdate', toInternal(startCycles.softwareUpdates), startCounters.softwareUpdates, state.counters.softwareUpdates, rates.softwareUpdate, startTime, sequence));
  }
}

function addCycles(current, increment, label) {
  const next = addInternal(toInternal(current), increment);
  if (floorInternal(next) > MAX_SAFE) fail(`${label} counter exceeds the safe integer range`, 'COUNTER_OVERFLOW');
  return publicRational(next, `${label} cycles`);
}

function stepDuration(state, event) {
  if (!sourceEnabled(state, event)) fail(`${event} cannot advance while its energy source is off`, 'POWERED_OFF');
  const rate = eventRate(state, event);
  if (rate.n === 0n) fail(`${event} is unreachable at zero rate`, 'ZERO_RATE');
  const phase = eventPhase(state, event);
  const nextBoundary = floorInternal(phase) + 1n;
  return publicRational(divideInternal(subtractInternal(internalRational(nextBoundary), phase), rate), 'step duration');
}

function resetState(state) {
  const reset = cloneJson(makeState(state.config, state.history.session + 1));
  reset.history.actions = cloneJson(state.history.actions);
  reset.history.events = cloneJson(state.history.events);
  reset.history.bytes = state.history.bytes;
  return reset;
}

export function applyWatchAction(stateInput, actionInput) {
  validateState(stateInput);
  canonicalWatchJson(actionInput);
  const action = normalizeAction(actionInput);
  if (stateInput.history.actions.length >= stateInput.config.limits.maxActions) {
    fail(`action history limit reached (${stateInput.config.limits.maxActions}); export and create a new run`, 'HISTORY_ACTION_LIMIT');
  }
  const sequence = stateInput.history.actions.length + 1;
  let state = cloneJson(stateInput);

  if (action.type === 'advance') {
    if (action.origin === 'autoplay' && state.paused) fail('autoplay is paused', 'AUTOPLAY_PAUSED');
    if (action.origin === 'autoplay' && state.visibilityHidden) fail('autoplay is frozen while the page is hidden', 'AUTOPLAY_HIDDEN');
    advanceState(state, action.duration, sequence);
  } else if (action.type === 'step') {
    const duration = stepDuration(state, action.event);
    advanceState(state, duration, sequence);
  } else if (action.type === 'pause') {
    state.paused = true;
  } else if (action.type === 'resume') {
    state.paused = false;
  } else if (action.type === 'reset') {
    state = resetState(state);
  } else if (action.type === 'energy') {
    state.energy[action.source] = action.enabled;
  } else if (action.type === 'rate') {
    state.rates[`${action.model}Hz`] = cloneJson(action.hz);
  } else if (action.type === 'visibility') {
    state.visibilityHidden = action.hidden;
  }

  state.history.actions.push(action);
  state.history.bytes = historyByteCount(state.history.actions, state.history.events);
  if (state.history.bytes > state.config.limits.maxBytes) {
    fail(`history byte limit reached (${state.config.limits.maxBytes}); export and create a new run`, 'HISTORY_BYTE_LIMIT');
  }
  refreshDerived(state);
  return freezeDeep(state);
}

export function replayWatchRun(config = {}, actions = []) {
  if (!Array.isArray(actions)) fail('replay actions must be an array', 'INVALID_REPLAY');
  canonicalWatchJson(actions);
  let state = createWatchRun(config);
  for (const action of actions) state = applyWatchAction(state, action);
  return state;
}

function validateCounterRange(rangeInput) {
  canonicalWatchJson(rangeInput);
  requireObject(rangeInput, 'counter range');
  const range = rangeInput;
  if (!STEP_EVENTS.has(range.event) || !['mechanical', 'quartz', 'software'].includes(range.model)) fail('counter range has an invalid event or model', 'INVALID_RANGE');
  const expectedModel = range.event === 'mechanicalBeat' ? 'mechanical' : range.event === 'softwareUpdate' ? 'software' : 'quartz';
  if (range.model !== expectedModel) fail('counter range model does not match its event', 'INVALID_RANGE');
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 1 || range.end < range.start) {
    fail('counter range must have positive inclusive safe-integer bounds', 'INVALID_RANGE');
  }
  if (!Number.isSafeInteger(range.session) || range.session < 1 || !Number.isSafeInteger(range.sequence) || range.sequence < 1) fail('counter range session and sequence must be positive safe integers', 'INVALID_RANGE');
  const firstTime = toInternal(range.timeStart, 'range timeStart');
  const lastTime = toInternal(range.timeEnd, 'range timeEnd');
  if (firstTime.n < 0n || compareInternal(lastTime, firstTime) < 0) fail('counter range times must be nonnegative and increasing', 'INVALID_RANGE');
  const total = range.end - range.start + 1;
  if (total === 1 && compareInternal(firstTime, lastTime) !== 0) fail('a single-event range must have one exact boundary time', 'INVALID_RANGE');
  if (total > 1 && compareInternal(lastTime, firstTime) === 0) fail('a multi-event range must have increasing boundary times', 'INVALID_RANGE');
  const eventInterval = total === 1 ? internalRational(0n) : divideInternal(subtractInternal(lastTime, firstTime), internalRational(BigInt(total - 1)));
  return { range, total, firstTime, eventInterval };
}

export function expandCounterWindow(rangeInput, windowInput = {}) {
  const { range, total, firstTime, eventInterval } = validateCounterRange(rangeInput);
  canonicalWatchJson(windowInput);
  requireObject(windowInput, 'counter window');
  onlyKeys(windowInput, new Set(['offset', 'count', 'limit']), 'counter window');
  const offset = windowInput.offset ?? 0;
  const limit = windowInput.limit ?? MAX_EXPANSION_EVENTS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EXPANSION_EVENTS) fail(`expansion limit must be from 1 through ${MAX_EXPANSION_EVENTS}`, 'INVALID_EXPANSION_LIMIT');
  const count = windowInput.count;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 1) fail('counter window requires a nonnegative offset and positive count', 'INVALID_WINDOW');
  if (count > limit) fail(`counter window of ${count} events exceeds limit ${limit}`, 'EXPANSION_LIMIT');
  if (offset >= total || offset + count > total) fail('counter window extends beyond the available range', 'INVALID_WINDOW');
  const events = Array.from({ length: count }, (_, index) => {
    const relativeOffset = offset + index;
    return {
    event: range.event,
    model: range.model,
    index: range.start + relativeOffset,
    time: publicRational(addInternal(firstTime, multiplyInternal(eventInterval, internalRational(BigInt(relativeOffset)))), 'expanded event time'),
    session: range.session,
    sequence: range.sequence,
    };
  });
  return { events, offset, count, total, clippedBefore: offset > 0, clippedAfter: offset + count < total };
}

export function expandCounterRange(rangeInput, limit = MAX_EXPANSION_EVENTS) {
  const { total } = validateCounterRange(rangeInput);
  return expandCounterWindow(rangeInput, { offset: 0, count: total, limit }).events;
}
