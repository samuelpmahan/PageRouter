import {byteLength, canonical, clone} from './canonical.mjs';
import {buildEventGraph} from './graph.mjs';
import {discoverPatterns} from './discovery.mjs';

const FORMAT = 'pagerouter.event-stream-compressed.v1';
const COLLECTIONS = ['events', 'diagnosticEvents'];

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
}

function edgeKey(edge) {
  return canonical([edge.from, edge.to, edge.type]);
}

function validatePattern(pattern, graph) {
  if (!pattern || typeof pattern.id !== 'string' || !pattern.id) throw new TypeError('pattern needs an id');
  assertArray(pattern.labels, `pattern ${pattern.id} labels`);
  assertArray(pattern.edges, `pattern ${pattern.id} edges`);
  assertArray(pattern.occurrences, `pattern ${pattern.id} occurrences`);
  if (!pattern.labels.length || pattern.labels.some(label => typeof label !== 'string')) throw new TypeError(`pattern ${pattern.id} has invalid labels`);
  const n = pattern.labels.length;
  const edges = pattern.edges.map(edge => {
    if (!edge || !Number.isInteger(edge.from) || !Number.isInteger(edge.to) || edge.from < 0 || edge.to < 0 || edge.from >= n || edge.to >= n || typeof edge.type !== 'string') {
      throw new TypeError(`pattern ${pattern.id} has an invalid edge`);
    }
    return {from: edge.from, to: edge.to, type: edge.type};
  });
  const normalizedEdges = edges.map(edgeKey).sort();
  for (const occurrence of pattern.occurrences) {
    if (!Array.isArray(occurrence) || occurrence.length !== n || occurrence.some(index => !Number.isInteger(index) || index < 0 || index >= graph.nodes.length) || new Set(occurrence).size !== n) {
      throw new TypeError(`pattern ${pattern.id} has an invalid occurrence mapping`);
    }
    occurrence.forEach((index, slot) => {
      if (graph.nodes[index].label !== pattern.labels[slot]) throw new TypeError(`pattern ${pattern.id} occurrence label mismatch`);
    });
    const mappedEdges = graph.edges.filter(edge => occurrence.includes(edge.from) && occurrence.includes(edge.to))
      .map(edge => ({from: occurrence.indexOf(edge.from), to: occurrence.indexOf(edge.to), type: edge.type})).map(edgeKey).sort();
    if (canonical(mappedEdges) !== canonical(normalizedEdges)) throw new TypeError(`pattern ${pattern.id} occurrence edge mismatch`);
  }
  const seenOccurrences = new Set();
  for (const occurrence of pattern.occurrences) {
    const key = canonical(occurrence);
    if (seenOccurrences.has(key)) throw new TypeError(`pattern ${pattern.id} repeats an occurrence`);
    seenOccurrences.add(key);
  }
  return {id: pattern.id, labels: [...pattern.labels], edges, occurrences: pattern.occurrences.map(occurrence => [...occurrence])};
}

function permutations(items) {
  if (!items.length) return [[]];
  return items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]));
}

function childMapping(parent, child, available) {
  if (child.labels.length >= parent.labels.length) return null;
  const targetEdges = child.edges.map(edgeKey).sort();
  for (const slots of combinations(available, child.labels.length)) {
    for (const permutation of permutations(slots)) {
      if (child.labels.some((label, index) => parent.labels[permutation[index]] !== label)) continue;
      const mapped = parent.edges.filter(edge => permutation.includes(edge.from) && permutation.includes(edge.to))
        .map(edge => ({from: permutation.indexOf(edge.from), to: permutation.indexOf(edge.to), type: edge.type})).map(edgeKey).sort();
      if (canonical(mapped) === canonical(targetEdges)) return permutation;
    }
  }
  return null;
}

function* combinations(items, size, start = 0, prefix = []) {
  if (prefix.length === size) { yield prefix; return; }
  for (let index = start; index <= items.length - (size - prefix.length); index++) {
    yield* combinations(items, size, index + 1, [...prefix, items[index]]);
  }
}

