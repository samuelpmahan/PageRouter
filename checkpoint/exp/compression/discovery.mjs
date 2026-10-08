import {canonical} from './canonical.mjs';

// Search is exact inside each considered beam frontier, then heuristic across frontiers.
// maxNodes is at most six, beamWidth at most 128, and each size considers at most 20,000 subsets.
// A supplied scorer must return the complete encoded byte cost; structural fallback is not MDL.
const MAX_NODES = 6;
const MAX_BEAM_WIDTH = 128;
const MAX_SUBSETS_PER_SIZE = 20_000;

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareVectors(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function freezePattern(pattern) {
  for (const edge of pattern.edges) Object.freeze(edge);
  pattern.edges = Object.freeze(pattern.edges);
  for (const occurrence of pattern.occurrences) Object.freeze(occurrence);
  pattern.occurrences = Object.freeze(pattern.occurrences);
  pattern.labels = Object.freeze(pattern.labels);
  return Object.freeze(pattern);
}

function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('Graph must contain nodes and edges arrays.');
  }
  graph.nodes.forEach((node, index) => {
    if (!node || node.index !== index || typeof node.label !== 'string') {
      throw new TypeError(`Graph node ${index} must have its matching index and a string label.`);
    }
  });
  graph.edges.forEach((edge, index) => {
    if (!edge || !Number.isInteger(edge.from) || !Number.isInteger(edge.to) ||
      edge.from < 0 || edge.to < 0 || edge.from >= graph.nodes.length || edge.to >= graph.nodes.length ||
      typeof edge.type !== 'string' || edge.type.length === 0) {
      throw new TypeError(`Graph edge ${index} has an invalid endpoint or type.`);
    }
  });
}

function permutations(values) {
  const result = [];
  const current = [];
  const used = Array(values.length).fill(false);
  function visit() {
    if (current.length === values.length) {
      result.push([...current]);
      return;
    }
    for (let index = 0; index < values.length; index += 1) {
      if (used[index]) continue;
      used[index] = true;
      current.push(values[index]);
      visit();
      current.pop();
      used[index] = false;
    }
  }
  visit();
  return result;
}

function canonicalizeOccurrence(graph, nodeIndices) {
  const selected = new Set(nodeIndices);
  let best = null;
  for (const occurrence of permutations([...nodeIndices].sort((a, b) => a - b))) {
    const slotForNode = new Map(occurrence.map((nodeIndex, slot) => [nodeIndex, slot]));
    const labels = occurrence.map((nodeIndex) => graph.nodes[nodeIndex].label);
    const edges = graph.edges
      .filter((edge) => selected.has(edge.from) && selected.has(edge.to))
      .map((edge) => ({from: slotForNode.get(edge.from), to: slotForNode.get(edge.to), type: edge.type}))
      .sort((left, right) => left.from - right.from || left.to - right.to || compareStrings(left.type, right.type));
    const key = canonical({labels, edges});
    if (best === null || key < best.key || (key === best.key && compareVectors(occurrence, best.occurrence) < 0)) {
      best = {key, labels, edges, occurrence};
    }
  }
  return best;
}

function addOccurrence(patterns, graph, nodeIndices, size) {
  const normalized = canonicalizeOccurrence(graph, nodeIndices);
  let record = patterns.get(normalized.key);
  if (!record) {
    record = {key: normalized.key, id: `p:${normalized.key}`, labels: normalized.labels, edges: normalized.edges, occurrenceMap: new Map()};
    patterns.set(normalized.key, record);
    if (patterns.size > MAX_SUBSETS_PER_SIZE) {
      throw new RangeError(`Discovery exceeds limit ${MAX_SUBSETS_PER_SIZE} at size ${size}: distinct patterns.`);
    }
  }
  record.occurrenceMap.set(normalized.occurrence.join(','), normalized.occurrence);
  if (record.occurrenceMap.size > MAX_SUBSETS_PER_SIZE) {
    throw new RangeError(`Discovery exceeds limit ${MAX_SUBSETS_PER_SIZE} at size ${size}: occurrences for one pattern.`);
  }
}

