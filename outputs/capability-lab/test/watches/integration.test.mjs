import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWatchAction,
  canonicalWatchJson,
  componentDefinitions,
  componentSources,
  createWatchRun,
  describeWatchComponent,
  expandCounterRange,
  expandCounterWindow,
  expandWatchCounterWindow,
  replayWatchRun,
  watchGeometry,
  watchStateAt,
} from '../../src/watches/index.mjs';
import { mechanismSnapshot } from '../../src/watches/mechanisms.mjs';

const rational = (numerator, denominator = 1) => ({ numerator, denominator });
const fnv1a64 = (value) => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, '0');
};

function applyAll(config, actions) {
  return actions.reduce((state, action) => applyWatchAction(state, action), createWatchRun(config));
}

test('one shared rational clock reaches the declared 60-second ideal counts', () => {
  const state = applyWatchAction(createWatchRun(), {
    type: 'advance', duration: rational(60), origin: 'manual',
  });

  assert.deepEqual(state.time, rational(60));
  assert.equal(state.counters.mechanicalBeats, 480);
  assert.equal(state.counters.quartzCycles, 1_966_080);
  assert.equal(state.counters.motorCommands, 60);
  assert.equal(state.counters.softwareUpdates, 15_360);
  assert.equal(state.models.mechanical.counts.beats, 480);
  assert.equal(state.models.quartz.counts.referenceCycles, 1_966_080);
  assert.equal(state.models.quartz.counts.motorCommands, 60);
  assert.equal(state.models.software.counts.updates, 15_360);
  assert.equal(state.history.events.length < 40, true, 'high-rate quartz cycles must remain compact ranges');
});

test('changed rates alter event counts while the hand display follows its declared nominal ratio', () => {
  const state = applyAll({}, [
    { type: 'rate', model: 'mechanical', hz: 8 },
    { type: 'advance', duration: rational(1), origin: 'manual' },
  ]);

  assert.deepEqual(state.rates.mechanicalHz, rational(8));
  assert.equal(state.counters.mechanicalBeats, 16);
  assert.deepEqual(state.models.mechanical.handAnglesDegrees.second, 12);
  assert.deepEqual(state.models.mechanical.handAnglesDegrees.minute, 0.2);
  assert.equal(state.history.actions[0].type, 'rate');
});

test('a zero current rate stops one model while its timing path is unavailable', () => {
  const state = applyAll({}, [
    { type: 'rate', model: 'quartz', hz: 0 },
    { type: 'advance', duration: rational(1), origin: 'manual' },
  ]);

  assert.deepEqual(state.rates.quartzHz, rational(0));
  assert.equal(state.counters.quartzCycles, 0);
  assert.equal(state.counters.motorCommands, 0);
  assert.equal(state.models.quartz.frequencyHz.numerator, 0);
  assert.equal(state.models.quartz.timing.available, false);
  assert.equal(state.counters.mechanicalBeats, 8);
  assert.equal(state.counters.softwareUpdates, 256);
});

test('pause blocks autoplay, manual event stepping works, and reset retains an ordered session history', () => {
  const initial = createWatchRun();
  assert.equal(initial.paused, true);

  assert.throws(() => applyWatchAction(initial, {
    type: 'advance', duration: rational(2), origin: 'autoplay',
  }), /paused/i);
  const resumed = applyWatchAction(initial, { type: 'resume' });
  const hidden = applyWatchAction(resumed, { type: 'visibility', hidden: true });
  assert.throws(() => applyWatchAction(hidden, {
    type: 'advance', duration: rational(2), origin: 'autoplay',
  }), /hidden|visibility/i);

  const stepped = applyWatchAction(initial, { type: 'step', event: 'mechanicalBeat' });
  assert.deepEqual(stepped.time, rational(1, 8));
  assert.equal(stepped.counters.mechanicalBeats, 1);
  assert.equal(stepped.paused, true);

  const reset = applyWatchAction(stepped, { type: 'reset' });
  assert.deepEqual(reset.time, rational(0));
  assert.equal(reset.counters.mechanicalBeats, 0);
  assert.equal(reset.paused, true);
  assert.equal(reset.history.actions.length, stepped.history.actions.length + 1);
  assert.ok(reset.history.session > stepped.history.session);
});

