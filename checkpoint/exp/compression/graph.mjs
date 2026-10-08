import {canonical, clone} from './canonical.mjs';

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function readCollection(stream, name, required, rank) {
  if (!Object.hasOwn(stream, name)) {
    if (required) throw new TypeError(`Event stream must contain ${name}.`);
    return null;
  }
  const rows = stream[name];
  if (!Array.isArray(rows)) throw new TypeError(`${name} must be an array.`);
  return rows.map((event, collectionIndex) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError(`${name}[${collectionIndex}] must be an event object.`);
    }
    if (typeof event.id !== 'string' || event.id.length === 0) {
      throw new TypeError(`${name}[${collectionIndex}] must have a non-empty string id.`);
    }
    if (typeof event.sequence !== 'number' || !Number.isFinite(event.sequence)) {
      throw new TypeError(`${name}[${collectionIndex}] must have a finite sequence.`);
    }
    if (event.dependencies !== undefined && (!Array.isArray(event.dependencies) ||
      event.dependencies.some((dependency) => typeof dependency !== 'string' || dependency.length === 0))) {
      throw new TypeError(`${name}[${collectionIndex}].dependencies must be event ID strings.`);
    }
    return {event: clone(event), collection: name, collectionIndex, rank};
  });
}

export function buildEventGraph(stream) {
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) {
    throw new TypeError('Event stream must be a plain object.');
  }
  // Validate the complete input first so metadata and payload fields cannot be silently lost.
  canonical(stream);

  const events = readCollection(stream, 'events', true, 0);
  const diagnosticEvents = readCollection(stream, 'diagnosticEvents', false, 1);
  const merged = [...events, ...(diagnosticEvents ?? [])]
    .sort((left, right) => left.event.sequence - right.event.sequence ||
      left.rank - right.rank || left.collectionIndex - right.collectionIndex);
  const idToIndex = new Map();
  merged.forEach((row, index) => {
    if (idToIndex.has(row.event.id)) throw new TypeError(`Duplicate event id: ${row.event.id}`);
    idToIndex.set(row.event.id, index);
  });

  const nodes = merged.map((row, index) => ({
    index,
    collection: row.collection,
    collectionIndex: row.collectionIndex,
    event: row.event,
    label: canonical({
      kind: row.event.kind ?? 'event',
      calculation: row.event.calculation ?? null,
      provider: row.event.provider ?? null,
      source: row.event.source ?? stream.source ?? null,
    }),
  }));
  const edges = [];
  for (let index = 0; index + 1 < nodes.length; index += 1) {
    edges.push({from: index, to: index + 1, type: 'temporal-next'});
  }

  const semanticIndices = nodes.filter((node) => node.event.kind === 'calculation').map((node) => node.index);
  for (let index = 0; index + 1 < semanticIndices.length; index += 1) {
    edges.push({from: semanticIndices[index], to: semanticIndices[index + 1], type: 'semantic-next'});
  }

  nodes.forEach((node) => {
    const dependencies = node.event.dependencies ?? [];
    for (const dependencyId of dependencies) {
      const dependencyIndex = idToIndex.get(dependencyId);
      if (dependencyIndex === undefined) throw new TypeError(`Unknown dependency event id: ${dependencyId}`);
      if (dependencyIndex >= node.index) {
        throw new TypeError(`Dependency ${dependencyId} must refer to an earlier event than ${node.event.id}.`);
      }
      // Repeated declarations remain repeated edges; the source event is retained verbatim too.
      edges.push({from: dependencyIndex, to: node.index, type: 'dependency'});
    }
  });

  const collections = {events: Array(events.length)};
  if (diagnosticEvents !== null) collections.diagnosticEvents = Array(diagnosticEvents.length);
  nodes.forEach((node) => { collections[node.collection][node.collectionIndex] = node.index; });

  const metadata = clone(stream);
  delete metadata.events;
  delete metadata.diagnosticEvents;
  return freezeTree({metadata, nodes, edges, collections});
}
