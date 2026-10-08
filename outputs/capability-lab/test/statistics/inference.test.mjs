import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../src/runtime/index.mjs';
import { capabilities as coreCapabilities } from '../../src/statistics/core.mjs';
import { capabilities as orderCapabilities } from '../../src/statistics/order.mjs';
import {
  capabilities as inferenceCapabilities,
  resampleWithReplacement,
  bootstrapMeanCI,
  bootstrapPairedDifferenceCI
} from '../../src/statistics/inference.mjs';
import { capabilities as statisticsCapabilities } from '../../src/statistics/index.mjs';

const allCapabilities = [...coreCapabilities, ...orderCapabilities, ...inferenceCapabilities];
const registry = createRegistry(allCapabilities, { source: 'statistics-tests', version: '1' });
const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('xorshift32 seeded replacement sampling matches hand-indexed draws and preserves the seed', () => {
  const input = { values: [10, 20, 30], sampleSize: 6, seed: 1 };
  const before = structuredClone(input);
  const result = resampleWithReplacement(input);
  assert.deepEqual(result, { values: [10, 10, 20, 10, 20, 10], seed: 1 });
  assert.deepEqual(input, before);
});

test('seed zero is remapped so the xorshift stream does not stay at zero', () => {
  const sampled = resampleWithReplacement({ values: [1, 2], sampleSize: 100, seed: 0 });
  assert.equal(sampled.seed, 0);
  assert.ok(sampled.values.includes(1));
  assert.ok(sampled.values.includes(2));
});

test('bootstrap percentile CI uses an independently checkable one-replicate fixture', () => {
  const result = bootstrapMeanCI({ values: [0, 10], replicates: 1, seed: 1, confidence: 0.8 });
  assert.deepEqual(result, { estimate: 5, lower: 0, upper: 0, replicates: 1, seed: 1, confidence: 0.8 });
});

test('bootstrap draws consecutive replicates from one continuous seed stream', () => {
  const result = bootstrapMeanCI({ values: [0, 10], replicates: 5, seed: 1, confidence: 0.8 });
  assert.deepEqual(result, { estimate: 5, lower: 0, upper: 5, replicates: 5, seed: 1, confidence: 0.8 });
});

test('paired bootstrap first differences matched observations and reports fixed-pair bounds', () => {
  const result = bootstrapPairedDifferenceCI({ x: [2, 2], y: [1, 1], replicates: 5, seed: 7, confidence: 0.9 });
  assert.deepEqual(result, { estimate: 1, lower: 1, upper: 1, replicates: 5, seed: 7, confidence: 0.9 });
});

test('inference descriptors execute every declared dependency through runtime traces', () => {
  const ci = registry.execute('statistics.bootstrapMeanCI', {
    values: [0, 10], replicates: 1, seed: 1, confidence: 0.8
  }, { seed: 'outer-seed' });
  assert.deepEqual(ci.result, { estimate: 5, lower: 0, upper: 0, replicates: 1, seed: 1, confidence: 0.8 });
  assert.deepEqual(new Set(ci.trace.calls.map((call) => call.id)), new Set([
    'statistics.mean', 'statistics.resampleWithReplacement', 'statistics.quantile'
  ]));
  assert.equal(ci.trace.calls.length, 5);
  assert.equal(registry.replay(ci).matches, true);

  const paired = registry.execute('statistics.bootstrapPairedDifferenceCI', {
    x: [2, 2], y: [1, 1], replicates: 2, seed: 7, confidence: 0.9
  });
  assert.deepEqual(new Set(paired.trace.calls.map((call) => call.id)), new Set([
    'statistics.pairedDifferences', 'statistics.bootstrapMeanCI'
  ]));
  const nested = paired.trace.calls.find((call) => call.id === 'statistics.bootstrapMeanCI');
  assert.ok(nested.calls.some((call) => call.id === 'statistics.resampleWithReplacement'));
  assert.equal(registry.replay(paired).matches, true);
});

test('seeded bootstrap replays exactly while a changed data set changes its estimate', () => {
  const input = { values: [0, 10], replicates: 30, seed: 123, confidence: 0.9 };
  const first = registry.execute('statistics.bootstrapMeanCI', input, { seed: 'runtime-seed' });
  const again = registry.execute('statistics.bootstrapMeanCI', input, { seed: 'runtime-seed' });
  const changed = registry.execute('statistics.bootstrapMeanCI', { ...input, values: [10, 30] }, { seed: 'runtime-seed' });
  assert.equal(first.replay.resultCanonical, again.replay.resultCanonical);
  assert.equal(first.replay.resultHash, again.replay.resultHash);
  assert.equal(registry.replay(first).matches, true);
  assert.equal(first.result.estimate, 5);
  const sampled = JSON.parse(first.trace.calls.find((call) => call.id === 'statistics.resampleWithReplacement').resultCanonical).values;
  assert.equal(sampled.length, 60);
  assert.ok(sampled.includes(0));
  assert.ok(sampled.includes(10));
  assert.ok(first.result.lower < first.result.upper);
  assert.equal(changed.result.estimate, 20);
  assert.notEqual(first.replay.resultCanonical, changed.replay.resultCanonical);
});

test('bootstrap bounds reject invalid seeds, confidence, replicates and trace-heavy products', () => {
  assert.throws(() => resampleWithReplacement({ values: [1], sampleSize: 1, seed: -1 }), /seed.*unsigned 32-bit/i);
  assert.throws(() => resampleWithReplacement({ values: [1], sampleSize: 1, seed: 1.5 }), /seed.*unsigned 32-bit/i);
  assert.throws(() => bootstrapMeanCI({ values: [1, 2], replicates: 1_001, seed: 1, confidence: 0.9 }), /replicates.*through 1000/i);
  assert.throws(() => bootstrapMeanCI({ values: [1, 2], replicates: 1, seed: 1, confidence: 1 }), /confidence.*between 0 and 1/i);
  assert.throws(() => bootstrapMeanCI({ values: Array(101).fill(1), replicates: 1_000, seed: 1, confidence: 0.9 }), /sample-work limit/i);
});

test('every combined statistics capability example executes to its independent expected value', () => {
  for (const capability of statisticsCapabilities) {
    for (const example of capability.examples) {
      const actual = registry.execute(capability.id, example.input).result;
      assert.deepEqual(actual, example.expected, `${capability.id} example`);
    }
  }
});

test('standardized summary exposes three real dependency levels from variance', () => {
  const summary = registry.execute('statistics.standardizedSummary', { values: [2, 4, 6] });
  close(summary.result.mean, 4);
  close(summary.result.standardDeviation, Math.sqrt(8 / 3));
  assert.equal(summary.trace.order, 3);
  const ids = new Set();
  const visit = (trace) => { for (const child of trace.calls) { ids.add(child.id); visit(child); } };
  visit(summary.trace);
  assert.ok(ids.has('statistics.variance'));
  assert.ok(ids.has('statistics.standardDeviation'));
  assert.ok(ids.has('statistics.zScores'));
});
