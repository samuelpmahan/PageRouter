import { Part, PxC } from '../../../vendor/hh/services/pxc.mjs';
import { canonicalJson, cloneJson, validateJson } from './canonical.mjs';
import { createPixelCache } from './pixel-cache.mjs';
import { PROVIDER_IDENTITY, resolveProvider } from './providers.mjs';

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    throw new TypeError(`${label} must have exactly: ${expected.join(', ')}.`);
  }
};
const preparedPlans = new WeakMap();
const frozenProgramPlans = new WeakMap();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function equalJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function isDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.values(value).every(child => isDeepFrozen(child, seen));
}

export function validateComposedProgram(program) {
  validateJson(program, 'composed program');
  if (!program || typeof program !== 'object' || program.format !== 'pagerouter.composed-calculation.v1' || typeof program.id !== 'string' || !program.id) {
    throw new TypeError('Unknown composed calculation format or missing id.');
  }
  if (canonicalJson(program.providerIdentity) !== canonicalJson(PROVIDER_IDENTITY)) throw new TypeError('Composed program provider identity mismatch.');
  if (!Array.isArray(program.inputs) || !Array.isArray(program.nodes) || program.nodes.length === 0 || !Array.isArray(program.outputs)) {
    throw new TypeError('Composed program needs inputs, nodes, and outputs arrays.');
  }
  const inputByPort = new Map();
  for (const input of program.inputs) {
    exactKeys(input, ['port', 'sourceRef', 'defaultValue'], 'Composed input');
    if (typeof input.port !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(input.port) || inputByPort.has(input.port)) throw new TypeError('Composed input ports must be unique safe names.');
    if (typeof input.sourceRef !== 'string' || !input.sourceRef) throw new TypeError(`Composed input ${input.port} needs a sourceRef.`);
    inputByPort.set(input.port, input);
  }
  const nodeById = new Map();
  for (const [index, node] of program.nodes.entries()) {
    exactKeys(node, ['id', 'calculation', 'inputs'], `Composed node ${index}`);
    if (typeof node.id !== 'string' || !node.id || nodeById.has(node.id)) throw new TypeError(`Composed node ${index} needs a unique id.`);
    resolveProvider(node.calculation, program.providerIdentity);
    if (!Array.isArray(node.inputs) || node.inputs.length !== 2) throw new TypeError(`Composed node ${node.id} needs exactly two ordered bindings.`);
    for (const binding of node.inputs) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new TypeError(`Composed node ${node.id} has an invalid binding.`);
      if (binding.kind === 'input') {
        exactKeys(binding, ['kind', 'port'], `Input binding for ${node.id}`);
        if (!inputByPort.has(binding.port)) throw new TypeError(`Composed node ${node.id} has an unbound input port ${String(binding.port)}.`);
      } else if (binding.kind === 'node') {
        exactKeys(binding, ['kind', 'nodeId'], `Node binding for ${node.id}`);
        if (!nodeById.has(binding.nodeId)) throw new TypeError(`Composed node ${node.id} references a missing or later node ${String(binding.nodeId)}.`);
      } else throw new TypeError(`Composed node ${node.id} binding kind must be input or node.`);
    }
    nodeById.set(node.id, node);
  }
  const outputPorts = new Set();
  const outputNodes = new Set();
  for (const output of program.outputs) {
    exactKeys(output, ['port', 'nodeId'], 'Composed output');
    if (typeof output.port !== 'string' || !output.port || outputPorts.has(output.port)) throw new TypeError('Composed output ports must be unique.');
    if (!nodeById.has(output.nodeId) || outputNodes.has(output.nodeId)) throw new TypeError(`Composed output has invalid or repeated node ${String(output.nodeId)}.`);
    outputPorts.add(output.port);
    outputNodes.add(output.nodeId);
  }
  if (outputNodes.size !== nodeById.size) throw new TypeError('Every composed node output must be retained.');
  if (!program.training || typeof program.training.patternId !== 'string' || !Array.isArray(program.training.eventIds) || !Number.isInteger(program.training.occurrenceCount) || program.training.occurrenceCount < 1) {
    throw new TypeError('Composed program training provenance is incomplete.');
  }
  return { inputByPort, nodeById };
}

