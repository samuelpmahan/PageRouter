import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WatchTransportError,
  createWatchRun,
  applyWatchAction,
  replayWatchRun,
  normalizeRational,
  addRational,
  subtractRational,
  multiplyRational,
  divideRational,
  compareRational,
  floorRational,
  canonicalWatchJson,
  expandCounterRange,
  expandCounterWindow,
} from '../../src/watches/transport.mjs';

const rat = (numerator, denominator = 1) => ({ numerator, denominator });
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const mustThrowCode = (fn, code) => assert.throws(fn, (error) => error instanceof WatchTransportError && error.code === code);

test('rational helpers normalize signs and preserve exact arithmetic', () => {
  assert.deepEqual(normalizeRational(rat(6, -8)), rat(-3, 4));
  assert.deepEqual(addRational(rat(1, 3), rat(1, 6)), rat(1, 2));
  assert.deepEqual(subtractRational(rat(1, 3), rat(1, 6)), rat(1, 6));
  assert.deepEqual(multiplyRational(rat(2, 3), rat(9, 4)), rat(3, 2));
  assert.deepEqual(divideRational(rat(3, 5), rat(9, 10)), rat(2, 3));
  assert.equal(compareRational(rat(2, 3), rat(4, 6)), 0);
  assert.equal(floorRational(rat(-1, 2)), -1);
  assert.throws(() => divideRational(rat(1), rat(0)), /zero/i);
  assert.throws(() => normalizeRational(rat(Number.MAX_SAFE_INTEGER + 1)), /safe integer/i);
  assert.throws(() => normalizeRational(rat(1, -Number.MAX_SAFE_INTEGER - 1)), /safe integer/i);
});

test('default rates produce independently derived counts after 60 exact seconds', () => {
  const initial = createWatchRun();
  assert.equal(initial.paused, true);
  const state = applyWatchAction(initial, { type: 'advance', duration: rat(60) });
  assert.deepEqual(state.time, rat(60));
  assert.deepEqual(state.rates, { mechanicalHz: rat(4), quartzHz: rat(32768), softwareHz: rat(256) });
  assert.deepEqual(state.counters, { mechanicalBeats: 480, quartzCycles: 1_966_080, motorCommands: 60, softwareUpdates: 15_360 });
  assert.deepEqual(state.operatingTime, { mechanical: rat(60), quartz: rat(60), software: rat(60) });
  assert.deepEqual(state.displayTime, { mechanical: rat(60), quartz: rat(60), software: rat(60) });
  close(state.models.software.handAnglesDegrees.second, 0);
  close(state.models.software.handAnglesDegrees.minute, 6);
  close(state.models.software.handAnglesDegrees.hour, 0.5);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.history.actions));
});

test('zero phase counts include exact event boundaries across all default models', () => {
  const start = createWatchRun();
  const state = applyWatchAction(start, { type: 'advance', duration: rat(1, 8) });
  assert.deepEqual(state.counters, { mechanicalBeats: 1, quartzCycles: 4096, motorCommands: 0, softwareUpdates: 32 });
  assert.deepEqual(state.cycles.mechanicalBeats, rat(1));
  assert.deepEqual(state.cycles.quartzCycles, rat(4096));
  assert.deepEqual(state.cycles.softwareUpdates, rat(32));
});

test('selected software step advances shared time and compact ranges include exact first and last boundaries', () => {
  const state = applyWatchAction(createWatchRun(), { type: 'step', event: 'softwareUpdate' });
  assert.deepEqual(state.time, rat(1, 256));
  assert.deepEqual(state.counters, { mechanicalBeats: 0, quartzCycles: 128, motorCommands: 0, softwareUpdates: 1 });
  const quartzRange = state.history.events.find((entry) => entry.event === 'quartzCycle');
  assert.deepEqual({ start: quartzRange.start, end: quartzRange.end, timeStart: quartzRange.timeStart, timeEnd: quartzRange.timeEnd }, {
    start: 1, end: 128, timeStart: rat(1, 32768), timeEnd: rat(1, 256),
  });
  const expanded = expandCounterRange(quartzRange, 128);
  assert.equal(expanded.length, 128);
  assert.deepEqual(expanded[0].time, rat(1, 32768));
  assert.deepEqual(expanded.at(-1).time, rat(1, 256));
  assert.throws(() => expandCounterRange(quartzRange, 127), /limit|bounded/i);
});

