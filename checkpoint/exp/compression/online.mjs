import {byteLength, canonical, clone} from './canonical.mjs';
import {compressStream, decompress} from './codec.mjs';

const FRAME_FORMAT = 'pagerouter.event-stream-frame.v1';
const COLLECTIONS = ['events', 'diagnosticEvents'];

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function compareOrder(left, right) {
  return left.sequence - right.sequence || left.rank - right.rank || left.collectionIndex - right.collectionIndex;
}

function validateOptions(eventItems, options) {
  if (!eventItems || (typeof eventItems[Symbol.asyncIterator] !== 'function' && typeof eventItems[Symbol.iterator] !== 'function')) {
    throw new TypeError('eventItems must be an iterable of observed graph events');
  }
  const {metadata = {}, chunkSize = 64, maxNodes = 4, beamWidth = 16, diagnosticEventsPresent = true} = options;
  plainObject(metadata, 'metadata');
  canonical(metadata);
  if (Object.hasOwn(metadata, 'events') || Object.hasOwn(metadata, 'diagnosticEvents')) throw new TypeError('metadata cannot contain event collections');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 2048) throw new RangeError('chunkSize must be an integer from 1 to 2048');
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 6) throw new RangeError('maxNodes must be an integer from 1 to 6');
  if (!Number.isInteger(beamWidth) || beamWidth < 1 || beamWidth > 128) throw new RangeError('beamWidth must be an integer from 1 to 128');
  if (typeof diagnosticEventsPresent !== 'boolean') throw new TypeError('diagnosticEventsPresent must be Boolean');
  return {metadata: clone(metadata), chunkSize, maxNodes, beamWidth, diagnosticEventsPresent};
}

function validateItem(item, previous) {
  plainObject(item, 'event item');
  if (!COLLECTIONS.includes(item.collection) || (item.collection === 'diagnosticEvents' && !item.event)) throw new TypeError('event item has an unsupported collection');
  if (!Number.isInteger(item.collectionIndex) || item.collectionIndex < 0) throw new TypeError('collectionIndex must be a nonnegative integer');
  plainObject(item.event, 'event');
  canonical(item.event);
  if (!Number.isFinite(item.event.sequence)) throw new TypeError('event sequence must be finite');
  const current = {sequence: item.event.sequence, rank: item.collection === 'events' ? 0 : 1, collectionIndex: item.collectionIndex};
  if (previous && compareOrder(previous, current) > 0) throw new TypeError('event items must arrive in stable sequence order');
  return current;
}

function encodeFrame(items, options, index) {
  const rawStream = {
    ...options.metadata,
    events: items.filter(item => item.collection === 'events').sort((a, b) => a.collectionIndex - b.collectionIndex).map(item => clone(item.event)),
    ...(options.diagnosticEventsPresent ? {diagnosticEvents: items.filter(item => item.collection === 'diagnosticEvents').sort((a, b) => a.collectionIndex - b.collectionIndex).map(item => clone(item.event))} : {}),
  };
  const ids = new Set(items.map(item => item.event.id).filter(id => typeof id === 'string'));
  const chunk = {events: [], diagnosticEvents: []};
  const sourceIndices = {events: [], diagnosticEvents: []};
  const localIndex = {events: new Map(), diagnosticEvents: new Map()};
  for (const item of items) localIndex[item.collection].set(item.collectionIndex, null);
  for (const collection of COLLECTIONS) {
    const ordered = items.filter(item => item.collection === collection).sort((a, b) => a.collectionIndex - b.collectionIndex);
    const seen = new Set();
    for (const item of ordered) {
      if (seen.has(item.collectionIndex)) throw new TypeError(`duplicate ${collection} source index ${item.collectionIndex} in frame`);
      seen.add(item.collectionIndex);
      const local = chunk[collection].length;
      localIndex[collection].set(item.collectionIndex, local);
      chunk[collection].push(clone(item.event));
      sourceIndices[collection].push(item.collectionIndex);
    }
  }
  if (!options.diagnosticEventsPresent && chunk.diagnosticEvents.length) throw new TypeError('diagnostic event supplied while diagnosticEventsPresent is false');

  const externalDependencies = [];
  const localStream = {...options.metadata, events: chunk.events};
  if (options.diagnosticEventsPresent) localStream.diagnosticEvents = chunk.diagnosticEvents;
  for (const collection of COLLECTIONS) {
    for (let collectionIndex = 0; collectionIndex < localStream[collection]?.length; collectionIndex++) {
      const event = localStream[collection][collectionIndex];
      if (!Object.hasOwn(event, 'dependencies')) continue;
      if (!Array.isArray(event.dependencies) || event.dependencies.some(id => typeof id !== 'string')) throw new TypeError(`invalid dependency list in ${collection}[${collectionIndex}]`);
      const localDependencies = event.dependencies.filter(id => ids.has(id));
      if (canonical(localDependencies) !== canonical(event.dependencies)) {
        externalDependencies.push({collection, collectionIndex, dependencies: clone(event.dependencies)});
        event.dependencies = localDependencies;
      }
    }
  }

  const {bundle} = compressStream(localStream, {maxNodes: options.maxNodes, beamWidth: options.beamWidth});
  const frame = {
    format: FRAME_FORMAT,
    index,
    eventCount: items.length,
    bundle,
    sourceIndices,
    externalDependencies,
    causality: {
      mode: 'bounded-observed-block',
      chunkSize: options.chunkSize,
      observedEventCount: items.length,
      lookaheadEvents: items.length,
      priorFramesUsed: false,
      priorEventsRetained: 0,
      modelScope: 'frame-local dictionary; no model or event history is carried into the next frame',
    },
    workingBound: {
      maxBufferedEvents: options.chunkSize,
      maxNodes: options.maxNodes,
      beamWidth: options.beamWidth,
      historyEventsRetained: 0,
    },
  };
  const rawBytes = byteLength(rawStream);
  const encodedBytes = byteLength(frame);
  return {
    frame,
    stats: {rawBytes, encodedBytes, savedBytes: rawBytes - encodedBytes, ratio: rawBytes === 0 ? 0 : encodedBytes / rawBytes},
  };
}