export function prepareComposedCalculation(program) {
  if (program && typeof program === 'object' && Object.isFrozen(program) && frozenProgramPlans.has(program)) {
    return frozenProgramPlans.get(program);
  }
  const reusable = program && typeof program === 'object' && isDeepFrozen(program);
  const snapshot = reusable ? program : deepFreeze(cloneJson(program));
  const { inputByPort, nodeById } = validateComposedProgram(snapshot);
  const byPort = new Map(snapshot.inputs.map(input => [input.port, input]));
  const bySource = new Map();
  for (const input of snapshot.inputs) {
    if (!bySource.has(input.sourceRef)) bySource.set(input.sourceRef, []);
    bySource.get(input.sourceRef).push(input.port);
  }
  const nodes = snapshot.nodes.map(node => ({
    node,
    provider: resolveProvider(node.calculation, snapshot.providerIdentity),
    refs: node.inputs.map(binding => binding.kind === 'input' ? inputByPort.get(binding.port).sourceRef : null),
  }));
  const plan = {
    program: snapshot,
    inputByPort,
    nodeById,
    byPort,
    bySource,
    nodes,
    calculation: `composed:${snapshot.id}`,
    cacheNamespace: canonicalJson({ provider: snapshot.providerIdentity, calculation: `composed:${snapshot.id}`, program: snapshot }),
  };
  const handle = Object.freeze({ program: snapshot });
  preparedPlans.set(handle, plan);
  if (reusable) frozenProgramPlans.set(program, handle);
  return handle;
}

export function createProgramForRecipe(recipe, initialState) {
  const activeRules = recipe.rules.filter(rule => rule.enabled !== false);
  const inputs = [{ port: 'state', sourceRef: 'input:state', defaultValue: cloneJson(initialState) }];
  const nodes = [];
  for (const [index, rule] of activeRules.entries()) {
    const parameterPort = `parameters-${index}`;
    inputs.push({ port: parameterPort, sourceRef: `input:parameters:${rule.id}`, defaultValue: cloneJson(rule.parameters) });
    nodes.push({
      id: `n${index}`,
      calculation: rule.calculation,
      inputs: [
        index === 0 ? { kind: 'input', port: 'state' } : { kind: 'node', nodeId: `n${index - 1}` },
        { kind: 'input', port: parameterPort },
      ],
    });
  }
  const program = {
    format: 'pagerouter.composed-calculation.v1',
    id: `block5:${recipe.id}`,
    providerIdentity: PROVIDER_IDENTITY,
    inputs,
    nodes,
    outputs: nodes.map((node, index) => ({ port: `o${index}`, nodeId: node.id })),
    training: { patternId: `recipe:${recipe.id}`, eventIds: [], occurrenceCount: 1 },
  };
  return program;
}

function overridesForPorts(program, inputs, { byPort, bySource } = {}) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new TypeError('Composed input overrides must be a plain object.');
  const unknown = Object.keys(inputs).filter(key => !byPort.has(key) && !bySource.has(key));
  if (unknown.length) throw new TypeError(`Unknown composed input override: ${unknown[0]}.`);
  for (const input of program.inputs) {
    if (Object.hasOwn(inputs, input.port) && Object.hasOwn(inputs, input.sourceRef) &&
        !equalJson(inputs[input.port], inputs[input.sourceRef])) {
      throw new TypeError(`Conflicting overrides for composed sourceRef ${input.sourceRef}.`);
    }
  }
  const values = Object.create(null);
  for (const input of program.inputs) {
    let candidate = input.defaultValue;
    if (Object.hasOwn(inputs, input.port)) candidate = inputs[input.port];
    else if (Object.hasOwn(inputs, input.sourceRef)) candidate = inputs[input.sourceRef];
    values[input.port] = structuredClone(candidate);
  }
  const sourceValues = new Map();
  for (const input of program.inputs) {
    const value = values[input.port];
    if (sourceValues.has(input.sourceRef) && !equalJson(sourceValues.get(input.sourceRef), value)) {
      throw new TypeError(`Conflicting values for composed sourceRef ${input.sourceRef}.`);
    }
    sourceValues.set(input.sourceRef, value);
  }
  return values;
}

