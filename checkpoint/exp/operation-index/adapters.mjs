function jsonClone(value, path = '$', depth = 0) {
  if (depth > 64) throw new TypeError(`${path} exceeds maximum JSON depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => jsonClone(item, `${path}[${index}]`, depth + 1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${path}.${key} must be a JSON data property`);
      Object.defineProperty(copy, key, { value: jsonClone(descriptor.value, `${path}.${key}`, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return copy;
  }
  throw new TypeError(`${path} must contain finite JSON data`);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function attachSemantics(operation, semantics) {
  if (!semantics) return operation;
  const entry = semantics[operation.capabilityId];
  if (!entry || typeof entry !== 'object') return operation;
  const { label, ...signature } = entry;
  return { ...operation, ...(label === undefined ? {} : { label: jsonClone(label) }), semantics: jsonClone(signature) };
}

/** Convert CapabilityLab's recursive execution trace; child edges mean invocation only. */
export function normalizeLabExecution(execution, { replay = false, semantics = {} } = {}) {
  const trace = execution?.trace;
  const operations = [];
  const edges = [];
  const nativeToLocal = new Map();
  let occurrence = 0;
  function visit(node, parentLocalId = null) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const isTraceNode = node.id !== undefined || node.inputCanonical !== undefined || node.resultCanonical !== undefined || node.identity !== undefined;
    if (!isTraceNode) {
      if (Array.isArray(node.calls)) for (const child of node.calls) visit(child, parentLocalId);
      return null;
    }
    const localId = `lab-op-${++occurrence}`;
    const operation = attachSemantics({
      id: localId,
      nativeId: node.id ?? null,
      kind: 'capability',
      status: node.error ? 'failed' : 'succeeded',
      inputWiringStatus: 'unknown',
      capabilityId: typeof node.id === 'string' ? node.id : null,
      order: node.order ?? null,
      identity: node.identity ?? null,
      inputCanonical: node.inputCanonical ?? null,
      inputHash: node.inputHash ?? null,
      resultCanonical: node.resultCanonical ?? null,
      resultHash: node.resultHash ?? null,
      seed: node.seed ?? null,
      randomDraws: node.randomDraws ?? null,
      ...(node.error ? { error: jsonClone(node.error) } : {}),
    }, semantics);
    operations.push(jsonClone(operation));
    if (node.id !== undefined) {
      const nativeId = String(node.id);
      const occurrences = nativeToLocal.get(nativeId) ?? [];
      occurrences.push(localId);
      nativeToLocal.set(nativeId, occurrences);
    }
    if (parentLocalId) edges.push({ from: parentLocalId, to: localId, kind: 'invocation' });
    if (Array.isArray(node.calls)) for (const child of node.calls) visit(child, localId);
    return localId;
  }
  if (trace && typeof trace === 'object' && !Array.isArray(trace)) visit(trace);
  const explicitStatus = execution?.status;
  const status = explicitStatus === 'failed' || operations.some((operation) => operation.status === 'failed')
    ? 'failed'
    : operations.length ? 'succeeded' : 'unknown';
  return {
    status,
    operations,
    edges,
    evidence: {
      kind: 'capability-lab',
      replay: Boolean(replay),
      receipt: execution == null ? null : jsonClone(execution),
      nativeIdMap: Object.fromEntries(nativeToLocal),
      edgeMeaning: 'Parent-child trace calls are invocation edges; no dataflow is inferred from equal values or hashes.',
      hashMeaning: 'CapabilityLab inputHash and resultHash are FNV-1a 64-bit receipt hashes, not cryptographic identity.',
    },
  };
}

function traceNodes(trace) {
  const nodes = [];
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return; }
    if (seen.has(value)) return;
    seen.add(value);
    if (value.node_id !== undefined || value.calculation !== undefined || value.input_addresses !== undefined || value.output_address !== undefined) nodes.push(value);
    if (Array.isArray(value.calls)) for (const child of value.calls) walk(child);
    if (Array.isArray(value.children)) for (const child of value.children) walk(child);
    if (Array.isArray(value.nodes)) for (const child of value.nodes) walk(child);
  }
  walk(trace);
  return nodes;
}

