import test from 'node:test';
import assert from 'node:assert/strict';
import { componentDefinitions, componentSources, describeWatchComponent } from '../../src/watches/components.mjs';
import { externalGearPair, handAnglesAt, mechanismSnapshot, teachingHandTrain } from '../../src/watches/mechanisms.mjs';
import { applyWatchAction, createWatchRun } from '../../src/watches/index.mjs';

const runState = () => ({ models: {
  mechanical: {
    energy: { available: true }, counts: { beats: 480 },
    escapement: { eventIndex: 480, phase: 'lock', phaseWithinBeat: { numerator: 0, denominator: 1 }, modelKind: 'illustrative-schematic' },
    oscillator: { cycles: { numerator: 240, denominator: 1 }, phase: { numerator: 0, denominator: 1 } },
    gearTrain: { handTurns: { second: { numerator: 1, denominator: 1 }, minute: { numerator: 1, denominator: 60 }, hour: { numerator: 1, denominator: 720 } }, gearPairs: { secondToMinute: [{ driverTurns: { numerator: 1, denominator: 1 } }, { driverTurns: { numerator: -1, denominator: 6 } }], minuteToHour: [{ driverTurns: { numerator: 1, denominator: 60 } }, { driverTurns: { numerator: -1, denominator: 180 } }] }, handAnglesDegrees: { second: 0, minute: 0, hour: 0 } },
    handAnglesDegrees: { second: 0, minute: 0, hour: 0 }
  },
  quartz: {
    energy: { available: true }, counts: { referenceCycles: { numerator: 1_966_080, denominator: 1 }, motorCommands: 60 },
    oscillator: { cycles: { numerator: 1_966_080, denominator: 1 }, phase: { numerator: 0, denominator: 1 } },
    dividerStages: [{ stage: 15, divisor: 2, outputCount: { numerator: 60, denominator: 1 } }],
    gearTrain: { handTurns: { second: { numerator: 1, denominator: 1 }, minute: { numerator: 1, denominator: 60 }, hour: { numerator: 1, denominator: 720 } }, gearPairs: { secondToMinute: [{ driverTurns: { numerator: 1, denominator: 1 } }, { driverTurns: { numerator: -1, denominator: 6 } }], minuteToHour: [{ driverTurns: { numerator: 1, denominator: 60 } }, { driverTurns: { numerator: -1, denominator: 180 } }] }, handAnglesDegrees: { second: 0, minute: 0, hour: 0 } },
    handAnglesDegrees: { second: 0, minute: 0, hour: 0 }
  },
  software: {
    operatingTime: { numerator: 60, denominator: 1 },
    counts: { updates: 15_360 },
    handAnglesDegrees: { second: 0, minute: 0, hour: 0 }
  }
} });

test('stable mechanical and quartz IDs cover every requested schematic part', () => {
  const ids = componentDefinitions().map(component => component.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of [
    'mechanical.crown', 'mechanical.barrel', 'mechanical.mainspring', 'mechanical.goingTrain',
    'mechanical.escapeWheel', 'mechanical.palletFork', 'mechanical.balanceWheel', 'mechanical.hairspring',
    'mechanical.support', 'mechanical.secondHand', 'mechanical.minuteHand', 'mechanical.hourHand',
    'quartz.battery', 'quartz.crystal', 'quartz.oscillator', 'quartz.divider', 'quartz.motorDriver',
    'quartz.coil', 'quartz.rotor', 'quartz.gears', 'quartz.secondHand', 'quartz.minuteHand', 'quartz.hourHand',
    'software.logicalTime', 'software.scheduler', 'software.updateCounter', 'software.renderer',
    'software.secondHand', 'software.minuteHand', 'software.hourHand'
  ]) assert.ok(ids.includes(id), `missing stable ID ${id}`);
});

