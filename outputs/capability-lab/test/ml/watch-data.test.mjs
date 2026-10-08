import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWatchCalibrationDataset, predictAnalyticalWatchBaseline } from '../../src/ml/watch-data.mjs';
import { splitByGroup } from '../../src/ml/data.mjs';

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from ${expected}`);
};

const pair = (numerator, denominator = 1) => ({ numerator, denominator });

test('watch data comes from the actual transport at early and horizon observations', () => {
  const input = {
    conditions: [
      { conditionId: 'slow', mechanicalHz: pair(37, 10) },
      { conditionId: 'fractional-phase', mechanicalHz: pair(15, 4) },
      { conditionId: 'slightly-slow', mechanicalHz: pair(39, 10) },
      { conditionId: 'nominal', mechanicalHz: pair(4) },
      { conditionId: 'fast', mechanicalHz: pair(21, 5) },
    ],
    earlySeconds: 5,
    horizonSeconds: 30,
    seed: 7,
  };
  const before = structuredClone(input);
  const dataset = buildWatchCalibrationDataset(input);
  assert.deepEqual(input, before, 'dataset generation does not mutate the recipe');
  assert.equal(dataset.sourceKind, 'synthetic-watch');
  assert.deepEqual(dataset.featureNames, ['earlyObservedMechanicalHz']);
  assert.equal(dataset.targetName, 'horizonClockErrorSeconds');
  assert.equal(dataset.records.length, 5);
  const byCondition = Object.fromEntries(dataset.records.map(record => [record.conditionId, record]));
  assert.deepEqual(byCondition.slow.features, [3.7]);
  close(byCondition.slow.observations.earlyClockErrorSeconds, -0.375);
  close(byCondition.slow.target, -2.25);
  assert.deepEqual(byCondition['fractional-phase'].features, [3.75]);
  assert.deepEqual(byCondition['fractional-phase'].observations.earlyMechanicalCycles, pair(75, 2));
  assert.equal(byCondition['fractional-phase'].observations.earlyMechanicalBeats, 37);
  assert.deepEqual(byCondition['fractional-phase'].observations.earlyOperatingTime, pair(5));
  assert.deepEqual(byCondition['fractional-phase'].observations.earlyObservationWindowSeconds, pair(5));
  assert.equal(byCondition['fractional-phase'].observations.readoutKind, 'synthetic-teaching-phase-observation');
  assert.equal(byCondition['fractional-phase'].observations.formula, 'earlyMechanicalCycles/(2*earlyOperatingTime)');
  close(
    byCondition['fractional-phase'].observations.earlyMechanicalCycles.numerator /
      byCondition['fractional-phase'].observations.earlyMechanicalCycles.denominator /
      (2 * (byCondition['fractional-phase'].observations.earlyOperatingTime.numerator /
        byCondition['fractional-phase'].observations.earlyOperatingTime.denominator)),
    byCondition['fractional-phase'].features[0],
  );
  assert.deepEqual(byCondition['slightly-slow'].features, [3.9]);
  close(byCondition['slightly-slow'].observations.earlyClockErrorSeconds, -0.125);
  close(byCondition['slightly-slow'].target, -0.75);
  assert.deepEqual(byCondition.nominal.features, [4]);
  close(byCondition.nominal.observations.earlyClockErrorSeconds, 0);
  close(byCondition.nominal.target, 0);
  assert.deepEqual(byCondition.fast.features, [4.2]);
  close(byCondition.fast.observations.earlyClockErrorSeconds, 0.25);
  close(byCondition.fast.target, 1.5);
  assert.equal(byCondition.fast.observations.horizonMechanicalBeats, 252);
  assert.deepEqual(byCondition.fast.observations.horizonOperatingTime, pair(30));
  assert.deepEqual(byCondition.fast.observations.horizonDisplayTime, pair(63, 2));
  close(
    byCondition.fast.observations.horizonDisplayTime.numerator / byCondition.fast.observations.horizonDisplayTime.denominator - dataset.provenance.horizonSeconds,
    byCondition.fast.target,
  );
  assert.equal(Object.hasOwn(byCondition.fast, 'configuredMechanicalHz'), false);
  assert.equal(byCondition.fast.features.includes(4.2), true, '4.2 is the measured feature, independent of the separate provenance');
  assert.equal(dataset.provenance.configuredConditions.find(item => item.conditionId === 'fast').mechanicalHz.numerator, 21);
  assert.equal(dataset.provenance.configuredConditions.find(item => item.conditionId === 'fast').mechanicalHz.denominator, 5);
});

test('analytical drift baseline uses observable early rate and explicit nominal parameters', () => {
  const input = { features: [[4.2], [3.7]], nominalMechanicalHz: pair(4), horizonSeconds: 30 };
  const before = structuredClone(input);
  const baseline = predictAnalyticalWatchBaseline(input);
  close(baseline.predictions[0], 1.5);
  close(baseline.predictions[1], -2.25);
  assert.deepEqual(input, before);
});

test('seeded default conditions are deterministic, bounded, and groupable by condition', () => {
  const first = buildWatchCalibrationDataset({ seed: 113 });
  const replay = buildWatchCalibrationDataset({ seed: 113 });
  const changedSeed = buildWatchCalibrationDataset({ seed: 114 });
  assert.deepEqual(first, replay);
  assert.notDeepEqual(first.provenance.configuredConditions, changedSeed.provenance.configuredConditions);
  assert.equal(first.records.length, 7);
  assert.deepEqual(first.provenance.configuredConditions.map(item => item.conditionId), first.records.map(record => record.conditionId));
  const split = splitByGroup({ records: first.records, testFraction: 0.3, seed: 8 });
  const trainConditions = new Set(split.train.map(record => record.conditionId));
  assert.ok(split.test.every(record => !trainConditions.has(record.conditionId)));
  assert.ok(split.train.length > 0 && split.test.length > 0);
  assert.ok(first.records.every(record => record.features.length === 1 && Number.isFinite(record.target)));
  const zeroSeed = buildWatchCalibrationDataset({ seed: 0 });
  assert.equal(zeroSeed.records.length, 7, 'seed zero is remapped to a nonstuck PRNG state');
  assert.equal(new Set(zeroSeed.provenance.configuredConditions.map(item => `${item.mechanicalHz.numerator}/${item.mechanicalHz.denominator}`)).size, 7);
});

test('merged seeded datasets share stable condition identity and retain distinct recipe runs', () => {
  const first = buildWatchCalibrationDataset({ seed: 1 });
  const second = buildWatchCalibrationDataset({ seed: 2 });
  const firstByRate = new Map(first.provenance.configuredConditions.map(condition => [
    `${condition.mechanicalHz.numerator}/${condition.mechanicalHz.denominator}`,
    condition.conditionId,
  ]));
  const secondByRate = new Map(second.provenance.configuredConditions.map(condition => [
    `${condition.mechanicalHz.numerator}/${condition.mechanicalHz.denominator}`,
    condition.conditionId,
  ]));
  const sharedRates = [...firstByRate.keys()].filter(rate => secondByRate.has(rate));
  assert.ok(sharedRates.length > 0, 'fixture seeds select at least one common rate');
  for (const rate of sharedRates) assert.equal(firstByRate.get(rate), secondByRate.get(rate));
  const firstRuns = new Set(first.records.map(record => record.runId));
  assert.ok(second.records.every(record => !firstRuns.has(record.runId)), 'recipe seed remains part of run identity');
  const differentHorizon = buildWatchCalibrationDataset({ seed: 1, horizonSeconds: 40 });
  assert.ok(differentHorizon.records.every(record => !firstRuns.has(record.runId)), 'horizon remains part of run identity');
  const merged = splitByGroup({ records: [...first.records, ...second.records], testFraction: 0.3, seed: 27 });
  const trainingConditions = new Set(merged.train.map(record => record.conditionId));
  assert.ok(merged.test.every(record => !trainingConditions.has(record.conditionId)), 'shared configured-rate conditions stay in one split');
});

test('watch dataset validates conditions, horizons, and unsigned seed inputs', () => {
  assert.throws(() => buildWatchCalibrationDataset({ conditions: [{ conditionId: 'one', mechanicalHz: 4 }] }), /at least 4|4 to/i);
  assert.throws(() => buildWatchCalibrationDataset({ conditions: [
    { conditionId: 'a', mechanicalHz: 4 }, { conditionId: 'a', mechanicalHz: 5 },
    { conditionId: 'c', mechanicalHz: 3 }, { conditionId: 'd', mechanicalHz: 4 },
  ] }), /unique/i);
  assert.throws(() => buildWatchCalibrationDataset({ conditions: [
    { conditionId: 'a', mechanicalHz: 0 }, { conditionId: 'b', mechanicalHz: 3 },
    { conditionId: 'c', mechanicalHz: 4 }, { conditionId: 'd', mechanicalHz: 5 },
  ] }), /positive|rate/i);
  assert.throws(() => buildWatchCalibrationDataset({ conditions: [
    { conditionId: 'a', mechanicalHz: 9 }, { conditionId: 'b', mechanicalHz: 3 },
    { conditionId: 'c', mechanicalHz: 4 }, { conditionId: 'd', mechanicalHz: 5 },
  ] }), /8|maximum/i);
  assert.throws(() => buildWatchCalibrationDataset({ conditions: [
    { conditionId: 'a', mechanicalHz: 3.7 }, { conditionId: 'b', mechanicalHz: 3 },
    { conditionId: 'c', mechanicalHz: 4 }, { conditionId: 'd', mechanicalHz: 5 },
  ] }), /exact.*rational/i);
  assert.throws(() => buildWatchCalibrationDataset({ earlySeconds: 5, horizonSeconds: 5 }), /greater|horizon/i);
  assert.throws(() => buildWatchCalibrationDataset({ earlySeconds: 0 }), /positive|seconds/i);
  assert.throws(() => buildWatchCalibrationDataset({ seed: -1 }), /unsigned|seed/i);
  assert.throws(() => buildWatchCalibrationDataset({ seed: 4_294_967_296 }), /unsigned|seed/i);
});

test('baseline rejects malformed and nonfinite predictions without reading targets', () => {
  assert.throws(() => predictAnalyticalWatchBaseline({ features: [], nominalMechanicalHz: 4, horizonSeconds: 30 }), /row|between|features/i);
  assert.throws(() => predictAnalyticalWatchBaseline({ features: [[Infinity]], nominalMechanicalHz: 4, horizonSeconds: 30 }), /finite/i);
  assert.throws(() => predictAnalyticalWatchBaseline({ features: [[4]], nominalMechanicalHz: 0, horizonSeconds: 30 }), /positive/i);
  assert.throws(() => predictAnalyticalWatchBaseline({ features: [[4]], nominalMechanicalHz: 4, horizonSeconds: 0 }), /positive/i);
});