test('selected event steps land on that event boundary while all other models share the exact elapsed time', () => {
  let state = applyWatchAction(createWatchRun(), { type: 'step', event: 'quartzCycle' });
  assert.deepEqual(state.time, rat(1, 32768));
  state = applyWatchAction(state, { type: 'step', event: 'mechanicalBeat' });
  assert.deepEqual(state.time, rat(1, 8));
  assert.deepEqual(state.counters, { mechanicalBeats: 1, quartzCycles: 4096, motorCommands: 0, softwareUpdates: 32 });
  assert.deepEqual(state.cycles.quartzCycles, rat(4096));
  assert.deepEqual(state.cycles.softwareUpdates, rat(32));

  state = applyWatchAction(createWatchRun(), { type: 'step', event: 'quartzCycle' });
  state = applyWatchAction(state, { type: 'step', event: 'motorCommand' });
  assert.deepEqual(state.time, rat(1));
  assert.deepEqual(state.counters, { mechanicalBeats: 8, quartzCycles: 32768, motorCommands: 1, softwareUpdates: 256 });

  state = applyWatchAction(createWatchRun(), { type: 'step', event: 'quartzCycle' });
  state = applyWatchAction(state, { type: 'step', event: 'softwareUpdate' });
  assert.deepEqual(state.time, rat(1, 256));
  assert.equal(state.counters.quartzCycles, 128);
  assert.equal(state.counters.softwareUpdates, 1);
});

test('a selected step after a rate fault preserves the phase and uses the new event rate', () => {
  let state = applyWatchAction(createWatchRun(), { type: 'advance', duration: rat(1, 16) });
  state = applyWatchAction(state, { type: 'rate', model: 'mechanical', hz: 2 });
  state = applyWatchAction(state, { type: 'step', event: 'mechanicalBeat' });
  assert.deepEqual(state.time, rat(3, 16));
  assert.deepEqual(state.cycles.mechanicalBeats, rat(1));
  assert.deepEqual(state.displayTime.mechanical, rat(1, 8));
  assert.deepEqual(state.counters, { mechanicalBeats: 1, quartzCycles: 6144, motorCommands: 0, softwareUpdates: 48 });
});

test('bounded event windows expose clipped sides and preserve exact original event times', () => {
  const state = applyWatchAction(createWatchRun(), { type: 'advance', duration: rat(60) });
  const quartzRange = state.history.events.find((entry) => entry.event === 'quartzCycle');
  const window = expandCounterWindow(quartzRange, { offset: 1_000_000, count: 3, limit: 3 });
  assert.equal(window.total, 1_966_080);
  assert.equal(window.clippedBefore, true);
  assert.equal(window.clippedAfter, true);
  assert.equal(window.events.length, 3);
  assert.deepEqual(window.events.map((entry) => entry.index), [1_000_001, 1_000_002, 1_000_003]);
  assert.deepEqual(window.events[0].time, rat(1_000_001, 32_768));
  assert.deepEqual(window.events[2].time, rat(1_000_003, 32_768));
  assert.throws(() => expandCounterWindow(quartzRange, { offset: 1_966_079, count: 2, limit: 2 }), /range|window/i);
  assert.throws(() => expandCounterWindow(quartzRange, { offset: 0, count: 513, limit: 513 }), /limit|bounded/i);
  assert.throws(() => expandCounterWindow({ ...quartzRange, model: 'mechanical' }, { offset: 0, count: 1 }), /model/i);
  assert.throws(() => expandCounterWindow({ ...quartzRange, end: quartzRange.start, timeEnd: rat(61) }, { offset: 0, count: 1 }), /single-event|boundary/i);
});

test('rate changes retain fractional cycles and nominal display gearing while elapsed drift accumulates', () => {
  const config = { mechanicalHz: 4, quartzHz: 32768, softwareHz: 256 };
  let state = applyWatchAction(createWatchRun(config), { type: 'advance', duration: rat(1, 16) });
  assert.deepEqual(state.cycles.mechanicalBeats, rat(1, 2));
  const beforeRate = canonicalWatchJson({ counters: state.counters, cycles: state.cycles, displayTime: state.displayTime });
  state = applyWatchAction(state, { type: 'rate', model: 'mechanical', hz: 2 });
  assert.equal(canonicalWatchJson({ counters: state.counters, cycles: state.cycles, displayTime: state.displayTime }), beforeRate);
  state = applyWatchAction(state, { type: 'advance', duration: rat(1, 8) });
  assert.equal(state.counters.mechanicalBeats, 1);
  assert.deepEqual(state.cycles.mechanicalBeats, rat(1));
  assert.deepEqual(state.displayTime.mechanical, rat(1, 8));
  assert.deepEqual(state.time, rat(3, 16));
});

