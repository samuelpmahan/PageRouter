import {Part, PxC} from '../../vendor/hh/services/pxc.mjs';
import {node} from '../../vendor/hh/src/teacher-journey.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const EVENT_TAGS = Object.freeze(['enable', 'disable']);
const STATE_TAGS = Object.freeze(['hidden', 'visible']);
const clone = (value) => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const getPath = (value, path) => String(path || '').split('.').reduce((current, key) => current != null && own(Object(current), key) ? current[key] : undefined, value);

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeTree(child);
  return value;
}

function isPlainData(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
  seen.add(value);
  let valid = true;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') { valid = false; break; }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !isPlainData(descriptor.value, seen)) { valid = false; break; }
  }
  seen.delete(value);
  return valid;
}

function normalizePorts(ports, label) {
  if (!Array.isArray(ports)) throw new TypeError(`${label} must be an array of ports.`);
  const names = new Set();
  return freezeTree(ports.map((port) => {
    if (!port || typeof port !== 'object' || !ID.test(port.name) || typeof port.type !== 'string' || !ID.test(port.type) || names.has(port.name)) {
      throw new TypeError(`${label} ports need unique names and a simple type.`);
    }
    names.add(port.name);
    const tags = port.tags === undefined ? undefined : port.tags;
    if (tags !== undefined && (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== 'string' || !ID.test(tag)) || new Set(tags).size !== tags.length)) {
      throw new TypeError(`Tagged port ${port.name} needs distinct string alternatives.`);
    }
    const endpointKey = label === 'consumes' ? 'target' : label === 'emits' ? 'source' : null;
    let endpoint;
    if (endpointKey && port[endpointKey] !== undefined) {
      const ref = port[endpointKey];
      if (!ref || !ID.test(ref.node) || !ID.test(ref.port)) throw new TypeError(`${label} endpoint for ${port.name} is invalid.`);
      endpoint = {[endpointKey]: {node: ref.node, port: ref.port}};
    }
    if (port.requestPath !== undefined && (typeof port.requestPath !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(port.requestPath))) throw new TypeError(`Input requestPath for ${port.name} is invalid.`);
    return {name: port.name, type: port.type, ...(tags ? {tags: [...tags]} : {}), ...(endpoint || {}), ...(port.requestPath ? {requestPath: port.requestPath} : {})};
  }));
}

function normalizeGuarantees(guarantees) {
  if (!Array.isArray(guarantees) || !isPlainData(guarantees)) throw new TypeError('guarantees must be a data-only array.');
  return freezeTree(clone(guarantees));
}

function normalizeFG(value) {
  if (!value || typeof value !== 'object' || !ID.test(value.id) || !['leaf', 'composed'].includes(value.kind) ||
      !Array.isArray(value.consumes) || !Array.isArray(value.emits) || !Array.isArray(value.guarantees) || !value.internalGraph) {
    throw new TypeError('Expected an AnnotationFG leaf or composed contract.');
  }
  return value;
}

function findPort(fg, direction, name) {
  return fg[direction].find((port) => port.name === name) || null;
}

function assertCompatible(source, target) {
  if (source.type !== target.type) throw new TypeError(`Port type mismatch: ${source.type} cannot feed ${target.type}.`);
  if (source.tags && target.tags && source.tags.some((tag) => !target.tags.includes(tag))) {
    throw new TypeError(`Tagged port alternatives are incompatible: ${source.tags.join(', ')} cannot feed ${target.tags.join(', ')}.`);
  }
}

function normalizeChildren(children) {
  if (!Array.isArray(children) || !children.length) throw new TypeError('A composed AnnotationFG needs child FGs.');
  const seen = new Set();
  return children.map((entry) => {
    const child = entry?.fg ? {id: entry.id, fg: normalizeFG(entry.fg), ...(entry.calculation ? {calculation: entry.calculation} : {}), ...(entry.sourceAddress ? {sourceAddress: entry.sourceAddress} : {})} : {id: entry?.id || entry?.fg?.id, fg: normalizeFG(entry?.fg || entry)};
    if (!ID.test(child.id) || seen.has(child.id)) throw new TypeError('Child node IDs must be unique simple names.');
    if (child.calculation !== undefined && !/^annotation\.[A-Za-z][A-Za-z0-9_.-]*$/.test(child.calculation)) throw new TypeError('Child Calculation address must be an annotation Part address.');
    if (child.sourceAddress !== undefined && !/^annotation\.[A-Za-z][A-Za-z0-9_.-]*$/.test(child.sourceAddress)) throw new TypeError('Child source Part address must be an annotation Part address.');
    seen.add(child.id);
    return child;
  });
}