test('component descriptions read actual state values and respond to changed run state', () => {
  const before = runState(), after = runState();
  after.models.mechanical.counts.beats = 488;
  after.models.mechanical.escapement.eventIndex = 488;
  after.models.mechanical.handAnglesDegrees.second = 6;
  after.models.mechanical.gearTrain.handTurns.second.numerator = 11;
  after.models.mechanical.gearTrain.handTurns.second.denominator = 10;
  after.models.mechanical.gearTrain.handAnglesDegrees.second = 6;
  after.models.quartz.counts.motorCommands = 61;
  after.models.quartz.handAnglesDegrees.second = 6;
  after.models.quartz.gearTrain.handTurns.second.numerator = 11;
  after.models.quartz.gearTrain.handTurns.second.denominator = 10;
  after.models.quartz.gearTrain.handAnglesDegrees.second = 6;
  after.models.software.counts.updates = 15_616;
  after.models.software.handAnglesDegrees.second = 6;
  assert.deepEqual(describeWatchComponent(before, 'mechanical.goingTrain').value.handTurns.second, { numerator: 1, denominator: 1 });
  assert.deepEqual(describeWatchComponent(after, 'mechanical.goingTrain').value.handTurns.second, { numerator: 11, denominator: 10 });
  assert.equal(describeWatchComponent(before, 'mechanical.secondHand').value, 0);
  assert.equal(describeWatchComponent(after, 'mechanical.secondHand').value, 6);
  assert.equal(describeWatchComponent(before, 'quartz.rotor').value, 60);
  assert.equal(describeWatchComponent(after, 'quartz.rotor').value, 61);
  assert.deepEqual(describeWatchComponent(after, 'quartz.gears').value.handTurns.second, { numerator: 11, denominator: 10 });
  assert.equal(describeWatchComponent(after, 'quartz.secondHand').value, 6);
  assert.equal(describeWatchComponent(before, 'software.updateCounter').value, 15_360);
  assert.equal(describeWatchComponent(after, 'software.updateCounter').value, 15_616);
  assert.deepEqual(describeWatchComponent(after, 'software.logicalTime').value, { numerator: 60, denominator: 1 });
  assert.equal(describeWatchComponent(after, 'software.secondHand').value, 6);
  assert.equal(describeWatchComponent(after, 'software.scheduler').value, 'not modeled');
});

test('energy and timing labels have separate source roles and modeled values', () => {
  const state = runState();
  const battery = describeWatchComponent(state, 'quartz.battery');
  const crystal = describeWatchComponent(state, 'quartz.crystal');
  const spring = describeWatchComponent(state, 'mechanical.mainspring');
  assert.equal(battery.role, 'energy');
  assert.equal(battery.value, true);
  assert.equal(crystal.role, 'timing');
  assert.deepEqual(crystal.value, { numerator: 1_966_080, denominator: 1 });
  assert.equal(crystal.valueStatus, 'simulation');
  assert.equal(spring.role, 'energy');
  assert.equal(spring.value, true);
  assert.notEqual(crystal.role, battery.role, 'the quartz crystal is a timing reference, not the motor energy source');
});

test('illustrative parts disclose missing physical state; missing paths and IDs fail clearly', () => {
  assert.equal(describeWatchComponent({}, 'mechanical.crown').value, 'not modeled');
  assert.equal(describeWatchComponent({}, 'mechanical.support').value, 'not modeled');
  assert.throws(() => describeWatchComponent({ models: { mechanical: {} } }, 'mechanical.secondHand'), /missing models\.mechanical\.handAnglesDegrees\.second/);
  assert.throws(() => describeWatchComponent(runState(), 'mechanical.unlistedPart'), /unknown watch component/);
});

test('source-linked definitions and returned values are copies, not mutable shared state', () => {
  const state = runState(), before = structuredClone(state), defs = componentDefinitions(), sources = componentSources();
  defs[0].name = 'mutated'; sources[0].supports = 'mutated';
  const described = describeWatchComponent(state, 'quartz.divider');
  described.value[0].outputCount = -1;
  const goingTrain = describeWatchComponent(state, 'mechanical.goingTrain');
  goingTrain.value.handTurns.second.numerator = -99;
  goingTrain.value.gearPairs.secondToMinute[0].driverTurns.numerator = -99;
  assert.deepEqual(state, before);
  assert.notEqual(componentDefinitions()[0].name, 'mutated');
  assert.notEqual(componentSources()[0].supports, 'mutated');
  for (const definition of componentDefinitions()) {
    const claim = describeWatchComponent(state, definition.id);
    assert.equal(claim.source.id, definition.sourceId, `${definition.id} returns its declared source`);
    assert.ok(claim.source.url.startsWith('https://'), `${definition.id} source is a URL`);
    assert.notEqual(claim.value, undefined, `${definition.id} resolves state or an explicit illustrative value`);
  }
  assert.deepEqual(describeWatchComponent(state, 'quartz.divider').value[0].outputCount, { numerator: 60, denominator: 1 });
  assert.deepEqual(describeWatchComponent(state, 'mechanical.goingTrain').value.handTurns.second, { numerator: 1, denominator: 1 });
  assert.ok(componentSources().every(source => source.url.startsWith('https://')));
});

test('labels resolve from full, wrapped, or bare model state without changing paths', () => {
  const full = runState(), hand = describeWatchComponent(full, 'mechanical.secondHand');
  assert.equal(describeWatchComponent({ run: full }, 'mechanical.secondHand').value, hand.value);
  assert.equal(describeWatchComponent(full.models, 'mechanical.secondHand').value, hand.value);
});

