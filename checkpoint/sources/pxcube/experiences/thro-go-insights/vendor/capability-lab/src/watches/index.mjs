import {
  applyWatchAction as applyTransportAction,
  canonicalWatchJson,
  createWatchRun as createTransportRun,
  expandCounterRange,
  expandCounterWindow,
  normalizeRational,
} from './transport.mjs';
import { mechanismSnapshot } from './mechanisms.mjs';
import { watchGeometry as transformWatchGeometry } from './geometry.mjs';
import {
  componentDefinitions,
  componentSources,
  describeWatchComponent,
} from './components.mjs';

export {
  canonicalWatchJson,
  componentDefinitions,
  componentSources,
  describeWatchComponent,
  expandCounterRange,
  expandCounterWindow,
};

const TRACE_BYTE_LIMIT = 8_192;
const TRACE_VERSION = 'watch-workbench-1';

/** Create a paused, zero-time watch run and bind its real mechanism snapshots. */
export function createWatchRun(config = {}) {
  const state = createTransportRun(config);
  const transportCall = callRecord(
    'src/watches/transport.mjs#createWatchRun',
    { config: state.config },
    transportSummary(state),
  );
  return withMechanisms(state, [transportCall]);
}

/** Apply one transport action and refresh the two analytic mechanism models. */
export function applyWatchAction(state, action) {
  return applyTransportTransition(state, action, []);
}

/** Replay ordered actions through the same wrapper calls used by an interactive run. */
export function replayWatchRun(config = {}, actions = []) {
  if (!Array.isArray(actions)) throw new TypeError('actions must be an array');
  let state = createWatchRun(config);
  for (const action of actions) state = applyWatchAction(state, action);
  return {
    state,
    canonicalState: canonicalWatchJson(state),
    canonicalEvents: canonicalWatchJson(state.history.events),
  };
}

/** Sample a target rational time using the same transport and snapshot path. */
export function watchStateAt(config = {}, time, energy) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  const sampleConfig = { ...config };
  if (energy !== undefined) {
    if (energy === null || typeof energy !== 'object' || Array.isArray(energy)) {
      throw new TypeError('energy must be an object with mainspring and/or battery booleans');
    }
    const keys = Object.keys(energy);
    if (keys.some(key => !['mainspring', 'battery'].includes(key))) {
      throw new TypeError('energy may contain only mainspring and battery');
    }
    if (keys.some(key => typeof energy[key] !== 'boolean')) {
      throw new TypeError('energy values must be booleans');
    }
    sampleConfig.energy = { ...(config.energy ?? {}), ...energy };
  }

  const target = normalizeRational(time, 'time');
  return applyWatchAction(createWatchRun(sampleConfig), {
    type: 'advance', duration: target, origin: 'manual',
  });
}

/** Return schematic geometry. The selected part and explosion are view-only. */
export function watchGeometry(state, explode = 0, selected = null) {
  return transformWatchGeometry(state, explode, selected);
}

/** Expand one event page under both the transport hard cap and this run's cap. */
export function expandWatchCounterWindow(state, range, window = {}) {
  assertWatchState(state);
  if (window === null || typeof window !== 'object' || Array.isArray(window)) {
    throw new TypeError('window must be an object');
  }
  const canonicalRange = canonicalWatchJson(range);
  if (!state.history.events.some(event => canonicalWatchJson(event) === canonicalRange)) {
    throw new RangeError('counter range is not retained in this watch run');
  }
  const runLimit = state.history.limits.maxExpandEvents;
  const limit = window.limit ?? runLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > runLimit) {
    throw new RangeError(`expansion limit must be from 1 through this run's maximum ${runLimit}`);
  }
  return expandCounterWindow(range, { ...window, limit });
}

function applyTransportTransition(state, action, leadingCalls) {
  assertWatchState(state);
  const before = stripWrapperState(state);
  const after = applyTransportAction(before, action);
  return withMechanisms(after, [...leadingCalls, ...transitionCallRecords(before, after)]);
}