test('current zero rate halts only that model, retains phase, and rejects stepping that event', () => {
  let state = createWatchRun({ quartzHz: 16, dividerStages: 4 });
  state = applyWatchAction(state, { type: 'advance', duration: rat(1, 32) });
  assert.deepEqual(state.cycles.quartzCycles, rat(1, 2));
  state = applyWatchAction(state, { type: 'rate', model: 'quartz', hz: 0 });
  state = applyWatchAction(state, { type: 'advance', duration: rat(1) });
  assert.deepEqual(state.cycles.quartzCycles, rat(1, 2));
  assert.equal(state.counters.softwareUpdates, 264);
  mustThrowCode(() => applyWatchAction(state, { type: 'step', event: 'quartzCycle' }), 'ZERO_RATE');
  state = applyWatchAction(state, { type: 'rate', model: 'quartz', hz: 16 });
  state = applyWatchAction(state, { type: 'advance', duration: rat(1, 32) });
  assert.deepEqual(state.cycles.quartzCycles, rat(1));
  assert.equal(state.counters.quartzCycles, 1);
});

test('energy interruption holds powered counts while common time and software continue', () => {
  let state = createWatchRun();
  state = applyWatchAction(state, { type: 'energy', source: 'battery', enabled: false });
  state = applyWatchAction(state, { type: 'advance', duration: rat(2) });
  assert.deepEqual(state.time, rat(2));
  assert.deepEqual(state.operatingTime, { mechanical: rat(2), quartz: rat(0), software: rat(2) });
  assert.equal(state.counters.quartzCycles, 0);
  assert.equal(state.counters.motorCommands, 0);
  assert.equal(state.counters.softwareUpdates, 512);
  mustThrowCode(() => applyWatchAction(state, { type: 'step', event: 'motorCommand' }), 'POWERED_OFF');
  state = applyWatchAction(state, { type: 'energy', source: 'battery', enabled: true });
  state = applyWatchAction(state, { type: 'advance', duration: rat(1) });
  assert.equal(state.counters.quartzCycles, 32768);
});

test('autoplay respects pause and hidden visibility while manual advance and step remain available', () => {
  let state = createWatchRun();
  mustThrowCode(() => applyWatchAction(state, { type: 'advance', duration: rat(1), origin: 'autoplay' }), 'AUTOPLAY_PAUSED');
  state = applyWatchAction(state, { type: 'advance', duration: rat(1, 256) });
  assert.equal(state.counters.softwareUpdates, 1);
  state = applyWatchAction(state, { type: 'resume' });
  state = applyWatchAction(state, { type: 'visibility', hidden: true });
  mustThrowCode(() => applyWatchAction(state, { type: 'advance', duration: rat(1), origin: 'autoplay' }), 'AUTOPLAY_HIDDEN');
  const hiddenTime = state.time;
  state = applyWatchAction(state, { type: 'step', event: 'mechanicalBeat' });
  assert.equal(compareRational(state.time, hiddenTime), 1);
});

test('reset restores initial state, retains ordered history, and replays canonically', () => {
  const config = { mechanicalHz: rat(3, 2), quartzHz: 64, softwareHz: 10, dividerStages: 6, energy: { mainspring: false, battery: true } };
  let state = createWatchRun(config);
  state = applyWatchAction(state, { type: 'rate', model: 'mechanical', hz: 0 });
  state = applyWatchAction(state, { type: 'advance', duration: rat(1, 3) });
  state = applyWatchAction(state, { type: 'visibility', hidden: true });
  state = applyWatchAction(state, { type: 'reset' });
  assert.deepEqual(state.time, rat(0));
  assert.equal(state.paused, true);
  assert.equal(state.visibilityHidden, false);
  assert.deepEqual(state.rates, { mechanicalHz: rat(3, 2), quartzHz: rat(64), softwareHz: rat(10) });
  assert.deepEqual(state.energy, { mainspring: false, battery: true });
  assert.deepEqual(state.counters, { mechanicalBeats: 0, quartzCycles: 0, motorCommands: 0, softwareUpdates: 0 });
  assert.equal(state.history.session, 2);
  assert.equal(state.history.actions.at(-1).type, 'reset');
  assert.ok(state.history.events.every((event) => event.session === 1));
  const replay = replayWatchRun(config, state.history.actions);
  assert.equal(canonicalWatchJson(replay), canonicalWatchJson(state));
});

