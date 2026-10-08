import {canonical, clone} from './canonical.mjs';
import {buildEventGraph} from './graph.mjs';
import {discoverPatterns} from './discovery.mjs';
import {resolveProvider} from '../block5/core/providers.mjs';

const FEEDBACK_FORMAT = 'pagerouter.composed-calculation.v1';
const MAX_PROGRAMS = 128;

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function providerIdentityOf(events) {
  const providerIdentity = events[0]?.provider;
  if (!providerIdentity || typeof providerIdentity !== 'object' || Array.isArray(providerIdentity) ||
    typeof providerIdentity.id !== 'string' || typeof providerIdentity.version !== 'string' ||
    typeof providerIdentity.implementationId !== 'string') {
    throw new TypeError('Calculation event must retain provider id, version, and implementationId.');
  }
  const expectedKeys = ['id', 'implementationId', 'version'];
  if (canonical(Object.keys(providerIdentity).sort()) !== canonical(expectedKeys)) {
    throw new TypeError('Calculation provider identity must contain exactly id, version, and implementationId.');
  }
  const key = canonical(providerIdentity);
  for (const event of events) {
    if (canonical(event.provider) !== key) throw new TypeError('A feedback motif cannot mix provider identities.');
    if (typeof event.calculation !== 'string' || !event.calculation) throw new TypeError('Calculation event needs a registry calculation name.');
    resolveProvider(event.calculation, providerIdentity);
  }
  return clone(providerIdentity);
}

function topologicalOrder(graph, localIndices) {
  const included = new Set(localIndices);
  const indegree = new Map(localIndices.map(index => [index, 0]));
  const outgoing = new Map(localIndices.map(index => [index, []]));
  for (const edge of graph.edges) {
    if (edge.type !== 'dependency' || !included.has(edge.from) || !included.has(edge.to)) continue;
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const rank = index => graph.nodes[index].index;
  const ready = localIndices.filter(index => indegree.get(index) === 0).sort((a, b) => rank(a) - rank(b));
  const ordered = [];
  while (ready.length) {
    const index = ready.shift();
    ordered.push(index);
    for (const next of outgoing.get(index)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
        ready.sort((a, b) => rank(a) - rank(b));
      }
    }
  }
  if (ordered.length !== localIndices.length) throw new TypeError('Discovered calculation motif has a dependency cycle.');
  return ordered;
}

function pathShape(pattern) {
  if (pattern.edges.length !== pattern.labels.length - 1) return false;
  const degree = Array(pattern.labels.length).fill(0);
  for (const edge of pattern.edges) {
    if (edge.type !== 'dependency') return false;
    degree[edge.from] += 1;
    degree[edge.to] += 1;
  }
  return degree.every(value => value <= 2) && degree.filter(value => value === 1).length === 2;
}