function composeFG({id, children, bindings = [], consumes = [], emits = [], guarantees = []} = {}) {
  if (!ID.test(id)) throw new TypeError('Composed AnnotationFG needs a simple ID.');
  const normalizedChildren = normalizeChildren(children);
  const inputs = normalizePorts(consumes, 'consumes');
  const outputs = normalizePorts(emits, 'emits');
  const declaredGuarantees = normalizeGuarantees(guarantees);
  if (!Array.isArray(bindings) || !isPlainData(bindings)) throw new TypeError('bindings must be data-only wiring records.');
  const usedTargets = new Set();
  const wires = bindings.map((binding) => {
    const sourceNode = normalizedChildren.find((child) => child.id === binding?.from?.node);
    const targetNode = normalizedChildren.find((child) => child.id === binding?.to?.node);
    const source = sourceNode && findPort(sourceNode.fg, 'emits', binding.from.port);
    const target = targetNode && findPort(targetNode.fg, 'consumes', binding.to.port);
    if (!source || !target) throw new TypeError('Each binding must connect a child emit port to a child consume port.');
    assertCompatible(source, target);
    const key = `${binding.to.node}.${binding.to.port}`;
    if (usedTargets.has(key)) throw new TypeError(`Input port is wired more than once: ${key}`);
    usedTargets.add(key);
    return freezeTree({from: {node: sourceNode.id, port: source.name}, to: {node: targetNode.id, port: target.name}, type: source.type,
      ...(source.tags ? {tags: [...source.tags]} : {})});
  });
  const externalInputs = inputs.map((input) => {
    if (!input.target) return {port: input.name, type: input.type, ...(input.tags ? {tags: input.tags} : {})};
    const child = normalizedChildren.find((item) => item.id === input.target.node);
    const target = child && findPort(child.fg, 'consumes', input.target.port);
    if (!target) throw new TypeError(`External input ${input.name} does not target a child consume port.`);
    assertCompatible(input, target);
    return {port: input.name, type: input.type, target: input.target, requestPath: input.requestPath || input.name, ...(input.tags ? {tags: input.tags} : {})};
  });
  const externalOutputs = outputs.map((output) => {
    if (!output.source) return {port: output.name, type: output.type, ...(output.tags ? {tags: output.tags} : {})};
    const child = normalizedChildren.find((item) => item.id === output.source.node);
    const source = child && findPort(child.fg, 'emits', output.source.port);
    if (!source) throw new TypeError(`External output ${output.name} does not read a child emit port.`);
    assertCompatible(source, output);
    return {port: output.name, type: output.type, source: output.source, ...(output.tags ? {tags: output.tags} : {})};
  });
  const nodes = normalizedChildren.map(({id: childId, fg, calculation, sourceAddress}) => freezeTree({id: childId, fg, ...(calculation ? {calculation} : {}), ...(sourceAddress ? {sourceAddress} : {})}));
  const internalGraph = freezeTree({nodes, bindings: wires, externalInputs, externalOutputs});
  return freezeTree({id, kind: 'composed', consumes: inputs, emits: outputs, guarantees: declaredGuarantees, internalGraph});
}

export const AnnotationFG = Object.freeze({
  leaf({id, consumes = [], emits = [], guarantees = []} = {}) {
    if (!ID.test(id)) throw new TypeError('Leaf AnnotationFG needs a simple ID.');
    const inputs = normalizePorts(consumes, 'consumes');
    const outputs = normalizePorts(emits, 'emits');
    const declaredGuarantees = normalizeGuarantees(guarantees);
    return freezeTree({id, kind: 'leaf', consumes: inputs, emits: outputs, guarantees: declaredGuarantees,
      internalGraph: {nodes: [{id, kind: 'leaf'}], bindings: [], externalInputs: inputs, externalOutputs: outputs}});
  },
  compose: composeFG,
});