function exactSnapshot(seconds, denominator = 1, { rates, mainspring = true, battery = true } = {}) {
  const time = { numerator: seconds, denominator };
  const mechanicalBeats = { numerator: seconds * 8, denominator };
  const quartzCycles = { numerator: seconds * 32_768, denominator };
  const beats = Math.floor(mechanicalBeats.numerator / denominator);
  const quartzCount = Math.floor(quartzCycles.numerator / denominator);
  const commands = Math.floor(quartzCycles.numerator / (denominator * 32_768));
  const snapshot = {
    time,
    operatingTime: { mechanical: time, quartz: time },
    displayTime: {
      mechanical: { numerator: beats, denominator: 8 },
      quartz: { numerator: commands, denominator: 1 },
      software: time,
    },
    cycles: { mechanicalBeats, quartzCycles },
    counters: { mechanicalBeats: beats, quartzCycles: quartzCount, motorCommands: commands },
    energy: { mainspring, battery },
  };
  if (rates) snapshot.rates = rates;
  return snapshot;
}

test('independent default-rate boundaries match exact counts at 60 seconds and 24 hours', () => {
  const atMinute = mechanismSnapshot({}, exactSnapshot(60));
  assert.equal(atMinute.mechanical.counts.beats, 480);
  assert.equal(atMinute.mechanical.counts.fullOscillations, 240);
  assert.equal(atMinute.quartz.counts.referenceCycles, 1_966_080);
  assert.equal(atMinute.quartz.counts.motorCommands, 60);
  assert.deepEqual(atMinute.mechanical.handAnglesDegrees, { second: 0, minute: 6, hour: 0.5 });

  const atDay = mechanismSnapshot({}, exactSnapshot(86_400));
  assert.equal(atDay.mechanical.counts.beats, 691_200);
  assert.equal(atDay.mechanical.counts.fullOscillations, 345_600);
  assert.equal(atDay.quartz.counts.referenceCycles, 2_831_155_200);
  assert.equal(atDay.quartz.counts.motorCommands, 86_400);
  assert.deepEqual(atDay.mechanical.handAnglesDegrees, { second: 0, minute: 0, hour: 0 });
});

test('rational subsecond boundaries preserve oscillator and divider phases', () => {
  const eighth = mechanismSnapshot({}, exactSnapshot(1, 8));
  assert.equal(eighth.mechanical.counts.beats, 1);
  assert.deepEqual(eighth.mechanical.escapement.phaseWithinBeat, { numerator: 0, denominator: 1 });
  assert.equal(eighth.quartz.counts.referenceCycles, 4_096);
  assert.equal(eighth.quartz.counts.motorCommands, 0);
  assert.equal(eighth.quartz.dividerStages.at(-1).outputCount, 0);

  const quartzCycle = mechanismSnapshot({}, exactSnapshot(1, 32_768));
  assert.equal(quartzCycle.quartz.counts.referenceCycles, 1);
  assert.deepEqual(quartzCycle.quartz.oscillator.phase, { numerator: 0, denominator: 1 });
  assert.equal(quartzCycle.quartz.counts.motorCommands, 0);
  assert.deepEqual(quartzCycle.mechanical.escapement.phaseWithinBeat, { numerator: 1, denominator: 4_096 });
  assert.equal(quartzCycle.mechanical.escapement.phase, 'lock');
});

test('external gear meshes reverse direction and two teaching meshes restore it', () => {
  const mesh = externalGearPair({ driverTurns: { numerator: 1, denominator: 1 }, driverTeeth: 20, drivenTeeth: 40 });
  assert.deepEqual(mesh.drivenTurns, { numerator: -1, denominator: 2 });
  assert.equal(mesh.direction, 'opposite');
  const train = teachingHandTrain({ displayTime: { numerator: 3_600, denominator: 1 } });
  assert.deepEqual(train.handTurns, {
    second: { numerator: 60, denominator: 1 },
    minute: { numerator: 1, denominator: 1 },
    hour: { numerator: 1, denominator: 12 },
  });
  assert.equal(train.gearPairs.secondToMinute[0].direction, 'opposite');
  assert.equal(train.gearPairs.secondToMinute[1].direction, 'opposite');
  assert.deepEqual(handAnglesAt({ displayTime: { numerator: 43_200, denominator: 1 } }), { second: 0, minute: 0, hour: 0 });
  assert.deepEqual(teachingHandTrain({ displayTime: { numerator: 43_200, denominator: 1 } }).handTurns.hour, { numerator: 1, denominator: 1 });
});

