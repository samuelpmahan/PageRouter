import test from 'node:test';
import assert from 'node:assert/strict';
import {compressStream, decompress, encodeWithPatterns} from './codec.mjs';
import {byteLength, canonical} from './canonical.mjs';
import {buildEventGraph} from './graph.mjs';
import {discoverPatterns} from './discovery.mjs';

const provider = {id: 'demo-provider', version: '1', implementationId: 'fixture'};
function calculation(id, sequence, dependencies, payload) {
  return {
    id, kind: 'calculation', tick: 0, sequence, provider, calculation: 'step',
    inputRefs: dependencies.length ? [dependencies.at(-1), 'seed'] : ['seed', 'seed'],
    inputs: [dependencies.length ? {event: dependencies.at(-1)} : {seed: 4}, {seed: 4}],
    outputRef: id, output: {value: sequence, payload}, dependencies,
  };
}

function stream() {
  return {
    format: 'pagerouter.block5.tick-stream.v1', source: 'codec-test', initialState: {score: 0},
    recipe: {id: 'r', labels: ['𝌆', '__proto__']},
    events: [
      calculation('a', 0, [], {shared: true, value: 1}),
      calculation('b', 1, ['a'], {shared: true, value: 2}),
      calculation('c', 2, ['b'], {shared: true, value: 3}),
      calculation('d', 3, [], {shared: true, value: 4}),
      calculation('e', 4, ['d'], {shared: true, value: 5}),
    ],
    diagnosticEvents: [
      {id: 'x', kind: 'cache-hit', sequence: 1.5, source: 'cache', payload: {hit: false}},
    ],
  };
}

function patternsFor(value) {
  const label = `{"calculation":"step","kind":"calculation","provider":{"id":"demo-provider","implementationId":"fixture","version":"1"},"source":"${value.source}"}`;
  const pairEdges = ['dependency', 'semantic-next', 'temporal-next'].map(type => ({from: 0, to: 1, type}));
  return [
    {id: 'pair', labels: [label, label], edges: pairEdges, occurrences: [[0, 1], [4, 5]]},
    {id: 'chain', labels: [label, label, label], edges: [
      ...pairEdges,
      {from: 1, to: 2, type: 'dependency'}, {from: 1, to: 2, type: 'semantic-next'},
    ], occurrences: [[0, 1, 3]]},
  ];
}

test('nested model references recursively expand exact event objects and both source arrays', () => {
  const original = stream();
  const patterns = patternsFor(original);
  const bundle = encodeWithPatterns(original, patterns);

  assert.deepEqual(decompress(bundle), original);
  assert.ok(patterns.length >= 1);
  assert.ok(bundle.models.some((model) => model.decomposition.items.some((item) => item.kind === 'ref')),
    'the larger model must contain a real reference to a smaller model');
  assert.ok(byteLength(bundle) > 0);
});

test('encoded byte accounting includes model dictionary, residuals, mappings and stream metadata', () => {
  const original = stream();
  const patterns = patternsFor(original);
  const {bundle, stats} = compressStream(original, {patterns});

  assert.equal(stats.rawBytes, byteLength(original));
  assert.equal(stats.encodedBytes, byteLength(bundle));
  assert.equal(stats.savedBytes, stats.rawBytes - stats.encodedBytes);
  assert.equal(stats.ratio, stats.encodedBytes / stats.rawBytes);
  assert.ok(Object.hasOwn(bundle, 'models'));
  assert.ok(Object.hasOwn(bundle, 'records'));
  assert.ok(Object.hasOwn(bundle, 'collections'));
  assert.ok(Object.hasOwn(bundle, 'metadata'));
});

test('serialized canonical bundle roundtrip preserves negative zero, Unicode, and empty-versus-missing fields', () => {
  const original = stream();
  original.initialState.negativeZero = -0;
  original.events[0].output.payload.unicode = '🌍';
  original.events[0].output.payload.empty = [];
  delete original.events[1].output.payload.empty;
  const bundle = encodeWithPatterns(original, patternsFor(original));
  assert.ok(bundle.models.some(model => model.decomposition.items.some(item => item.kind === 'ref')),
    'wire fixture must exercise recursive model expansion');
  const serialized = canonical(bundle);
  const parsed = JSON.parse(serialized);

  assert.equal(new TextEncoder().encode(serialized).byteLength, byteLength(bundle));
  assert.equal(Object.is(decompress(parsed).initialState.negativeZero, -0), true);
  assert.deepEqual(decompress(parsed), original);
});

test('overlapping repeated occurrences are selected greedily without duplicate coverage', () => {
  const repeated = {
    format: 'pagerouter.block5.tick-stream.v1', source: 'overlap',
    events: Array.from({length: 6}, (_, index) => ({id: `e${index}`, kind: 'calculation', sequence: index, calculation: 'step', provider, dependencies: []})),
    diagnosticEvents: [],
  };
  const graph = buildEventGraph(repeated);
  const patterns = discoverPatterns(graph, {maxNodes: 3, beamWidth: 128});
  const overlapping = patterns.find(pattern => pattern.occurrences.some((left, index) => pattern.occurrences.slice(index + 1).some(right => left.some(position => right.includes(position)))));
  assert.ok(overlapping, 'fixture should contain an overlapping repeated motif');
  const bundle = encodeWithPatterns(repeated, patterns);
  assert.deepEqual(decompress(bundle), repeated);
});

test('decoder rejects duplicate event coverage and dangling or cyclic nested model references', () => {
  const original = stream();
  const bundle = encodeWithPatterns(original, patternsFor(original));

  const duplicate = structuredClone(bundle);
  const refRecord = duplicate.records.find((record) => record.kind === 'ref');
  assert.ok(refRecord);
  refRecord.positions[0] = refRecord.positions[1];
  assert.throws(() => decompress(duplicate), /coverage|duplicate|position/i);

  const dangling = structuredClone(bundle);
  const parent = dangling.models.find((model) => model.decomposition.items.some((item) => item.kind === 'ref'));
  parent.decomposition.items.find((item) => item.kind === 'ref').modelId = 'missing-model';
  assert.throws(() => decompress(dangling), /unknown|missing.*model/i);

  const cyclic = structuredClone(bundle);
  const child = cyclic.models.find((model) => model.decomposition.items.some((item) => item.kind === 'ref'));
  const childRef = child.decomposition.items.find((item) => item.kind === 'ref');
  childRef.modelId = child.id;
  childRef.slotMap = Array.from({length: child.nodeCount}, (_, slot) => slot);
  assert.throws(() => decompress(cyclic), /cycle|reference/i);
});

test('lossless fallback handles empty streams and reports negative compression honestly', () => {
  const original = {format: 'pagerouter.block5.tick-stream.v1', source: 'empty', events: [], diagnosticEvents: []};
  const {bundle, stats} = compressStream(original, {patterns: []});

  assert.deepEqual(decompress(bundle), original);
  assert.equal(stats.rawBytes, byteLength(original));
  assert.equal(stats.encodedBytes, byteLength(bundle));
  assert.equal(stats.savedBytes, stats.rawBytes - stats.encodedBytes);
  assert.equal(stats.ratio, stats.encodedBytes / stats.rawBytes);
});