function occurrenceProgram(pattern, occurrence, graph, calculationNodes, id) {
  const orderedLocalIndices = topologicalOrder(graph, occurrence);
  const orderedRows = orderedLocalIndices.map(index => calculationNodes[index]);
  const orderedEvents = orderedRows.map(row => row.event);
  const providerIdentity = providerIdentityOf(orderedEvents);

  const localIdByOutputRef = new Map();
  const allOutputRefs = new Set();
  for (const event of orderedEvents) {
    if (typeof event.outputRef !== 'string' || !event.outputRef || allOutputRefs.has(event.outputRef)) {
      throw new TypeError(`Feedback motif has a missing or duplicate outputRef at event ${String(event.id)}.`);
    }
    allOutputRefs.add(event.outputRef);
  }

  const inputs = [];
  const externalBySource = new Map();
  const externalByPortKey = new Map();
  const nodes = [];
  const outputs = [];

  for (const [index, event] of orderedEvents.entries()) {
    if (!Array.isArray(event.inputRefs) || event.inputRefs.length !== 2 || !Array.isArray(event.inputs) || event.inputs.length !== 2) {
      throw new TypeError(`Calculation event ${event.id} must retain two ordered input refs and values.`);
    }
    const bindings = [];
    for (let inputIndex = 0; inputIndex < 2; inputIndex += 1) {
      const sourceRef = event.inputRefs[inputIndex];
      const inputValue = event.inputs[inputIndex];
      if (typeof sourceRef !== 'string' || !sourceRef) throw new TypeError(`Calculation event ${event.id} has an invalid input ref.`);
      const parentNodeId = localIdByOutputRef.get(sourceRef);
      if (parentNodeId !== undefined) {
        const parent = orderedEvents[Number(parentNodeId.slice(1))];
        if (canonical(parent.output) !== canonical(inputValue)) {
          throw new TypeError(`Internal sourceRef ${sourceRef} has a retained input value mismatch.`);
        }
        bindings.push({kind: 'node', nodeId: parentNodeId});
        continue;
      }
      if (allOutputRefs.has(sourceRef)) {
        throw new TypeError(`Internal sourceRef ${sourceRef} points to a later or cyclic motif node.`);
      }

      const valueKey = canonical(inputValue);
      if (externalBySource.has(sourceRef) && externalBySource.get(sourceRef) !== valueKey) {
        throw new TypeError(`External sourceRef ${sourceRef} has different values inside one motif.`);
      }
      externalBySource.set(sourceRef, valueKey);
      const portKey = canonical([sourceRef, valueKey]);
      let port = externalByPortKey.get(portKey);
      if (port === undefined) {
        port = `i${inputs.length}`;
        externalByPortKey.set(portKey, port);
        inputs.push({port, sourceRef, defaultValue: clone(inputValue)});
      }
      bindings.push({kind: 'input', port});
    }
    const nodeId = `n${index}`;
    nodes.push({id: nodeId, calculation: event.calculation, inputs: bindings});
    outputs.push({port: `o${index}`, nodeId});
    localIdByOutputRef.set(event.outputRef, nodeId);
  }

  return {
    program: {
      format: FEEDBACK_FORMAT,
      id,
      providerIdentity,
      inputs,
      nodes,
      outputs,
      training: {
        patternId: pattern.id,
        eventIds: orderedEvents.map(event => event.id),
        occurrenceCount: pattern.occurrences.length,
      },
    },
    signature: canonical({
      providerIdentity,
      nodes: nodes.map(node => ({calculation: node.calculation, inputs: node.inputs})),
    }),
  };
}

export function discoverCalculations(stream, {maxNodes = 4, beamWidth = 16} = {}) {
  const graph = buildEventGraph(stream);
  const calculationRows = graph.nodes.filter(node => node.event.kind === 'calculation');
  const localByGraphIndex = new Map(calculationRows.map((node, index) => [node.index, index]));
  const projection = {
    nodes: calculationRows.map((node, index) => ({index, label: node.label})),
    edges: graph.edges.filter(edge => edge.type === 'dependency' && localByGraphIndex.has(edge.from) && localByGraphIndex.has(edge.to))
      .map(edge => ({from: localByGraphIndex.get(edge.from), to: localByGraphIndex.get(edge.to), type: edge.type})),
  };
  const repeated = discoverPatterns(projection, {maxNodes, beamWidth})
    .filter(pattern => pattern.labels.length >= 2 && pattern.occurrences.length >= 2)
    .sort((left, right) => Number(pathShape(right)) - Number(pathShape(left)) ||
      left.labels.length - right.labels.length || right.occurrences.length - left.occurrences.length || left.id.localeCompare(right.id));
  const programs = [];

  for (const [candidateIndex, pattern] of repeated.entries()) {
    let representative = null;
    for (const occurrence of pattern.occurrences) {
      let candidate;
      try {
        candidate = occurrenceProgram(pattern, occurrence, graph, calculationRows, `feedback-${candidateIndex}`);
      } catch (error) {
        // A repeated structural motif may have ambiguous provenance in one
        // occurrence. Reject that motif while retaining other valid motifs.
        if (error instanceof TypeError) {
          representative = null;
          break;
        }
        throw error;
      }
      if (!representative) representative = candidate;
      else if (candidate.signature !== representative.signature) {
        representative = null;
        break;
      }
    }
    if (representative) programs.push(freezeTree(representative.program));
    if (programs.length >= MAX_PROGRAMS) break;
  }
  return programs;
}
