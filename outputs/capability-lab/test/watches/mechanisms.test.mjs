import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilities,
  externalGearPair,
  handAnglesAt,
  mechanismSnapshot,
  teachingHandTrain,
} from '../../src/watches/mechanisms.mjs';
import { createRegistry } from '../../src/runtime/index.mjs';

const r = (numerator, denominator = 1) => ({ numerator, denominator });

function snapshot({
  time = r(0),
  mechanicalBeats = r(0),
  quartzCycles = r(0),
  motorCommands = 0,
  mechanicalOperatingTime = r(0),
  quartzOperatingTime = r(0),
  mechanicalDisplayTime = r(0),
  quartzDisplayTime = r(0),
  mainspring = true,
  battery = true,
  rates,
} = {}) {
  return {
    time,
    operatingTime: { mechanical: mechanicalOperatingTime, quartz: quartzOperatingTime },
    displayTime: { mechanical: mechanicalDisplayTime, quartz: quartzDisplayTime, software: r(0) },
    cycles: { mechanicalBeats, quartzCycles },
    counters: {
      mechanicalBeats: Math.floor(mechanicalBeats.numerator / mechanicalBeats.denominator),
      quartzCycles: Math.floor(quartzCycles.numerator / quartzCycles.denominator),
      motorCommands,
    },
    energy: { mainspring, battery },
    ...(rates ? { rates } : {}),
  };
}

test('default 60-second snapshot uses exact independent counts and hand periods', () => {
  const result = mechanismSnapshot({}, snapshot({
    time: r(60),
    mechanicalBeats: r(480),
    quartzCycles: r(1_966_080),
    motorCommands: 60,
    mechanicalOperatingTime: r(60), quartzOperatingTime: r(60),
    mechanicalDisplayTime: r(60), quartzDisplayTime: r(60),
  }));

  assert.deepEqual(result.mechanical.counts, { beats: 480, fullOscillations: 240 });
  assert.deepEqual(result.mechanical.oscillator, { cycles: r(240), phase: r(0) });
  assert.deepEqual(result.quartz.counts, { referenceCycles: 1_966_080, motorCommands: 60 });
  assert.deepEqual(result.quartz.dividerStages[0], { stage: 1, divisor: 2, outputCount: 983_040 });
  assert.deepEqual(result.quartz.dividerStages[14], { stage: 15, divisor: 2, outputCount: 60 });
  assert.deepEqual(result.mechanical.handAnglesDegrees, { second: 0, minute: 6, hour: 0.5 });
  assert.deepEqual(result.quartz.handAnglesDegrees, result.mechanical.handAnglesDegrees);
});

test('24-hour independent fixture completes full hand revolutions with exact totals', () => {
  const result = mechanismSnapshot({}, snapshot({
    time: r(86_400), mechanicalBeats: r(691_200), quartzCycles: r(2_831_155_200), motorCommands: 86_400,
    mechanicalOperatingTime: r(86_400), quartzOperatingTime: r(86_400),
    mechanicalDisplayTime: r(86_400), quartzDisplayTime: r(86_400),
  }));
  assert.deepEqual(result.mechanical.counts, { beats: 691_200, fullOscillations: 345_600 });
  assert.equal(result.quartz.counts.referenceCycles, 2_831_155_200);
  assert.equal(result.quartz.dividerStages[14].outputCount, 86_400);
  assert.deepEqual(result.mechanical.handAnglesDegrees, { second: 0, minute: 0, hour: 0 });
});

test('rational event boundaries retain fractional oscillator and escapement phase', () => {
  const result = mechanismSnapshot({}, snapshot({
    time: r(1, 8), mechanicalBeats: r(1), quartzCycles: r(4096),
    mechanicalOperatingTime: r(1, 8), quartzOperatingTime: r(1, 8),
    mechanicalDisplayTime: r(1, 8), quartzDisplayTime: r(0),
  }));

  assert.equal(result.mechanical.counts.beats, 1);
  assert.deepEqual(result.mechanical.oscillator, { cycles: r(1, 2), phase: r(1, 2) });
  assert.equal(result.mechanical.escapement.eventIndex, 1);
  assert.equal(result.mechanical.escapement.phase, 'lock');
  assert.deepEqual(result.mechanical.escapement.phaseWithinBeat, r(0));
  assert.equal(result.quartz.counts.referenceCycles, 4096);
  assert.equal(result.quartz.dividerStages[14].outputCount, 0);
});

test('first quartz cycle boundary is exact without producing a motor command', () => {
  const result = mechanismSnapshot({}, snapshot({
    time: r(1, 32_768), quartzCycles: r(1), quartzOperatingTime: r(1, 32_768),
  }));
  assert.equal(result.quartz.counts.referenceCycles, 1);
  assert.equal(result.quartz.counts.motorCommands, 0);
  assert.deepEqual(result.quartz.oscillator, { cycles: r(1), phase: r(0) });
  assert.equal(result.quartz.dividerStages[14].outputCount, 0);
});