function markerRecords(issues, context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context) || !isPlainData(context)) throw new TypeError('Annotation seek context must be plain inert geometry data.');
  const markers = context.markers ?? [];
  if (!Array.isArray(markers)) throw new TypeError('context.markers must be an array.');
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return freezeTree(markers.map((marker) => {
    if (!marker || typeof marker.id !== 'string' || !byId.has(marker.id)) throw new TypeError(`Unknown issue marker ID: ${String(marker?.id)}`);
    for (const key of ['x', 'y']) if (!Number.isFinite(marker[key])) throw new TypeError(`Marker ${marker.id} needs finite ${key} geometry.`);
    for (const key of ['width', 'height']) if (!Number.isFinite(marker[key]) || marker[key] < 0) throw new TypeError(`Marker ${marker.id} needs finite nonnegative ${key} geometry.`);
    const issue = byId.get(marker.id);
    const number = marker.number ?? issue.number;
    const title = marker.title ?? issue.title;
    if (!(typeof number === 'number' && Number.isFinite(number)) || typeof title !== 'string') throw new TypeError(`Marker ${marker.id} needs an issue number and title.`);
    return freezeTree({id: marker.id, number, title, x: marker.x, y: marker.y, width: marker.width, height: marker.height});
  }));
}

function makeProjection(state, markers) {
  const visible = state.tag === 'visible';
  const children = visible ? markers.map((marker) => node('span', {
    class: 'annotation-issue-marker',
    'data-annotation-marker': marker.id,
    'data-issue-id': marker.id,
    'data-issue-number': String(marker.number),
    'aria-label': `Issue ${marker.number}: ${marker.title}`,
    style: `left:${marker.x}px;top:${marker.y}px;width:${marker.width}px;height:${marker.height}px;`,
  }, String(marker.number))) : [];
  return freezeTree(node('div', {class: 'annotation-overlay', 'data-annotation-state': state.tag, hidden: !visible}, children));
}

function validateIssues(value) {
  if (!Array.isArray(value) || !isPlainData(value)) throw new TypeError('issues must be a data-only array.');
  const seen = new Set();
  return freezeTree(value.map((issue) => {
    if (!issue || !ID.test(issue.id) || seen.has(issue.id) || !Number.isFinite(issue.number) || typeof issue.title !== 'string') {
      throw new TypeError('Each issue needs a unique id, finite number, and title.');
    }
    seen.add(issue.id);
    return {id: issue.id, number: issue.number, title: issue.title};
  }));
}

function makeRuntimeFG() {
  const event = AnnotationFG.leaf({id: 'annotation-event',
    consumes: [{name: 'event', type: 'annotation-event', tags: EVENT_TAGS}],
    emits: [{name: 'event', type: 'annotation-event', tags: EVENT_TAGS}],
    guarantees: [{when: 'event.type=enable', emits: 'enable'}, {when: 'event.type=disable', emits: 'disable'}]});
  const transition = AnnotationFG.leaf({id: 'annotation-transition',
    consumes: [{name: 'event', type: 'annotation-event', tags: EVENT_TAGS}, {name: 'state', type: 'annotation-state', tags: STATE_TAGS}],
    emits: [{name: 'state', type: 'annotation-state', tags: STATE_TAGS}],
    guarantees: [{when: 'enable', emits: 'visible'}, {when: 'disable', emits: 'hidden'}]});
  const seek = AnnotationFG.leaf({id: 'annotation-seek',
    consumes: [{name: 'state', type: 'annotation-state', tags: STATE_TAGS}, {name: 'context', type: 'geometry-context'}],
    emits: [{name: 'projection', type: 'ui-tree'}],
    guarantees: [{when: 'hidden', emits: 'empty-marker-layer'}, {when: 'visible', emits: 'measured-issue-markers'}]});
  const state = AnnotationFG.leaf({id: 'annotation-current-state', consumes: [],
    emits: [{name: 'state', type: 'annotation-state', tags: STATE_TAGS}], guarantees: [{initial: 'hidden'}]});
  return AnnotationFG.compose({id: 'annotation-toggle-overlay', children: [
    {id: 'currentState', fg: state, sourceAddress: 'annotation.state.current'},
    {id: 'event', fg: event, calculation: 'annotation.event'},
    {id: 'transition', fg: transition, calculation: 'annotation.transition'},
    {id: 'seek', fg: seek, calculation: 'annotation.seek'},
  ], bindings: [
    {from: {node: 'event', port: 'event'}, to: {node: 'transition', port: 'event'}},
    {from: {node: 'currentState', port: 'state'}, to: {node: 'transition', port: 'state'}},
    {from: {node: 'transition', port: 'state'}, to: {node: 'seek', port: 'state'}},
  ], consumes: [
    {name: 'event', type: 'annotation-event', tags: EVENT_TAGS, target: {node: 'event', port: 'event'}, requestPath: 'event'},
    {name: 'context', type: 'geometry-context', target: {node: 'seek', port: 'context'}, requestPath: 'context'},
  ], emits: [
    {name: 'state', type: 'annotation-state', tags: STATE_TAGS, source: {node: 'transition', port: 'state'}},
    {name: 'projection', type: 'ui-tree', source: {node: 'seek', port: 'projection'}},
  ], guarantees: [
    {when: 'enable', emits: 'visible annotation markers'},
    {when: 'disable', emits: 'hidden empty layer'},
    {when: 'seek', transition: false},
  ]});
}