function decodeFrame(frame) {
  canonical(frame);
  if (!frame || frame.format !== FRAME_FORMAT || !Number.isInteger(frame.index) || frame.index < 0 || !Number.isInteger(frame.eventCount) || frame.eventCount < 0) {
    throw new TypeError('invalid online frame header');
  }
  if (!frame.sourceIndices || !Array.isArray(frame.externalDependencies) || !frame.causality || !frame.workingBound) throw new TypeError('online frame is missing required metadata');
  const stream = decompress(frame.bundle);
  const hasDiagnostics = Object.hasOwn(stream, 'diagnosticEvents');
  if (!Object.hasOwn(stream, 'events') || (hasDiagnostics && !Array.isArray(stream.diagnosticEvents))) throw new TypeError('frame bundle has invalid event collections');
  const collections = {events: stream.events, diagnosticEvents: hasDiagnostics ? stream.diagnosticEvents : []};
  for (const name of COLLECTIONS) {
    const indices = frame.sourceIndices[name];
    if (!Array.isArray(indices) || indices.length !== collections[name].length || indices.some(index => !Number.isInteger(index) || index < 0) || new Set(indices).size !== indices.length) {
      throw new TypeError(`invalid ${name} source-index map`);
    }
  }
  const ids = new Set([...collections.events, ...collections.diagnosticEvents].map(event => event.id));
  const seen = new Set();
  for (const item of frame.externalDependencies) {
    if (!item || !COLLECTIONS.includes(item.collection) || !Number.isInteger(item.collectionIndex) || !Array.isArray(item.dependencies) || item.dependencies.some(id => typeof id !== 'string')) {
      throw new TypeError('invalid external dependency record');
    }
    const key = `${item.collection}:${item.collectionIndex}`;
    if (seen.has(key)) throw new TypeError('duplicate external dependency record');
    seen.add(key);
    const event = collections[item.collection][item.collectionIndex];
    if (!event || !Array.isArray(event.dependencies)) throw new TypeError('external dependency record references a missing event');
    const localDependencies = item.dependencies.filter(id => ids.has(id));
    if (canonical(localDependencies) !== canonical(event.dependencies) || canonical(item.dependencies) === canonical(event.dependencies)) {
      throw new TypeError('external dependency sidecar disagrees with encoded event references');
    }
    event.dependencies = clone(item.dependencies);
  }
  if (collections.events.length + collections.diagnosticEvents.length !== frame.eventCount) throw new TypeError('frame event count mismatch');
  return {stream, sourceIndices: clone(frame.sourceIndices), hasDiagnostics};
}

export function decompressFrame(frame) {
  return clone(decodeFrame(frame).stream);
}

export function decompressOnline(frames) {
  if (!frames || typeof frames[Symbol.iterator] !== 'function') throw new TypeError('frames must be iterable');
  const allEvents = [], allDiagnostics = [];
  let metadata = null, diagnosticsPresent = null, expectedFrame = 0;
  const used = {events: new Set(), diagnosticEvents: new Set()};
  for (const frame of frames) {
    const decoded = decodeFrame(frame), stream = decoded.stream;
    if (frame.index !== expectedFrame++) throw new TypeError('online frame indexes must be contiguous from zero');
    const nextMetadata = {...stream}; delete nextMetadata.events; delete nextMetadata.diagnosticEvents;
    if (metadata === null) { metadata = clone(nextMetadata); diagnosticsPresent = decoded.hasDiagnostics; }
    else if (canonical(metadata) !== canonical(nextMetadata) || diagnosticsPresent !== decoded.hasDiagnostics) throw new TypeError('online frames disagree on stream metadata or collection presence');
    for (const name of COLLECTIONS) {
      const events = name === 'events' ? stream.events : stream.diagnosticEvents ?? [];
      const indices = frame.sourceIndices[name];
      for (let local = 0; local < events.length; local++) {
        const sourceIndex = indices[local];
        if (used[name].has(sourceIndex)) throw new TypeError(`duplicate ${name} source index ${sourceIndex}`);
        used[name].add(sourceIndex);
        (name === 'events' ? allEvents : allDiagnostics).push({sourceIndex, event: events[local]});
      }
    }
  }
  if (metadata === null) throw new TypeError('at least one frame is required to restore stream metadata');
  function restore(rows, label) {
    rows.sort((a, b) => a.sourceIndex - b.sourceIndex);
    if (rows.some((row, index) => row.sourceIndex !== index)) throw new TypeError(`${label} source indexes must cover a contiguous range from zero`);
    return rows.map(row => row.event);
  }
  const result = metadata;
  result.events = restore(allEvents, 'events');
  if (diagnosticsPresent) result.diagnosticEvents = restore(allDiagnostics, 'diagnosticEvents');
  return clone(result);
}

export function compressOnline(eventItems, options = {}) {
  const normalized = validateOptions(eventItems, options);
  async function* consume() {
    let items = [], index = 0, previous = null;
    for await (const input of eventItems) {
      const item = clone(input);
      previous = validateItem(item, previous);
      items.push(item);
      if (items.length === normalized.chunkSize) {
        yield encodeFrame(items, normalized, index++);
        items = [];
      }
    }
    if (items.length || index === 0) yield encodeFrame(items, normalized, index);
  }
  return consume();
}