function finalizeLevel(records) {
  return new Map([...records].map(([key, record]) => {
    const occurrences = [...record.occurrenceMap.values()].sort(compareVectors);
    return [key, freezePattern({
      id: record.id,
      labels: [...record.labels],
      edges: record.edges.map((edge) => ({...edge})),
      occurrences: occurrences.map((occurrence) => [...occurrence]),
    })];
  }));
}

function createComparator(scorePattern, scores) {
  if (scorePattern) {
    return (left, right) => scores.get(left.id) - scores.get(right.id) || compareStrings(left.id, right.id);
  }
  return (left, right) => right.occurrences.length - left.occurrences.length ||
    right.labels.length - left.labels.length || compareStrings(left.id, right.id);
}

function scoreLevel(patterns, scorePattern, scores) {
  if (!scorePattern) return;
  for (const pattern of patterns.values()) {
    const score = scorePattern(pattern);
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      throw new TypeError('scorePattern must return a finite, non-negative byte cost.');
    }
    scores.set(pattern.id, score);
  }
}

export function discoverPatterns(graph, {maxNodes = 4, beamWidth = 16, scorePattern} = {}) {
  validateGraph(graph);
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_NODES) {
    throw new RangeError(`maxNodes must be an integer from 1 to ${MAX_NODES}.`);
  }
  if (!Number.isInteger(beamWidth) || beamWidth < 1 || beamWidth > MAX_BEAM_WIDTH) {
    throw new RangeError(`beamWidth must be an integer from 1 to ${MAX_BEAM_WIDTH}.`);
  }
  if (scorePattern !== undefined && typeof scorePattern !== 'function') {
    throw new TypeError('scorePattern must be a function when provided.');
  }
  if (graph.nodes.length > MAX_SUBSETS_PER_SIZE) {
    throw new RangeError(`Discovery exceeds limit ${MAX_SUBSETS_PER_SIZE} at size 1: graph nodes.`);
  }
  if (graph.nodes.length === 0) return [];

  const neighbors = graph.nodes.map(() => new Set());
  for (const edge of graph.edges) {
    if (edge.from !== edge.to) {
      neighbors[edge.from].add(edge.to);
      neighbors[edge.to].add(edge.from);
    }
  }

  const scores = new Map();
  const all = new Map();
  let records = new Map();
  for (let index = 0; index < graph.nodes.length; index += 1) addOccurrence(records, graph, [index], 1);
  let frontier = finalizeLevel(records);
  scoreLevel(frontier, scorePattern, scores);
  for (const [key, pattern] of frontier) all.set(key, pattern);
  const compare = createComparator(scorePattern, scores);

  for (let size = 1; size < maxNodes && frontier.size > 0; size += 1) {
    const parents = [...frontier.values()].sort(compare).slice(0, beamWidth);
    const nextSubsets = new Map();
    for (const pattern of parents) {
      for (const occurrence of pattern.occurrences) {
        const selected = new Set(occurrence);
        const expansion = new Set();
        for (const nodeIndex of occurrence) {
          for (const neighbor of neighbors[nodeIndex]) if (!selected.has(neighbor)) expansion.add(neighbor);
        }
        for (const neighbor of [...expansion].sort((a, b) => a - b)) {
          const subset = [...occurrence, neighbor].sort((a, b) => a - b);
          const subsetKey = subset.join(',');
          nextSubsets.set(subsetKey, subset);
          if (nextSubsets.size > MAX_SUBSETS_PER_SIZE) {
            throw new RangeError(`Discovery exceeds limit ${MAX_SUBSETS_PER_SIZE} at size ${size + 1}: connected subsets.`);
          }
        }
      }
    }
    records = new Map();
    for (const subset of nextSubsets.values()) addOccurrence(records, graph, subset, size + 1);
    frontier = finalizeLevel(records);
    scoreLevel(frontier, scorePattern, scores);
    for (const [key, pattern] of frontier) all.set(key, pattern);
  }

  return [...all.values()].sort(compare);
}