export function createAnnotationRuntime({issues: issueData = [], fg: suppliedFG} = {}) {
  const issues = validateIssues(issueData);
  const fg = suppliedFG ? normalizeFG(suppliedFG) : makeRuntimeFG();
  const pxc = new PxC();
  const calcParts = new Map();
  const addCalculation = (address, kind, calculate) => {
    const part = new Part(calculate);
    pxc.set(address, part);
    calcParts.set(part, kind);
    return address;
  };
  addCalculation('annotation.event', 'event', ({event}) => {
    if (!event || !EVENT_TAGS.includes(event.type)) throw new TypeError('Annotation event type must be enable or disable.');
    return freezeTree({tag: event.type});
  });
  addCalculation('annotation.transition', 'transition', ({state, event}) => {
    const tag = event.tag === 'enable' ? 'visible' : event.tag === 'disable' ? 'hidden' : null;
    if (!STATE_TAGS.includes(state?.tag) || !tag) throw new TypeError('Transition needs a hidden/visible state and a tagged event.');
    return freezeTree({tag, previous: state.tag, event: event.tag, changed: state.tag !== tag});
  });
  addCalculation('annotation.seek', 'projection', ({state, context}) => {
    if (!STATE_TAGS.includes(state?.tag)) throw new TypeError('Seek needs a hidden or visible state.');
    return makeProjection(state, context.markers);
  });
  addCalculation('annotation.port-select', 'port-select', ({result, request}) => {
    if (!result || !own(result, request?.port)) throw new TypeError(`Nested AnnotationFG did not emit ${String(request?.port)}.`);
    return result[request.port];
  });
  let stateAddress = 'annotation.state.initial';
  pxc.set(stateAddress, new Part(freezeTree({tag: 'hidden'})));
  let sequence = 0;

  function prepareGraph(graph, path = 'root') {
    const preparedNodes = graph.internalGraph.nodes.map((nodeInfo) => {
      if (nodeInfo.sourceAddress) return {...nodeInfo, actualSource: nodeInfo.sourceAddress === 'annotation.state.current' ? 'annotation.state.current' : nodeInfo.sourceAddress};
      if (nodeInfo.calculation) return {...nodeInfo, actualCalculation: nodeInfo.calculation};
      if (nodeInfo.fg.kind !== 'composed') throw new TypeError(`Leaf node ${nodeInfo.id} must reference a function Part.`);
      const childGraph = prepareGraph(nodeInfo.fg, `${path}_${nodeInfo.id}`);
      const address = `annotation.nested.${path}_${nodeInfo.id}`;
      addCalculation(address, 'nested-wrapper', async (inputs) => runGraph(childGraph, inputs));
      return {...nodeInfo, childGraph, actualCalculation: address};
    });
    return {definition: graph, nodes: preparedNodes};
  }

  const executableGraph = prepareGraph(fg);

  async function runGraph(graphPlan, externalValues) {
    const graph = graphPlan.definition.internalGraph;
    const tick = ++sequence;
    const nodePorts = new Map();
    const externalPorts = new Map();
    for (const input of graph.externalInputs) {
      if (!input.target) continue;
      const value = getPath(externalValues, input.requestPath || input.port);
      if (value === undefined) throw new TypeError(`Missing external AnnotationFG input: ${input.port}`);
      const address = `annotation.input.graph.${tick}.${input.target.node}.${input.target.port}`;
      const partValue = input.type === 'geometry-context' && Array.isArray(value) ? {markers: value} : value;
      pxc.set(address, new Part(freezeTree(clone(partValue))));
      externalPorts.set(`${input.target.node}.${input.target.port}`, address);
    }

    for (const nodeInfo of graphPlan.nodes) {
      const nodeId = nodeInfo.id;
      const fgNode = nodeInfo.fg;
      if (nodeInfo.actualSource) {
        const sourceAddress = nodeInfo.actualSource === 'annotation.state.current' ? stateAddress : nodeInfo.actualSource;
        if (!fgNode.emits.length) throw new TypeError(`Source node ${nodeId} has no emit ports.`);
        for (const port of fgNode.emits) nodePorts.set(`${nodeId}.${port.name}`, sourceAddress);
        continue;
      }
      const inputs = {};
      for (const consume of fgNode.consumes) {
        const edge = graph.bindings.find((wire) => wire.to.node === nodeId && wire.to.port === consume.name);
        const address = edge ? nodePorts.get(`${edge.from.node}.${edge.from.port}`) : externalPorts.get(`${nodeId}.${consume.name}`);
        if (!address) throw new TypeError(`No actual Part is wired to ${nodeId}.${consume.name}.`);
        inputs[consume.name] = address;
      }
      const outputAddress = `annotation.output.graph.${tick}.${nodeId}`;
      await pxc.compose({into: outputAddress, calculation: nodeInfo.actualCalculation, inputs});
      if (fgNode.emits.length === 1) {
        nodePorts.set(`${nodeId}.${fgNode.emits[0].name}`, outputAddress);
        if (fgNode.emits[0].type === 'annotation-state') stateAddress = outputAddress;
      } else {
        for (const port of fgNode.emits) {
          const selectorRequest = `annotation.input.select.${tick}.${nodeId}.${port.name}`;
          const selectedAddress = `annotation.output.graph.${tick}.${nodeId}.${port.name}`;
          pxc.set(selectorRequest, new Part(freezeTree({port: port.name})));
          await pxc.compose({into: selectedAddress, calculation: 'annotation.port-select', inputs: {result: outputAddress, request: selectorRequest}});
          nodePorts.set(`${nodeId}.${port.name}`, selectedAddress);
          if (port.type === 'annotation-state') stateAddress = selectedAddress;
        }
      }
    }

    const result = {};
    for (const output of graph.externalOutputs) {
      if (!output.source) continue;
      const address = nodePorts.get(`${output.source.node}.${output.source.port}`);
      if (!address) throw new TypeError(`No actual output Part is wired to ${output.port}.`);
      result[output.port] = pxc.get(address).value;
    }
    return freezeTree(result);
  }

  addCalculation('annotation.composed', 'composed-wrapper', async ({request}) => runGraph(executableGraph, {
    event: request.event, context: {markers: request.context},
  }));

  let queue = Promise.resolve();
  const serialize = (action) => {
    const next = queue.then(action, action);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  async function seek(context = {}) {
    return serialize(async () => {
      const markers = markerRecords(issues, context);
      const tick = ++sequence;
      const contextAddress = `annotation.input.context.seek.${tick}`;
      const outputAddress = `annotation.output.projection.seek.${tick}`;
      pxc.set(contextAddress, new Part(freezeTree({markers})));
      const result = await pxc.compose({into: outputAddress, calculation: 'annotation.seek', inputs: {state: stateAddress, context: contextAddress}});
      return result.value;
    });
  }

  async function dispatch(event, context = {}) {
    return serialize(async () => {
      if (!isPlainData(event) || !event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Annotation event must be a plain tagged object.');
      const markers = markerRecords(issues, context);
      const tick = ++sequence;
      const requestAddress = `annotation.input.dispatch.${tick}`;
      const outputAddress = `annotation.output.dispatch.${tick}`;
      pxc.set(requestAddress, new Part(freezeTree({tick, event: clone(event), context: markers})));
      const result = await pxc.compose({into: outputAddress, calculation: 'annotation.composed', inputs: {request: requestAddress}});
      const projection = fg.emits.find((port) => port.type === 'ui-tree' || port.name === 'projection');
      if (!projection || !own(result.value, projection.name)) throw new TypeError('Composed AnnotationFG must emit a UI tree projection.');
      return result.value[projection.name];
    });
  }

  function state() { return pxc.get(stateAddress).value; }

  function inspect() {
    const entries = pxc.entries();
    const addressByPart = new Map(entries.map(([address, part]) => [part, address]));
    const receipts = pxc.receipts().map((receipt) => ({
      status: receipt.status,
      into: receipt.into,
      kind: calcParts.get(receipt.composition.calculation) || 'calculation',
      calculation: addressByPart.get(receipt.composition.calculation) || null,
      inputNames: Object.keys(receipt.composition.inputs),
      inputs: Object.fromEntries(Object.entries(receipt.composition.inputs).map(([name, part]) => [name, addressByPart.get(part) || null])),
    }));
    const parts = entries.map(([address, part]) => ({address,
      kind: typeof part.value === 'function' ? (calcParts.get(part) || 'functionPart') : 'valuePart',
      valueType: typeof part.value === 'function' ? 'function' : typeof part.value,
      part: 'actual'}));
    return freezeTree({definition: fg, state: state(), parts, receipts, currentState: stateAddress});
  }

  return Object.freeze({dispatch, seek, state, inspect, pxc, fg});
}
