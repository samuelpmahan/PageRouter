import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPatterns} from './discovery.mjs';

const graph = (edges, nodeLabels = ['A', 'B', 'C', 'A', 'B', 'C']) => ({
  nodes: nodeLabels.map((label, index) => ({index, label})),
  edges,
});

test('discovery groups repeated connected induced motifs, including a branched motif', () => {
  const input = graph([
    {from: 0, to: 1, type: 'a'}, {from: 0, to: 2, type: 'b'},
    {from: 3, to: 4, type: 'a'}, {from: 3, to: 5, type: 'b'},
  ]);

  const patterns = discoverPatterns(input, {maxNodes: 3, beamWidth: 64});
  const branch = patterns.find((pattern) => pattern.labels.length === 3 &&
    pattern.occurrences.length === 2 && pattern.edges.length === 2);

  assert.ok(branch, 'same three-node branch should form one repeated candidate');
  assert.deepEqual(branch.occurrences, [[0, 1, 2], [3, 4, 5]]);
  assert.deepEqual(branch.edges, [{from: 0, to: 1, type: 'a'}, {from: 0, to: 2, type: 'b'}]);
});

test('discovery canonicalizes isomorphic occurrences despite different node numbering', () => {
  const input = {
    nodes: ['X', 'Y', 'Y', 'X'].map((label, index) => ({index, label})),
    edges: [
      {from: 0, to: 1, type: 'next'},
      {from: 3, to: 2, type: 'next'},
    ],
  };
  const patterns = discoverPatterns(input, {maxNodes: 2, beamWidth: 64});
  const pair = patterns.find((pattern) => pattern.labels.length === 2 && pattern.occurrences.length === 2);

  assert.ok(pair);
  assert.deepEqual(pair.labels, ['X', 'Y']);
  assert.deepEqual(pair.edges, [{from: 0, to: 1, type: 'next'}]);
  assert.deepEqual(pair.occurrences, [[0, 1], [3, 2]]);
});

test('discovery ranks by supplied complete representation byte cost', () => {
  const input = graph([
    {from: 0, to: 1, type: 'a'}, {from: 0, to: 2, type: 'b'},
    {from: 3, to: 4, type: 'a'}, {from: 3, to: 5, type: 'b'},
  ]);
  const patterns = discoverPatterns(input, {
    maxNodes: 2,
    beamWidth: 64,
    scorePattern: (pattern) => pattern.labels.length === 2 ? 1 : 10,
  });

  assert.ok(patterns.length > 0);
  assert.ok(patterns[0].labels.length === 2);
});

test('discovery enforces bounded search options and refuses malformed edges', () => {
  const input = graph([]);
  assert.throws(() => discoverPatterns(input, {maxNodes: 7}), /maxNodes/i);
  assert.throws(() => discoverPatterns(input, {beamWidth: 0}), /beamWidth/i);
  assert.throws(() => discoverPatterns({nodes: [{index: 0, label: 'A'}], edges: [{from: 0, to: 4, type: 'x'}]}), /edge/i);
});
