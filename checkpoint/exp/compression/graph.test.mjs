import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEventGraph} from './graph.mjs';

const event = (id, sequence, extra = {}) => ({id, kind: 'calculation', sequence, ...extra});

test('event graph merges collections stably and preserves source arrays and metadata', () => {
  const stream = {
    format: 'pagerouter.block5.tick-stream.v1', source: 'game', initialState: {score: 0},
    recipe: {id: 'r1'},
    events: [event('a', 1), event('b', 2), event('c', 2)],
    diagnosticEvents: [{id: 'diag', kind: 'cache-hit', sequence: 2, payload: {hit: true}}],
  };

  const graph = buildEventGraph(stream);

  assert.deepEqual(graph.nodes.map(({event: row, collection, collectionIndex}) => [row.id, collection, collectionIndex]), [
    ['a', 'events', 0], ['b', 'events', 1], ['c', 'events', 2], ['diag', 'diagnosticEvents', 0],
  ]);
  assert.deepEqual(graph.collections, {events: [0, 1, 2], diagnosticEvents: [3]});
  assert.deepEqual(graph.metadata, {
    format: 'pagerouter.block5.tick-stream.v1', source: 'game', initialState: {score: 0}, recipe: {id: 'r1'},
  });
  assert.equal(graph.nodes[3].event.payload.hit, true);
});

test('event graph retains typed directed temporal, semantic and declared dependency edges', () => {
  const stream = {
    source: 'sim',
    events: [
      event('root', 1, {calculation: 'choose', provider: {id: 'p', version: 1}, output: {value: 2}}),
      event('branch', 2, {calculation: 'left', dependencies: ['root']}),
      event('independent', 3, {kind: 'diagnostic'}),
      event('join', 4, {calculation: 'join', dependencies: ['root', 'branch']}),
    ],
  };

  const graph = buildEventGraph(stream);

  assert.deepEqual(graph.edges, [
    {from: 0, to: 1, type: 'temporal-next'},
    {from: 1, to: 2, type: 'temporal-next'},
    {from: 2, to: 3, type: 'temporal-next'},
    {from: 0, to: 1, type: 'semantic-next'},
    {from: 1, to: 3, type: 'semantic-next'},
    {from: 0, to: 1, type: 'dependency'},
    {from: 0, to: 3, type: 'dependency'},
    {from: 1, to: 3, type: 'dependency'},
  ]);
  assert.equal(graph.nodes[0].event.output.value, 2);
  assert.equal(graph.nodes[0].label,
    '{"calculation":"choose","kind":"calculation","provider":{"id":"p","version":1},"source":"sim"}');
});

test('event graph rejects duplicate IDs, unknown dependencies and dependencies that point forward', () => {
  assert.throws(() => buildEventGraph({events: [event('same', 1), event('same', 2)]}), /duplicate event id/i);
  assert.throws(() => buildEventGraph({events: [event('a', 1, {dependencies: ['missing']})]}), /unknown dependency/i);
  assert.throws(() => buildEventGraph({events: [event('a', 1, {dependencies: ['b']}), event('b', 2)]}), /must refer to an earlier event/i);
});

test('event graph retains duplicate dependency declarations as duplicate edges', () => {
  const graph = buildEventGraph({events: [event('a', 1), event('b', 2, {dependencies: ['a', 'a']})]});

  assert.equal(graph.edges.filter((edge) => edge.type === 'dependency').length, 2);
  assert.deepEqual(graph.nodes[1].event.dependencies, ['a', 'a']);
});