function inputAddressEntries(inputAddresses) {
  if (Array.isArray(inputAddresses)) return inputAddresses.map((value, index) => ({ inputIndex: index, address: typeof value === 'string' ? value : value?.address ?? value?.part_address ?? null, evidence: value }));
  if (inputAddresses && typeof inputAddresses === 'object') {
    return Object.entries(inputAddresses).map(([port, value], inputIndex) => ({ inputIndex, port, address: typeof value === 'string' ? value : value?.address ?? value?.part_address ?? null, evidence: value }));
  }
  return [];
}

function normalizeStatus(node) {
  if (node.cache_hit === true || node.cached === true) return 'cached';
  const status = String(node.status ?? '').toLowerCase();
  if (['failed', 'failure', 'error', 'rejected'].includes(status)) return 'failed';
  if (['succeeded', 'success', 'complete', 'completed', 'executed', 'produced'].includes(status)) return 'succeeded';
  if (status.includes('cache')) return 'cached';
  return 'unknown';
}

/** Convert an Atlas inspection or result while retaining the original receipt and part references. */
export function normalizeAtlasObservation(inspectionOrResult) {
  const root = inspectionOrResult;
  const inspection = root?.inspection ?? root?.result?.inspection ?? null;
  const result = root?.result ?? null;
  const receipt = root?.receipt ?? result?.receipt ?? inspection?.receipt ?? result ?? inspection ?? root;
  const trace = receipt?.trace ?? inspection?.trace ?? result?.trace ?? root?.trace;
  const nativeNodes = traceNodes(trace);
  const operations = nativeNodes.map((node, index) => ({
    id: `atlas-op-${index + 1}`,
    nativeId: node.node_id ?? node.id ?? null,
    kind: node.kind ?? 'calculation',
    status: normalizeStatus(node),
    calculation: node.calculation ?? null,
    implementation: node.implementation ?? null,
    cacheHit: Boolean(node.cache_hit ?? node.cached),
    inputAddresses: jsonClone(node.input_addresses ?? []),
    inputCount: inputAddressEntries(node.input_addresses).length,
    outputCount: typeof node.output_address === 'string' ? 1 : 0,
    inputWiringStatus: 'exact-addresses',
    externalInputAliases: [],
    outputAddress: node.output_address ?? null,
    parts: jsonClone(node.parts ?? (node.output_address && (root?.parts ?? inspection?.parts ?? result?.parts)?.[node.output_address] ? (root?.parts ?? inspection?.parts ?? result?.parts)[node.output_address] : [])),
    ...(node.error === undefined ? {} : { error: jsonClone(node.error) }),
  }));
  const producerByAddress = new Map();
  for (const operation of operations) {
    if (typeof operation.outputAddress === 'string') producerByAddress.set(operation.outputAddress, operation.id);
  }
  const edges = [];
  const externalAliases = new Map();
  let nextExternalAlias = 0;
  for (const [index, node] of nativeNodes.entries()) {
    const inputEntries = inputAddressEntries(node.input_addresses);
    operations[index].externalInputAliases = inputEntries.map((input) => {
      if (producerByAddress.has(input.address)) return null;
      if (typeof input.address !== 'string') return null;
      if (!externalAliases.has(input.address)) externalAliases.set(input.address, nextExternalAlias++);
      return externalAliases.get(input.address);
    });
    for (const input of inputEntries) {
      const from = producerByAddress.get(input.address);
      if (from) edges.push({ from, to: operations[index].id, kind: 'data', inputIndex: input.inputIndex });
    }
  }
  const failed = operations.some((operation) => operation.status === 'failed') || receipt?.status === 'failed' || root?.status === 'failed';
  const status = failed ? 'failed' : operations.length && operations.every((operation) => operation.status !== 'unknown') ? 'succeeded' : operations.length ? 'partial' : 'unknown';
  return {
    status,
    operations,
    edges,
    evidence: {
      kind: 'atlas',
      receipt: root == null ? null : jsonClone(root),
      addressEdgesMeaning: 'A data edge is emitted only for an exact input address matching a producer output address in this trace; addresses remain evidence and are excluded from flow keys.',
      unbound: operations.filter((operation) => operation.implementation == null || operation.implementation?.identity_status === 'unbound-local').map((operation) => operation.id),
    },
  };
}