test('energy interruptions stop only their powered model and preserve the other clocks', () => {
  const mainspringOff = applyAll({}, [
    { type: 'energy', source: 'mainspring', enabled: false },
    { type: 'advance', duration: rational(2), origin: 'manual' },
  ]);

  assert.deepEqual(mainspringOff.time, rational(2));
  assert.equal(mainspringOff.counters.mechanicalBeats, 0);
  assert.equal(mainspringOff.counters.quartzCycles, 65_536);
  assert.equal(mainspringOff.counters.motorCommands, 2);
  assert.equal(mainspringOff.counters.softwareUpdates, 512);
  assert.equal(mainspringOff.models.mechanical.energy.available, false);
  assert.equal(mainspringOff.models.quartz.energy.available, true);
  assert.deepEqual(mainspringOff.operatingTime.mechanical, rational(0));
  assert.deepEqual(mainspringOff.operatingTime.quartz, rational(2));
  assert.deepEqual(mainspringOff.operatingTime.software, rational(2));

  const batteryOff = applyAll({}, [
    { type: 'energy', source: 'battery', enabled: false },
    { type: 'advance', duration: rational(2), origin: 'manual' },
  ]);
  assert.equal(batteryOff.counters.mechanicalBeats, 16);
  assert.equal(batteryOff.counters.quartzCycles, 0);
  assert.equal(batteryOff.counters.motorCommands, 0);
  assert.equal(batteryOff.counters.softwareUpdates, 512);
  assert.equal(batteryOff.models.mechanical.energy.available, true);
  assert.equal(batteryOff.models.quartz.energy.available, false);
  assert.deepEqual(batteryOff.operatingTime.mechanical, rational(2));
  assert.deepEqual(batteryOff.operatingTime.quartz, rational(0));
  assert.deepEqual(batteryOff.operatingTime.software, rational(2));
});

test('replay reconstructs complete state and compact events, and changed actions change canonical evidence', () => {
  const config = { mechanicalHz: 6 };
  const actions = [
    { type: 'resume' },
    { type: 'advance', duration: rational(3, 2), origin: 'autoplay' },
    { type: 'pause' },
    { type: 'step', event: 'softwareUpdate' },
  ];
  const original = applyAll(config, actions);
  const replay = replayWatchRun(config, actions);

  assert.deepEqual(replay.state, original);
  assert.equal(replay.canonicalState, canonicalWatchJson(original));
  assert.equal(replay.canonicalEvents, canonicalWatchJson(original.history.events));

  const changed = replayWatchRun(config, [...actions.slice(0, -1), { type: 'step', event: 'mechanicalBeat' }]);
  assert.notEqual(changed.canonicalState, replay.canonicalState);
  assert.notEqual(changed.canonicalEvents, replay.canonicalEvents);
});

test('replay canonicalizes omitted advance origin and equivalent duration rationals in the trace', () => {
  const nonreducedConfig = { mechanicalHz: rational(8, 2) };
  const withDefaultOrigin = applyWatchAction(createWatchRun(nonreducedConfig), {
    type: 'advance', duration: rational(2, 4),
  });
  const replayedDefault = replayWatchRun(withDefaultOrigin.config, withDefaultOrigin.history.actions);
  assert.equal(replayedDefault.canonicalState, canonicalWatchJson(withDefaultOrigin));
  assert.equal(replayedDefault.canonicalEvents, canonicalWatchJson(withDefaultOrigin.history.events));
});

test('replay canonicalizes equivalent rate rationals in the trace', () => {
  const withEquivalentRate = applyWatchAction(createWatchRun(), {
    type: 'rate', model: 'mechanical', hz: rational(8, 2),
  });
  const replayedRate = replayWatchRun(withEquivalentRate.config, withEquivalentRate.history.actions);
  assert.equal(replayedRate.canonicalState, canonicalWatchJson(withEquivalentRate));
  assert.equal(replayedRate.canonicalEvents, canonicalWatchJson(withEquivalentRate.history.events));
});