export function executeComposedCalculation({ program, prepared = null, inputs = {}, cache = null, borrowCachedResult = false } = {}) {
  const handle = prepared ?? prepareComposedCalculation(program);
  const plan = preparedPlans.get(handle);
  if (!plan) throw new TypeError('Composed calculation plan was not prepared by this provider registry.');
  const descriptor = plan.program;
  const externalValues = overridesForPorts(descriptor, inputs, plan);
  const activeCache = cache ?? null;
  const keyInputs = Object.fromEntries(descriptor.inputs.map(input => [input.sourceRef, externalValues[input.port]]));
  const canonicalInputs = canonicalJson(keyInputs);
  let cacheHit = false;
  const pxc = new PxC();
  for (const input of descriptor.inputs) pxc.set(`input:${input.port}`, new Part(externalValues[input.port]));
  const calculationAddress = `calculation:${descriptor.id}`;
  pxc.set(calculationAddress, new Part(async values => {
    if (activeCache) {
      const found = activeCache.lookupScopedCanonical(plan.cacheNamespace, canonicalInputs, { borrowed: borrowCachedResult });
      if (found.hit) {
        cacheHit = true;
        return found.value;
      }
    }
    const nodeValues = new Map();
    const retainedNodes = [];
    for (const preparedNode of plan.nodes) {
      const { node, provider } = preparedNode;
      const argumentsList = node.inputs.map(binding => binding.kind === 'input' ? values[binding.port] : nodeValues.get(binding.nodeId).value);
      const value = await provider.run(argumentsList[0], argumentsList[1]);
      validateJson(value, `output from ${node.id}`);
      const refs = node.inputs.map((binding, index) => binding.kind === 'input' ? preparedNode.refs[index] : nodeValues.get(binding.nodeId).outputRef);
      const retained = { id: node.id, calculation: node.calculation, inputs: argumentsList, inputRefs: refs, value, outputRef: `node:${node.id}:output` };
      nodeValues.set(node.id, retained);
      retainedNodes.push(retained);
    }
    const result = {
      nodes: retainedNodes,
      outputs: descriptor.outputs.map(output => ({ port: output.port, nodeId: output.nodeId, value: nodeValues.get(output.nodeId).value })),
    };
    if (activeCache) activeCache.storeScopedCanonical(plan.cacheNamespace, canonicalInputs, result);
    return result;
  }));
  const bindings = Object.fromEntries(descriptor.inputs.map(input => [input.port, `input:${input.port}`]));
  const promise = pxc.compose({ into: `output:${descriptor.id}`, calculation: calculationAddress, inputs: bindings });
  return promise.then(output => ({
    ...output.value,
    cacheHit,
    receipt: pxc.receipts()[0],
    receipts: pxc.receipts(),
    providerIdentity: descriptor.providerIdentity,
    programId: descriptor.id,
  }));
}

export function composedProgramInputValues(program, state, recipe, explicitOverrides = {}) {
  const rules = new Map(recipe.rules.map(rule => [rule.id, rule]));
  const values = { ...explicitOverrides };
  for (const input of program.inputs) {
    if (input.sourceRef === 'input:state') values[input.port] = state;
    const match = /^input:parameters:(.+)$/.exec(input.sourceRef);
    if (match && rules.has(match[1])) values[input.port] = rules.get(match[1]).parameters;
  }
  return values;
}