const SEMANTIC_KEYS = ['op', 'predicate', 'constants', 'frame', 'units'];

/** Fingerprint wiring and declared semantics; never a proof that two executions are equivalent. */
export function flowCandidateKey({ operations = [], edges = [] } = {}) {
  if (!Array.isArray(operations) || !Array.isArray(edges)) throw new TypeError('operations and edges must be arrays');
  const indexById = new Map(operations.map((operation, index) => [operation.id, index]));
  const semantic = operations.length > 0 && operations.every((operation) => {
    const signature = operation.semantics;
    return signature && typeof signature === 'object' && SEMANTIC_KEYS.some((key) => signature[key] !== undefined);
  });
  const nodes = operations.map((operation) => {
    const node = { kind: operation.kind ?? 'unknown', status: operation.status ?? 'unknown' };
    if (Number.isSafeInteger(operation.inputCount)) node.inputCount = operation.inputCount;
    if (Number.isSafeInteger(operation.outputCount)) node.outputCount = operation.outputCount;
    if (operation.inputWiringStatus !== undefined) node.inputWiringStatus = operation.inputWiringStatus;
    if (Array.isArray(operation.externalInputAliases)) node.externalInputAliases = operation.externalInputAliases;
    if (Array.isArray(operation.inputWiring)) node.inputWiring = operation.inputWiring;
    if (Array.isArray(operation.outputWiring)) node.outputWiring = operation.outputWiring;
    if (Array.isArray(operation.decisions)) node.decisions = operation.decisions;
    if (operation.semantics && typeof operation.semantics === 'object') {
      const signature = Object.fromEntries(SEMANTIC_KEYS.filter((key) => operation.semantics[key] !== undefined).map((key) => [key, operation.semantics[key]]));
      if (Object.keys(signature).length) node.signature = signature;
    }
    return node;
  });
  const links = edges.map((edge) => ({
    from: indexById.get(edge.from) ?? null,
    to: indexById.get(edge.to) ?? null,
    kind: edge.kind ?? 'unknown',
    ...(Number.isSafeInteger(edge.inputIndex) ? { inputIndex: edge.inputIndex } : {}),
    ...(Number.isSafeInteger(edge.invocationIndex) ? { invocationIndex: edge.invocationIndex } : {}),
    ...(Number.isSafeInteger(edge.fromOutputIndex) ? { fromOutputIndex: edge.fromOutputIndex } : {}),
    ...(typeof edge.sourceKind === 'string' ? { sourceKind: edge.sourceKind } : {}),
    ...(edge.literalValue !== undefined ? { literalValue: edge.literalValue } : {}),
    ...(Array.isArray(edge.via) ? { via: edge.via } : {}),
  })).sort((a, b) => stable(a).localeCompare(stable(b)));
  const mode = semantic ? 'semantic-candidate' : 'structural-only';
  return `${mode}:${stable({ nodes, edges: links })}`;
}

export function groupFlowCandidates(runs = []) {
  const groups = new Map();
  for (const run of runs) {
    const key = flowCandidateKey(run);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run.id ?? null);
  }
  return [...groups].map(([key, runIds]) => ({ key, mode: key.startsWith('semantic-candidate:') ? 'semantic-candidate' : 'structural-only', runIds }));
}