test('escapement phase uses an explicit illustrative within-beat sequence', () => {
  const phases = [
    [r(1, 4), 'lock'], [r(1, 2), 'release'], [r(3, 4), 'impulse'], [r(1), 'lock'],
  ];
  for (const [beats, expected] of phases) {
    const completedBeats = Math.floor(beats.numerator / beats.denominator);
    const result = mechanismSnapshot({}, snapshot({ mechanicalBeats: beats, mechanicalDisplayTime: r(completedBeats, 8) }));
    assert.equal(result.mechanical.escapement.phase, expected);
    assert.equal(result.mechanical.escapement.modelKind, 'illustrative-schematic');
  }
});

test('energy loss retains supplied operating phase while reporting unavailable paths', () => {
  const input = snapshot({
    time: r(10), mechanicalBeats: r(17), quartzCycles: r(32_768), motorCommands: 1,
    mechanicalOperatingTime: r(17, 8), quartzOperatingTime: r(1),
    mechanicalDisplayTime: r(17, 8), quartzDisplayTime: r(1),
    mainspring: false, battery: false,
  });
  const result = mechanismSnapshot({}, input);
  assert.deepEqual(result.mechanical.operatingTime, r(17, 8));
  assert.deepEqual(result.quartz.operatingTime, r(1));
  assert.deepEqual(result.mechanical.counts, { beats: 17, fullOscillations: 8 });
  assert.equal(result.mechanical.energy.available, false);
  assert.equal(result.mechanical.timing.available, false);
  assert.equal(result.quartz.energy.available, false);
  assert.equal(result.quartz.timing.available, false);
});

test('current rate is reported separately from nominal gearing and never rebuilds accrued totals', () => {
  const input = snapshot({
    time: r(10), mechanicalBeats: r(17), quartzCycles: r(57_768), motorCommands: 1,
    mechanicalOperatingTime: r(17, 8), quartzOperatingTime: r(1),
    mechanicalDisplayTime: r(17, 8), quartzDisplayTime: r(1),
    rates: { mechanicalHz: r(5), quartzHz: r(65_536) },
  });
  const result = mechanismSnapshot({ mechanicalHz: r(4), quartzHz: r(32_768) }, input);

  assert.deepEqual(result.mechanical.frequencyHz, r(5));
  assert.deepEqual(result.mechanical.nominalFrequencyHz, r(4));
  assert.deepEqual(result.mechanical.counts, { beats: 17, fullOscillations: 8 });
  assert.deepEqual(result.quartz.frequencyHz, r(65_536));
  assert.deepEqual(result.quartz.nominalFrequencyHz, r(32_768));
  assert.equal(result.quartz.counts.referenceCycles, 57_768);
  assert.equal(result.quartz.counts.motorCommands, 1);
  assert.deepEqual(result.mechanical.handAnglesDegrees, { second: 12.75, minute: 0.2125, hour: 17 / 960 });
});

test('external gear pairs use reduced exact signed turns and opposite direction', () => {
  assert.deepEqual(externalGearPair({
    driverTurns: r(20), driverTeeth: 40, drivenTeeth: 60,
  }), {
    driverTurns: r(20), drivenTurns: r(-40, 3), teethRatio: r(2, 3), driverTeeth: 40, drivenTeeth: 60, direction: 'opposite',
  });
  assert.deepEqual(externalGearPair({
    driverTurns: r(-3, 2), driverTeeth: 12, drivenTeeth: 8,
  }), {
    driverTurns: r(-3, 2), drivenTurns: r(9, 4), teethRatio: r(3, 2), driverTeeth: 12, drivenTeeth: 8, direction: 'opposite',
  });
  assert.deepEqual(externalGearPair({
    driverTurns: r(0), driverTeeth: 8, drivenTeeth: 15,
  }).drivenTurns, r(0));
});

test('hand period helper exposes second/minute/hour ratios and exact modular angles', () => {
  assert.deepEqual(handAnglesAt({ displayTime: r(60) }), { second: 0, minute: 6, hour: 0.5 });
  assert.deepEqual(handAnglesAt({ displayTime: r(3600) }), { second: 0, minute: 0, hour: 30 });
  assert.deepEqual(handAnglesAt({ displayTime: r(43_200) }), { second: 0, minute: 0, hour: 0 });
  const angles = handAnglesAt({ displayTime: r(1, 120) });
  assert.ok(Math.abs(angles.second - 0.05) < 1e-15);
  assert.ok(Math.abs(angles.minute - 1 / 1200) < 1e-15);
  assert.ok(Math.abs(angles.hour - 1 / 14400) < 1e-15);
});