test('action and canonical-byte history bounds fail explicitly without mutating prior state', () => {
  let state = createWatchRun({ limits: { maxActions: 1, maxBytes: 1_000_000, maxExpandEvents: 512 } });
  state = applyWatchAction(state, { type: 'pause' });
  mustThrowCode(() => applyWatchAction(state, { type: 'resume' }), 'HISTORY_ACTION_LIMIT');
  assert.equal(state.history.actions.length, 1);
  assert.equal(state.history.bytes, new TextEncoder().encode(canonicalWatchJson({ actions: state.history.actions, events: state.history.events })).length);

  const emptyHistoryBytes = new TextEncoder().encode(canonicalWatchJson({ actions: [], events: [] })).length;
  assert.throws(() => createWatchRun({ limits: { maxActions: 10, maxBytes: emptyHistoryBytes - 1, maxExpandEvents: 512 } }), /history|byte/i);
  const tinyHistory = createWatchRun({ limits: { maxActions: 10, maxBytes: emptyHistoryBytes + 1, maxExpandEvents: 512 } });
  mustThrowCode(() => applyWatchAction(tinyHistory, { type: 'pause' }), 'HISTORY_BYTE_LIMIT');
  assert.equal(tinyHistory.history.actions.length, 0);
  assert.equal(tinyHistory.history.bytes, emptyHistoryBytes);
});

test('safe-counter overflow and invalid rates are rejected instead of rounded', () => {
  const highRate = createWatchRun({ quartzHz: Number.MAX_SAFE_INTEGER });
  mustThrowCode(() => applyWatchAction(highRate, { type: 'advance', duration: rat(2) }), 'COUNTER_OVERFLOW');
  assert.throws(() => createWatchRun({ mechanicalHz: 0 }), /initial.*positive|positive.*initial/i);
  assert.throws(() => createWatchRun({ quartzHz: rat(1, 0) }), /denominator/i);
  assert.throws(() => createWatchRun({ dividerStages: 31 }), /dividerStages/i);
});

test('actions do not mutate frozen state or caller-owned action objects', () => {
  const state = createWatchRun();
  const action = { type: 'advance', duration: rat(1, 8) };
  const beforeState = canonicalWatchJson(state);
  const beforeAction = structuredClone(action);
  applyWatchAction(state, action);
  assert.equal(canonicalWatchJson(state), beforeState);
  assert.deepEqual(action, beforeAction);
  mustThrowCode(() => applyWatchAction(state, { type: 'unknown-action' }), 'UNKNOWN_ACTION');
  assert.equal(canonicalWatchJson(state), beforeState);
});

test('canonical JSON explicitly rejects undefined, non-finite, sparse, cyclic, and non-JSON values', () => {
  assert.throws(() => canonicalWatchJson({ value: undefined }), /undefined/i);
  assert.throws(() => canonicalWatchJson({ value: Infinity }), /finite/i);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalWatchJson(sparse), /sparse/i);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalWatchJson(cycle), /cycle/i);
  assert.throws(() => canonicalWatchJson({ value: 1n }), /non-JSON/i);
  assert.throws(() => normalizeRational({ numerator: 1, denominator: 2, extra: Infinity }), /finite/i);
  const accessorRational = { numerator: 1, get denominator() { return 2; } };
  assert.throws(() => normalizeRational(accessorRational), /data property|accessor/i);
  assert.throws(() => createWatchRun({ unexpected: undefined }), /undefined/i);
  const state = createWatchRun();
  assert.throws(() => applyWatchAction(state, { type: 'pause', unexpected: undefined }), /undefined/i);
});

test('reducer rejects forged state whose counters, cycles, rates, or retained ranges disagree', () => {
  const valid = applyWatchAction(createWatchRun(), { type: 'advance', duration: rat(1, 8) });
  const mismatchedCycles = structuredClone(valid);
  mismatchedCycles.cycles.quartzCycles = rat(4095);
  mustThrowCode(() => applyWatchAction(mismatchedCycles, { type: 'pause' }), 'INVALID_STATE');

  const omittedRange = structuredClone(valid);
  omittedRange.history.events = omittedRange.history.events.filter((entry) => entry.event !== 'quartzCycle');
  omittedRange.history.bytes = new TextEncoder().encode(canonicalWatchJson({ actions: omittedRange.history.actions, events: omittedRange.history.events })).length;
  mustThrowCode(() => applyWatchAction(omittedRange, { type: 'pause' }), 'INVALID_STATE');

  const negativeRate = structuredClone(valid);
  negativeRate.rates.mechanicalHz = rat(-1);
  mustThrowCode(() => applyWatchAction(negativeRate, { type: 'pause' }), 'INVALID_STATE');
});