function decompose(pattern, allPatterns) {
  const occupied = new Set();
  const items = [];
  const children = allPatterns.filter(candidate => candidate.labels.length < pattern.labels.length)
    .sort((a, b) => b.labels.length - a.labels.length || a.id.localeCompare(b.id));
  for (const child of children) {
    const available = pattern.labels.map((_, slot) => slot).filter(slot => !occupied.has(slot));
    const mapping = childMapping(pattern, child, available);
    if (!mapping || mapping.some(slot => occupied.has(slot))) continue;
    mapping.forEach(slot => occupied.add(slot));
    items.push({kind: 'ref', modelId: child.id, slotMap: mapping});
  }
  for (let slot = 0; slot < pattern.labels.length; slot++) if (!occupied.has(slot)) items.push({kind: 'slot', slot});
  items.sort((left, right) => Math.min(...(left.kind === 'slot' ? [left.slot] : left.slotMap)) - Math.min(...(right.kind === 'slot' ? [right.slot] : right.slotMap)) || left.kind.localeCompare(right.kind));
  return items;
}

function templateFor(values) {
  let nextHole = 0;
  function visit(items) {
    if (items.every(value => canonical(value) === canonical(items[0]))) return {ast: {kind: 'constant', value: clone(items[0])}, holes: nextHole};
    const first = items[0];
    if (first && typeof first === 'object' && !Array.isArray(first) && items.every(value => value && typeof value === 'object' && !Array.isArray(value) && canonical(Object.keys(value).sort()) === canonical(Object.keys(first).sort()))) {
      const fields = Object.keys(first).sort().map(key => [key, visit(items.map(value => value[key])).ast]);
      return {ast: {kind: 'object', fields}, holes: nextHole};
    }
    if (Array.isArray(first) && items.every(value => Array.isArray(value) && value.length === first.length)) {
      const entries = first.map((_, index) => visit(items.map(value => value[index])).ast);
      return {ast: {kind: 'array', items: entries}, holes: nextHole};
    }
    const index = nextHole++;
    return {ast: {kind: 'hole', index}, holes: nextHole};
  }
  return visit(values);
}

function residualFor(ast, event) {
  const values = [];
  function visit(node, value) {
    if (node.kind === 'constant') {
      if (canonical(node.value) !== canonical(value)) throw new TypeError('event does not match model template');
      return;
    }
    if (node.kind === 'hole') { values[node.index] = clone(value); return; }
    if (node.kind === 'array') {
      if (!Array.isArray(value) || value.length !== node.items.length) throw new TypeError('event array does not match model template');
      node.items.forEach((child, index) => visit(child, value[index]));
      return;
    }
    if (node.kind === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || canonical(Object.keys(value).sort()) !== canonical(node.fields.map(([key]) => key).sort())) throw new TypeError('event object does not match model template');
      for (const [key, child] of node.fields) visit(child, value[key]);
      return;
    }
    throw new TypeError(`unknown template node ${String(node.kind)}`);
  }
  visit(ast, event);
  if (values.some(value => value === undefined)) throw new TypeError('model residual has an unbound hole');
  return values;
}

function applyTemplate(ast, residual) {
  if (!Array.isArray(residual)) throw new TypeError('model residual must be an array');
  const used = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') throw new TypeError('invalid event template');
    if (node.kind === 'constant') return clone(node.value);
    if (node.kind === 'hole') {
      if (!Number.isInteger(node.index) || node.index < 0 || node.index >= residual.length || used.has(node.index)) throw new TypeError('invalid template residual reference');
      used.add(node.index); return clone(residual[node.index]);
    }
    if (node.kind === 'array' && Array.isArray(node.items)) return node.items.map(visit);
    if (node.kind === 'object' && Array.isArray(node.fields)) return Object.fromEntries(node.fields.map(([key, child]) => {
      if (typeof key !== 'string') throw new TypeError('invalid template object key');
      return [key, visit(child)];
    }));
    throw new TypeError(`invalid event template node ${String(node.kind)}`);
  }
  const value = visit(ast);
  if (used.size !== residual.length) throw new TypeError('model residual has unused or missing values');
  return value;
}

function validateStream(stream) {
  canonical(stream);
  if (!stream || typeof stream !== 'object' || Array.isArray(stream) || !Array.isArray(stream.events)) throw new TypeError('stream must be an object with events[]');
  if (Object.hasOwn(stream, 'diagnosticEvents') && !Array.isArray(stream.diagnosticEvents)) throw new TypeError('diagnosticEvents must be an array when present');
  return buildEventGraph(stream);
}