test('watchStateAt uses the same exact transport and a bounded range can be expanded on demand', () => {
  const state = watchStateAt({}, rational(60));
  assert.deepEqual(state.time, rational(60));
  assert.equal(state.counters.quartzCycles, 1_966_080);
  const replay = replayWatchRun(state.config, state.history.actions);
  assert.equal(replay.canonicalState, canonicalWatchJson(state), 'a sampled run must replay through the same create/action wrapper path');
  const batteryOff = watchStateAt({}, rational(1), { battery: false });
  assert.equal(batteryOff.counters.mechanicalBeats, 8);
  assert.equal(batteryOff.counters.quartzCycles, 0);
  assert.equal(batteryOff.counters.softwareUpdates, 256);

  const quartzRange = state.history.events.find(range => range.event === 'quartzCycle');
  assert.ok(quartzRange, 'the quartz counter should be represented by an exact compact range');
  const window = expandWatchCounterWindow(state, quartzRange, { offset: 0, count: 4 });
  const expanded = window.events;
  assert.equal(window.total, 1_966_080);
  assert.equal(window.clippedAfter, true);
  assert.equal(expanded.length, 4);
  assert.equal(expanded[0].index, quartzRange.start);
  assert.deepEqual(expanded[0].time, quartzRange.timeStart);
  assert.throws(() => expandCounterRange(quartzRange, 4), /limit|maximum|exceed/i);
  assert.throws(() => expandWatchCounterWindow(state, { ...quartzRange, end: quartzRange.end - 1 }, { offset: 0, count: 1 }), /not retained/i);

  const limited = watchStateAt({ limits: { maxActions: 2_000, maxBytes: 1_048_576, maxExpandEvents: 2 } }, rational(60));
  const limitedRange = limited.history.events.find(range => range.event === 'quartzCycle');
  assert.equal(expandWatchCounterWindow(limited, limitedRange, { offset: 0, count: 2 }).events.length, 2);
  assert.throws(() => expandWatchCounterWindow(limited, limitedRange, { offset: 0, count: 3 }), /limit|maximum/i);
});

test('component explanations bind source, role, classification, and value to the actual three-model state', () => {
  const state = applyWatchAction(createWatchRun(), {
    type: 'advance', duration: rational(1), origin: 'manual',
  });
  const definitions = componentDefinitions();
  assert.ok(definitions.some(item => item.id === 'mechanical.balanceWheel'));
  assert.ok(definitions.some(item => item.id.startsWith('quartz.')));
  assert.ok(definitions.some(item => item.id.startsWith('software.')));
  assert.ok(componentSources().length >= 2);

  for (const definition of definitions) {
    const claim = describeWatchComponent(state, definition.id);
    assert.ok(claim.source.url.startsWith('https://'));
    assert.ok(['energy', 'timing', 'display', 'control', 'support'].includes(claim.role));
    assert.ok(['fact', 'derived', 'simulation', 'illustrative'].includes(claim.roleStatus));
    assert.ok(['fact', 'derived', 'simulation', 'illustrative'].includes(claim.valueStatus));
    assert.notEqual(claim.value, undefined, `${definition.id} should resolve a live value or explicit 'not modeled'`);
  }

  assert.deepEqual(describeWatchComponent(state, 'quartz.crystal').value, rational(32_768));
  assert.equal(describeWatchComponent(state, 'mechanical.secondHand').value, 6);
  assert.equal(describeWatchComponent(state, 'software.updateCounter').value, 256);
});

test('geometry changes only the view and component selection remains state-independent', () => {
  const state = applyWatchAction(createWatchRun(), {
    type: 'advance', duration: rational(1), origin: 'manual',
  });
  const canonicalBefore = canonicalWatchJson(state);
  const assembled = watchGeometry(state, 0, null);
  const exploded = watchGeometry(state, 1, 'mechanical.escapeWheel');

  assert.notDeepEqual(exploded, assembled);
  const findPart = (geometry, id) => geometry.watches.flatMap(watch => watch.parts).find(part => part.id === id);
  assert.equal(findPart(exploded, 'mechanical.escapeWheel').selected, true);
  assert.equal(findPart(assembled, 'mechanical.escapeWheel').selected, false);
  assert.notDeepEqual(findPart(exploded, 'mechanical.escapeWheel').transform, findPart(assembled, 'mechanical.escapeWheel').transform);
  assert.deepEqual(canonicalWatchJson(state), canonicalBefore);
});

test('wrapper trace records real transport and mechanism calculation results with a small fixed bound', () => {
  const state = applyWatchAction(createWatchRun(), {
    type: 'advance', duration: rational(1), origin: 'manual',
  });

  assert.deepEqual(state.calculationTrace.calls.map(call => call.id), [
    'src/watches/transport.mjs#applyWatchAction',
    'src/watches/mechanisms.mjs#mechanismSnapshot',
  ]);
  assert.equal(state.calculationTrace.calls[0].input.action.type, 'advance');
  const tracedResult = state.calculationTrace.calls[1].result;
  const actualResult = mechanismSnapshot(state.config, state);
  const canonicalResult = canonicalWatchJson(actualResult);
  assert.equal(tracedResult.canonicalHash, fnv1a64(canonicalResult));
  assert.equal(tracedResult.canonicalBytes, new TextEncoder().encode(canonicalResult).length);
  assert.equal(tracedResult.summary.mechanical.counts.beats, 8);
  assert.equal(tracedResult.summary.quartz.counts.referenceCycles, 32_768);
  assert.equal(tracedResult.summary.mechanical.handAnglesDegrees.second, 6);
  assert.ok(state.calculationTrace.bytes <= 8_192);
});
