import test from 'node:test';
import assert from 'node:assert/strict';
import {compressOnline, decompressFrame, decompressOnline} from './online.mjs';
import {byteLength, canonical} from './canonical.mjs';

const metadata = {format: 'pagerouter.block5.tick-stream.v1', source: {id: 'p', version: '1'}, initialState: {turn: 0}};
const calc = (id, sequence, dependencies = []) => ({
  id, kind: 'calculation', tick: 0, sequence, source: 'p', calculation: 'step',
  provider: metadata.source, inputRefs: ['input:state', 'input:parameters'],
  inputs: [{turn: sequence}, {direction: 'east'}], outputRef: `event:${id}:output`,
  output: {turn: sequence + 1}, dependencies,
});
const diagnostic = (id, sequence, eventId) => ({id, kind: 'cache', tick: 0, sequence, eventId, cacheHit: false, mayAffect: true, didAffect: true, firstExecution: true});

function fixtureItems() {
  return [
    {collection: 'events', collectionIndex: 0, event: calc('a', 0)},
    {collection: 'diagnosticEvents', collectionIndex: 0, event: diagnostic('da', 1, 'a')},
    {collection: 'events', collectionIndex: 1, event: calc('b', 2, ['a'])},
    {collection: 'diagnosticEvents', collectionIndex: 1, event: diagnostic('db', 3, 'b')},
  ];
}

test('online compressor does not request a future item before emitting a full bounded frame', async () => {
  const items = fixtureItems();
  let reads = 0;
  async function* observed() {
    for (const item of items) {
      reads++;
      yield item;
    }
  }
  const iterator = compressOnline(observed(), {metadata, chunkSize: 2})[Symbol.asyncIterator]();

  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.frame.index, 0);
  assert.equal(first.value.frame.eventCount, 2);
  assert.equal(reads, 2, 'the next frame must not be read before this one is emitted');

  const second = await iterator.next();
  assert.equal(second.done, false);
  assert.equal(second.value.frame.index, 1);
  assert.equal(reads, 4);
  await iterator.return();
});

test('bounded frames decode independently and reassemble original arrays with cross-frame refs intact', async () => {
  const items = fixtureItems();
  const frames = [];
  for await (const value of compressOnline(items, {metadata, chunkSize: 2})) frames.push(value.frame);

  assert.equal(frames.length, 2);
  assert.deepEqual(decompressFrame(frames[1]).events[0].dependencies, ['a']);
  assert.deepEqual(decompressOnline(frames), {
    ...metadata,
    events: [calc('a', 0), calc('b', 2, ['a'])],
    diagnosticEvents: [diagnostic('da', 1, 'a'), diagnostic('db', 3, 'b')],
  });
  assert.deepEqual(frames.map(frame => frame.causality.priorFramesUsed), [false, false]);
  assert.equal(frames[1].externalDependencies[0].dependencies[0], 'a');
});

test('online byte accounting compares canonical raw chunk and full frame envelope bytes', async () => {
  const items = fixtureItems().slice(0, 2);
  const [{frame, stats}] = await Array.fromAsync(compressOnline(items, {metadata, chunkSize: 2}));
  const expectedRaw = {...metadata, events: [items[0].event], diagnosticEvents: [items[1].event]};
  assert.equal(stats.rawBytes, byteLength(expectedRaw));
  assert.equal(stats.encodedBytes, new TextEncoder().encode(canonical(frame)).byteLength);
  assert.equal(stats.savedBytes, stats.rawBytes - stats.encodedBytes);
});

test('online preserves unknown external dependency references instead of rejecting or dropping them', async () => {
  const items = [
    {collection: 'events', collectionIndex: 0, event: calc('lonely', 0, ['unknown-source'])},
  ];
  const frames = [];
  for await (const value of compressOnline(items, {metadata, chunkSize: 1})) frames.push(value.frame);

  assert.deepEqual(decompressOnline(frames).events[0].dependencies, ['unknown-source']);
  assert.deepEqual(frames[0].externalDependencies[0].dependencies, ['unknown-source']);
});

test('online rejects invalid bounds and out-of-order stream items', async () => {
  assert.throws(() => compressOnline([], {metadata, chunkSize: 0}), /chunkSize/i);
  const items = [
    {collection: 'events', collectionIndex: 0, event: calc('later', 2)},
    {collection: 'events', collectionIndex: 1, event: calc('earlier', 0)},
  ];
  const iterator = compressOnline(items, {metadata, chunkSize: 2});
  await assert.rejects(iterator.next(), /order|sequence/i);
});

test('independently decoded frame rejects altered dependency sidecar', async () => {
  const items = fixtureItems();
  const frames = [];
  for await (const value of compressOnline(items, {metadata, chunkSize: 2})) frames.push(value.frame);
  const corrupt = structuredClone(frames[1]);
  corrupt.externalDependencies.push(structuredClone(corrupt.externalDependencies[0]));

  assert.throws(() => decompressFrame(corrupt), /dependency|sidecar|reference/i);
});