function modelsFor(roots, allPatterns) {
  const required = new Set();
  function include(id) {
    if (required.has(id)) return;
    required.add(id);
    const pattern = allPatterns.find(candidate => candidate.id === id);
    if (!pattern) throw new TypeError(`unknown nested pattern ${id}`);
    for (const item of decompose(pattern, allPatterns)) if (item.kind === 'ref') include(item.modelId);
  }
  roots.forEach(root => include(root.pattern.id));
  return [...required].map(id => {
    const pattern = allPatterns.find(candidate => candidate.id === id);
    const model = {id, nodeCount: pattern.labels.length, labels: pattern.labels, edges: pattern.edges, decomposition: {items: decompose(pattern, allPatterns)}};
    const root = roots.find(candidate => candidate.pattern.id === id);
    if (root) {
      model.templates = pattern.labels.map((_, slot) => templateFor(root.occurrences.map(occurrence => occurrence.events[slot])).ast);
    }
    return model;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function encodeBundle(stream, graph, patterns, selectedRoots) {
  const rootRows = selectedRoots.map(root => ({
    pattern: root.pattern,
    occurrences: root.occurrences.map(occurrence => ({events: occurrence.events, positions: occurrence.positions})),
  }));
  const models = modelsFor(rootRows, patterns);
  const covered = new Set();
  const records = [];
  for (const root of rootRows) {
    for (const occurrence of root.occurrences) {
      const positions = occurrence.positions;
      if (positions.some(position => covered.has(position))) throw new TypeError('overlapping pattern coverage');
      positions.forEach(position => covered.add(position));
      const model = models.find(candidate => candidate.id === root.pattern.id);
      records.push({kind: 'ref', modelId: root.pattern.id, positions, residuals: model.templates.map((template, slot) => residualFor(template, occurrence.events[slot]))});
    }
  }
  graph.nodes.forEach((node, position) => {
    if (!covered.has(position)) records.push({kind: 'literal', position, event: node.event});
  });
  records.sort((left, right) => Math.min(...(left.kind === 'literal' ? [left.position] : left.positions)) - Math.min(...(right.kind === 'literal' ? [right.position] : right.positions)) || left.kind.localeCompare(right.kind));
  return clone({
    format: FORMAT,
    eventCount: graph.nodes.length,
    metadata: graph.metadata,
    collections: {
      events: {present: true, nodeIndices: graph.collections.events},
      diagnosticEvents: {present: Object.hasOwn(stream, 'diagnosticEvents'), nodeIndices: graph.collections.diagnosticEvents ?? []},
    },
    models,
    records,
  });
}

function normalizedPatterns(patterns, graph) {
  assertArray(patterns, 'patterns');
  const seen = new Set();
  return patterns.map(pattern => {
    const result = validatePattern(pattern, graph);
    if (seen.has(result.id)) throw new TypeError(`duplicate pattern id ${result.id}`);
    seen.add(result.id); return result;
  }).sort((a, b) => b.labels.length - a.labels.length || a.id.localeCompare(b.id));
}

function occurrenceRows(pattern, graph) {
  return pattern.occurrences.map(positions => ({
    positions,
    events: positions.map(index => graph.nodes[index].event),
  })).sort((a, b) => a.positions[0] - b.positions[0] || canonical(a.positions).localeCompare(canonical(b.positions)));
}

function greedyOccurrences(pattern, graph, unavailable = new Set()) {
  const chosen = [], occupied = new Set(unavailable);
  for (const row of occurrenceRows(pattern, graph)) {
    if (row.positions.some(index => occupied.has(index))) continue;
    chosen.push(row);
    // Mark immediately: later rows from this same pattern may overlap this row.
    row.positions.forEach(index => occupied.add(index));
  }
  return chosen;
}

function chooseRoots(stream, graph, patterns) {
  const roots = [];
  let bundle = encodeBundle(stream, graph, patterns, roots);
  let cost = byteLength(bundle);
  const remaining = new Set(patterns.map(pattern => pattern.id));
  while (remaining.size) {
    let best = null;
    for (const pattern of patterns) {
      if (!remaining.has(pattern.id)) continue;
      const occupied = new Set(roots.flatMap(root => root.occurrences.flatMap(row => row.positions)));
      const available = greedyOccurrences(pattern, graph, occupied);
      if (!available.length) { remaining.delete(pattern.id); continue; }
      const candidateRoots = [...roots, {pattern, occurrences: available}];
      const candidate = encodeBundle(stream, graph, patterns, candidateRoots);
      const candidateCost = byteLength(candidate);
      if (candidateCost < cost && (!best || candidateCost < best.cost || candidateCost === best.cost && pattern.id.localeCompare(best.pattern.id) < 0)) {
        best = {pattern, roots: candidateRoots, bundle: candidate, cost: candidateCost};
      }
    }
    if (!best) break;
    roots.splice(0, roots.length, ...best.roots);
    bundle = best.bundle; cost = best.cost; remaining.delete(best.pattern.id);
  }
  return bundle;
}

export function encodeWithPatterns(stream, patterns) {
  const graph = validateStream(stream);
  const candidates = normalizedPatterns(patterns, graph);
  const roots = [], covered = new Set();
  for (const pattern of candidates) {
    const occurrences = greedyOccurrences(pattern, graph, covered);
    if (!occurrences.length) continue;
    occurrences.forEach(row => row.positions.forEach(index => covered.add(index)));
    roots.push({pattern, occurrences});
  }
  return encodeBundle(stream, graph, candidates, roots);
}

function expandModels(models) {
  assertArray(models, 'models');
  const byId = new Map();
  for (const model of models) {
    if (!model || typeof model.id !== 'string' || !model.id || byId.has(model.id)) throw new TypeError('model ids must be unique nonempty strings');
    if (!Number.isInteger(model.nodeCount) || model.nodeCount < 1 || !Array.isArray(model.labels) || model.labels.length !== model.nodeCount || !Array.isArray(model.edges) || !model.decomposition || !Array.isArray(model.decomposition.items)) throw new TypeError(`invalid model ${model.id}`);
    byId.set(model.id, model);
  }
  const active = new Set();
  const cache = new Map();
  function expand(id) {
    if (!byId.has(id)) throw new TypeError(`unknown model reference ${String(id)}`);
    if (active.has(id)) throw new TypeError(`cyclic model reference ${id}`);
    if (cache.has(id)) return cache.get(id);
    active.add(id);
    const model = byId.get(id), slots = [];
    for (const item of model.decomposition.items) {
      if (item.kind === 'slot') {
        if (!Number.isInteger(item.slot) || item.slot < 0 || item.slot >= model.nodeCount) throw new TypeError(`invalid slot in model ${id}`);
        slots.push(item.slot);
      } else if (item.kind === 'ref') {
        const child = byId.get(item.modelId);
        if (!child) throw new TypeError(`unknown nested model reference ${String(item.modelId)}`);
        if (child.id === id) throw new TypeError(`cyclic model reference ${id}`);
        if (!Array.isArray(item.slotMap) || item.slotMap.length !== child.nodeCount || item.slotMap.some(slot => !Number.isInteger(slot) || slot < 0 || slot >= model.nodeCount) || new Set(item.slotMap).size !== child.nodeCount) throw new TypeError(`invalid nested slot map in model ${id}`);
        if (child.nodeCount >= model.nodeCount) throw new TypeError(`nested model ${child.id} is not smaller than ${id}`);
        const childSlots = expand(child.id);
        slots.push(...childSlots.map(childSlot => item.slotMap[childSlot]));
        const expectedEdges = child.edges.map(edge => ({from: item.slotMap[edge.from], to: item.slotMap[edge.to], type: edge.type})).map(edgeKey).sort();
        const actualEdges = model.edges.filter(edge => item.slotMap.includes(edge.from) && item.slotMap.includes(edge.to)).map(edgeKey).sort();
        if (canonical(expectedEdges) !== canonical(actualEdges)) throw new TypeError(`nested model ${child.id} does not match parent ${id}`);
        for (let slot = 0; slot < child.nodeCount; slot++) if (child.labels[slot] !== model.labels[item.slotMap[slot]]) throw new TypeError(`nested model ${child.id} label mismatch in ${id}`);
      } else throw new TypeError(`unknown decomposition item in model ${id}`);
    }
    if (slots.length !== model.nodeCount || new Set(slots).size !== model.nodeCount || slots.some(slot => slot < 0 || slot >= model.nodeCount)) throw new TypeError(`model ${id} decomposition does not cover each slot exactly once`);
    const sorted = [...slots].sort((a, b) => a - b);
    if (sorted.some((slot, index) => slot !== index)) throw new TypeError(`model ${id} decomposition has missing slots`);
    if (model.templates !== undefined && (!Array.isArray(model.templates) || model.templates.length !== model.nodeCount)) throw new TypeError(`model ${id} has invalid templates`);
    active.delete(id); cache.set(id, sorted); return sorted;
  }
  for (const model of models) expand(model.id);
  return {byId, expand};
}

export function decompress(bundle) {
  canonical(bundle);
  if (!bundle || bundle.format !== FORMAT || !Number.isInteger(bundle.eventCount) || bundle.eventCount < 0 || !bundle.collections || !bundle.metadata || typeof bundle.metadata !== 'object' || Array.isArray(bundle.metadata)) throw new TypeError('invalid compressed stream header');
  const {byId, expand} = expandModels(bundle.models);
  assertArray(bundle.records, 'records');
  const events = new Array(bundle.eventCount), covered = new Set();
  const place = (position, event) => {
    if (!Number.isInteger(position) || position < 0 || position >= bundle.eventCount || covered.has(position)) throw new TypeError(`duplicate or invalid event coverage position ${String(position)}`);
    canonical(event); events[position] = clone(event); covered.add(position);
  };
  for (const record of bundle.records) {
    if (record.kind === 'literal') place(record.position, record.event);
    else if (record.kind === 'ref') {
      const model = byId.get(record.modelId);
      if (!model) throw new TypeError(`unknown root model reference ${String(record.modelId)}`);
      const slots = expand(record.modelId);
      if (!model.templates || !Array.isArray(record.positions) || record.positions.length !== model.nodeCount || !Array.isArray(record.residuals) || record.residuals.length !== model.nodeCount) throw new TypeError(`invalid occurrence for model ${model.id}`);
      const expandedEvents = model.templates.map((template, slot) => applyTemplate(template, record.residuals[slot]));
      for (let slot = 0; slot < slots.length; slot++) place(record.positions[slots[slot]], expandedEvents[slots[slot]]);
    } else throw new TypeError(`unknown event record kind ${String(record.kind)}`);
  }
  if (covered.size !== bundle.eventCount) throw new TypeError('compressed stream has incomplete event coverage');
  function restore(name, required) {
    const descriptor = bundle.collections[name];
    if (!descriptor || typeof descriptor.present !== 'boolean' || !Array.isArray(descriptor.nodeIndices)) throw new TypeError(`invalid ${name} collection mapping`);
    if (required && !descriptor.present) throw new TypeError(`required ${name} collection is absent`);
    if (!descriptor.present && descriptor.nodeIndices.length) throw new TypeError(`absent ${name} collection has mapped events`);
    const output = new Array(descriptor.nodeIndices.length);
    descriptor.nodeIndices.forEach((nodeIndex, collectionIndex) => {
      if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= events.length || output[collectionIndex] !== undefined) throw new TypeError(`invalid ${name} collection mapping`);
      output[collectionIndex] = events[nodeIndex];
    });
    return output;
  }
  const restoredEvents = restore('events', true), restoredDiagnostics = restore('diagnosticEvents', false);
  const mappedCount = bundle.collections.events.nodeIndices.length + bundle.collections.diagnosticEvents.nodeIndices.length;
  if (mappedCount !== events.length || [...bundle.collections.events.nodeIndices, ...bundle.collections.diagnosticEvents.nodeIndices].some(index => !covered.has(index)) || new Set([...bundle.collections.events.nodeIndices, ...bundle.collections.diagnosticEvents.nodeIndices]).size !== events.length) throw new TypeError('collection maps do not cover each event exactly once');
  const result = clone(bundle.metadata);
  result.events = restoredEvents;
  if (bundle.collections.diagnosticEvents.present) result.diagnosticEvents = restoredDiagnostics;
  return result;
}

export function compressStream(stream, {maxNodes = 4, beamWidth = 16, patterns: suppliedPatterns = null} = {}) {
  const graph = validateStream(stream);
  const patterns = suppliedPatterns ?? discoverPatterns(graph, {
    maxNodes,
    beamWidth,
    scorePattern: pattern => byteLength(encodeWithPatterns(stream, [pattern])),
  });
  const bundle = chooseRoots(stream, graph, normalizedPatterns(patterns, graph));
  const rawBytes = byteLength(stream), encodedBytes = byteLength(bundle);
  return {
    bundle,
    stats: {rawBytes, encodedBytes, savedBytes: rawBytes - encodedBytes, ratio: rawBytes === 0 ? 0 : encodedBytes / rawBytes},
    patterns: clone(patterns),
  };
}