test('changed live rates do not rewrite accumulated totals, nominal display, or bound labels', () => {
  const baseline = mechanismSnapshot({}, exactSnapshot(60));
  const changed = mechanismSnapshot({}, exactSnapshot(60, 1, { rates: { mechanicalHz: 3, quartzHz: 30_000 } }));
  assert.deepEqual(changed.mechanical.counts, baseline.mechanical.counts);
  assert.deepEqual(changed.quartz.counts, baseline.quartz.counts);
  assert.deepEqual(changed.mechanical.displayTime, baseline.mechanical.displayTime);
  assert.deepEqual(changed.quartz.displayTime, baseline.quartz.displayTime);
  assert.deepEqual(changed.mechanical.frequencyHz, { numerator: 3, denominator: 1 });
  assert.deepEqual(changed.mechanical.nominalFrequencyHz, { numerator: 4, denominator: 1 });
  assert.deepEqual(changed.quartz.frequencyHz, { numerator: 30_000, denominator: 1 });
  assert.deepEqual(changed.quartz.nominalFrequencyHz, { numerator: 32_768, denominator: 1 });
  const baseState = { models: baseline };
  const changedState = { models: changed };
  assert.equal(describeWatchComponent(baseState, 'mechanical.secondHand').value, 0);
  assert.equal(describeWatchComponent(changedState, 'quartz.rotor').value, 60);
  assert.deepEqual(describeWatchComponent(changedState, 'quartz.gears').value, changed.quartz.gearTrain);
  assert.deepEqual(describeWatchComponent(changedState, 'mechanical.goingTrain').value, changed.mechanical.gearTrain);
});

test('halted mechanism output preserves supplied operating phase and display time', () => {
  const halted = exactSnapshot(60, 1, { mainspring: false, battery: false });
  halted.time = { numerator: 62, denominator: 1 };
  const output = mechanismSnapshot({}, halted);
  assert.equal(output.mechanical.energy.available, false);
  assert.equal(output.quartz.energy.available, false);
  assert.deepEqual(output.mechanical.operatingTime, { numerator: 60, denominator: 1 });
  assert.deepEqual(output.quartz.operatingTime, { numerator: 60, denominator: 1 });
  assert.deepEqual(output.mechanical.displayTime, { numerator: 60, denominator: 1 });
  assert.deepEqual(output.quartz.displayTime, { numerator: 60, denominator: 1 });
  assert.equal(describeWatchComponent({ models: output }, 'quartz.secondHand').value, 0);
  assert.deepEqual(describeWatchComponent({ models: output }, 'quartz.crystal').value, { numerator: 1_966_080, denominator: 1 });
});

test('real transport energy interruption holds quartz phase while shared time continues', () => {
  let state = applyWatchAction(createWatchRun(), { type: 'advance', duration: { numerator: 1, denominator: 1 }, origin: 'manual' });
  const prior = {
    cycles: state.cycles.quartzCycles,
    operating: state.operatingTime.quartz,
    display: state.displayTime.quartz,
    hand: describeWatchComponent(state, 'quartz.secondHand').value,
  };
  state = applyWatchAction(state, { type: 'energy', source: 'battery', enabled: false });
  state = applyWatchAction(state, { type: 'advance', duration: { numerator: 2, denominator: 1 }, origin: 'manual' });
  assert.deepEqual(state.cycles.quartzCycles, prior.cycles);
  assert.deepEqual(state.operatingTime.quartz, prior.operating);
  assert.deepEqual(state.displayTime.quartz, prior.display);
  assert.equal(describeWatchComponent(state, 'quartz.secondHand').value, prior.hand);
  assert.deepEqual(state.time, { numerator: 3, denominator: 1 });
  assert.equal(state.models.quartz.energy.available, false);
});

test('zero live rates stop timing without changing powered totals or nominal hand position', () => {
  const baseline = mechanismSnapshot({}, exactSnapshot(60));
  const stopped = mechanismSnapshot({}, exactSnapshot(60, 1, {
    rates: { mechanicalHz: 0, quartzHz: 0 },
  }));
  assert.equal(stopped.mechanical.energy.available, true);
  assert.equal(stopped.quartz.energy.available, true);
  assert.equal(stopped.mechanical.timing.available, false);
  assert.equal(stopped.quartz.timing.available, false);
  assert.deepEqual(stopped.mechanical.counts, baseline.mechanical.counts);
  assert.deepEqual(stopped.quartz.counts, baseline.quartz.counts);
  assert.deepEqual(stopped.mechanical.handAnglesDegrees, baseline.mechanical.handAnglesDegrees);
  assert.deepEqual(stopped.quartz.handAnglesDegrees, baseline.quartz.handAnglesDegrees);
  assert.deepEqual(stopped.mechanical.frequencyHz, { numerator: 0, denominator: 1 });
  assert.deepEqual(stopped.mechanical.nominalFrequencyHz, { numerator: 4, denominator: 1 });
  assert.deepEqual(stopped.quartz.frequencyHz, { numerator: 0, denominator: 1 });
  assert.deepEqual(stopped.quartz.nominalFrequencyHz, { numerator: 32_768, denominator: 1 });
});