test('composed external-mesh train derives minute/hour ratios and hands from display time', () => {
  const result = teachingHandTrain({ displayTime: r(60) });
  assert.deepEqual(result.handTurns, { second: r(1), minute: r(1, 60), hour: r(1, 720) });
  assert.equal(result.gearPairs.secondToMinute.length, 2);
  assert.equal(result.gearPairs.minuteToHour.length, 2);
  assert.deepEqual(result.gearPairs.secondToMinute.map(pair => pair.direction), ['opposite', 'opposite']);
  assert.deepEqual(result.handAnglesDegrees, { second: 0, minute: 6, hour: 0.5 });
});

test('input validation rejects inconsistent, degenerate, unsafe, and mutable malformed values', () => {
  const inconsistent = snapshot({ mechanicalBeats: r(3, 2) });
  inconsistent.counters.mechanicalBeats = 2;
  assert.throws(() => mechanismSnapshot({}, inconsistent), /counter|floor|match/i);
  assert.throws(() => mechanismSnapshot({}, snapshot({ rates: { mechanicalHz: -1, quartzHz: r(32_768) } })), /positive|nonnegative|rate/i);
  assert.throws(() => externalGearPair({ driverTurns: r(1), driverTeeth: 0, drivenTeeth: 2 }), /teeth/i);
  assert.throws(() => externalGearPair({ driverTurns: r(1, 0), driverTeeth: 1, drivenTeeth: 2 }), /denominator/i);
  assert.throws(() => mechanismSnapshot({}, { ...snapshot(), energy: { mainspring: 1, battery: true } }), /boolean/i);
  assert.throws(() => mechanismSnapshot({ dividerStages: 31 }, snapshot()), /dividerStages/);
});

test('snapshot and ratio calculations do not mutate caller-owned inputs', () => {
  const config = { mechanicalHz: r(4), quartzHz: 32_768, dividerStages: 15 };
  const input = snapshot({
    time: r(60), mechanicalBeats: r(480), quartzCycles: r(1_966_080), motorCommands: 60,
    mechanicalOperatingTime: r(60), quartzOperatingTime: r(60),
    mechanicalDisplayTime: r(60), quartzDisplayTime: r(60),
  });
  const gear = { driverTurns: r(-3, 2), driverTeeth: 12, drivenTeeth: 8 };
  const configBefore = JSON.parse(JSON.stringify(config));
  const inputBefore = JSON.parse(JSON.stringify(input));
  const gearBefore = JSON.parse(JSON.stringify(gear));
  mechanismSnapshot(config, input);
  externalGearPair(gear);
  assert.deepEqual(config, configBefore);
  assert.deepEqual(input, inputBefore);
  assert.deepEqual(gear, gearBefore);
});

test('zero live rates stop timing while source energy and accumulated display stay intact', () => {
  const result = mechanismSnapshot({}, snapshot({
    time: r(10), mechanicalBeats: r(8), quartzCycles: r(32_768), motorCommands: 1,
    mechanicalOperatingTime: r(1), quartzOperatingTime: r(1),
    mechanicalDisplayTime: r(1), quartzDisplayTime: r(1),
    rates: { mechanicalHz: 0, quartzHz: r(0) },
  }));
  assert.equal(result.mechanical.frequencyHz.numerator, 0);
  assert.equal(result.mechanical.energy.available, true);
  assert.equal(result.mechanical.timing.available, false);
  assert.equal(result.quartz.energy.available, true);
  assert.equal(result.quartz.timing.available, false);
  assert.equal(result.quartz.counts.motorCommands, 1);
  assert.deepEqual(result.quartz.handAnglesDegrees, { second: 6, minute: 0.1, hour: 1 / 120 });
});

test('watch descriptors pass independent examples and trace their real gear dependencies', () => {
  const registry = createRegistry(capabilities, { source: 'watch-mechanism-tests', version: '1' });
  for (const capability of capabilities) {
    assert.ok(capability.examples.length > 0, `${capability.id} has an independent fixture`);
    for (const example of capability.examples) {
      assert.deepEqual(registry.execute(capability.id, example.input).result, example.expected);
    }
  }
  const execution = registry.execute('statistics.mechanismSnapshot', {
    config: {},
    snapshot: snapshot(),
  });
  assert.deepEqual(execution.trace.calls.map(call => call.id), ['statistics.teachingHandTrain', 'statistics.teachingHandTrain']);
  assert.equal(execution.trace.calls[0].calls.length, 4);
  assert.ok(execution.trace.calls[0].calls.every(call => call.id === 'statistics.externalGearPair'));
});