function transitionCallRecords(before, after) {
  const priorEventCount = before.history.events.length;
  const eventRanges = after.history.events.slice(priorEventCount);
  const retainedAction = after.history.actions.at(-1);
  return [callRecord(
    'src/watches/transport.mjs#applyWatchAction',
    { action: retainedAction },
    { ...transportSummary(after), eventRanges },
  )];
}

function withMechanisms(state, precedingCalls) {
  const mechanisms = mechanismSnapshot(state.config, state);
  const calls = [
    ...precedingCalls,
    callRecord(
      'src/watches/mechanisms.mjs#mechanismSnapshot',
      { config: state.config, snapshot: mechanismInput(state) },
      mechanismResultIdentity(mechanisms),
    ),
  ];
  const tracePayload = { schema: 'watch.calculation-trace.v1', calls };
  const serialized = canonicalWatchJson(tracePayload);
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > TRACE_BYTE_LIMIT) {
    throw new RangeError(`watch calculation trace is ${bytes} bytes; maximum is ${TRACE_BYTE_LIMIT}`);
  }
  const wrapped = {
    ...state,
    models: { ...state.models, ...mechanisms },
    calculationTrace: { ...tracePayload, bytes },
  };
  return freezeDeep(wrapped);
}

function callRecord(id, input, result) {
  return {
    id,
    source: 'capability-lab',
    version: TRACE_VERSION,
    input: cloneJson(input),
    result: cloneJson(result),
  };
}

function mechanismInput(state) {
  return {
    time: state.time,
    rates: state.rates,
    operatingTime: state.operatingTime,
    displayTime: state.displayTime,
    counters: state.counters,
    cycles: state.cycles,
    energy: state.energy,
    paused: state.paused,
    visibilityHidden: state.visibilityHidden,
  };
}

function transportSummary(state) {
  return {
    time: state.time,
    rates: state.rates,
    operatingTime: state.operatingTime,
    displayTime: state.displayTime,
    cycles: state.cycles,
    counters: state.counters,
    energy: state.energy,
    paused: state.paused,
    visibilityHidden: state.visibilityHidden,
  };
}

function mechanismResultIdentity(result) {
  const canonical = canonicalWatchJson(result);
  return {
    canonicalHash: fnv1a64(canonical),
    canonicalBytes: new TextEncoder().encode(canonical).length,
    summary: {
      mechanical: mechanismSummary(result.mechanical),
      quartz: mechanismSummary(result.quartz),
    },
  };
}

function mechanismSummary(model) {
  return {
    logicalTime: model.logicalTime,
    operatingTime: model.operatingTime,
    displayTime: model.displayTime,
    frequencyHz: model.frequencyHz,
    nominalFrequencyHz: model.nominalFrequencyHz,
    energy: model.energy,
    timing: model.timing,
    counts: model.counts,
    handAnglesDegrees: model.handAnglesDegrees,
    ...(model.oscillator ? { oscillator: model.oscillator } : {}),
    ...(model.escapement ? { escapement: model.escapement } : {}),
    ...(model.dividerStages ? {
      dividerStageCount: model.dividerStages.length,
      firstDividerStage: model.dividerStages[0] ?? null,
      lastDividerStage: model.dividerStages.at(-1) ?? null,
    } : {}),
    ...(model.gearTrain ? { gearPairs: {
      secondToMinute: model.gearTrain.gearPairs.secondToMinute.length,
      minuteToHour: model.gearTrain.gearPairs.minuteToHour.length,
    } } : {}),
  };
}

function fnv1a64(value) {
  const offset = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = offset;
  for (const byte of new TextEncoder().encode(value)) hash = ((hash ^ BigInt(byte)) * prime) & mask;
  return hash.toString(16).padStart(16, '0');
}

function stripWrapperState(state) {
  const { calculationTrace, ...base } = state;
  const models = { ...base.models };
  delete models.mechanical;
  delete models.quartz;
  return { ...base, models };
}

function assertWatchState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('state must be a watch run object');
  }
  if (!state.config || !state.history || !state.models) {
    throw new TypeError('state must be created by createWatchRun or returned by applyWatchAction');
  }
}

function cloneJson(value) {
  return JSON.parse(canonicalWatchJson(value));
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
