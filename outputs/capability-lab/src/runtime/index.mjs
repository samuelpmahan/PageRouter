const DEFAULT_LIMITS = Object.freeze({
  maxCallDepth: 64,
  maxCalls: 25_000,
  maxValueBytes: 4 * 1024 * 1024,
  maxValueDepth: 128,
  maxTracePayloadBytes: 16 * 1024 * 1024,
});
const SUPPORTED_TYPES = new Set(['object', 'array', 'number', 'integer', 'string', 'boolean', 'null']);
const ALLOWED_SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'minItems', 'maxItems', 'minimum', 'maximum',
  'enum', 'additionalProperties', 'title', 'description',
]);
const ALLOWED_DESCRIPTOR_FIELDS = new Set([
  'id', 'title', 'description', 'kind', 'dependsOn', 'inputSchema', 'outputSchema', 'examples',
  'run', 'formula', 'caveats', 'units', 'source', 'version',
]);
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export class CapabilityError extends Error {
  constructor(message, code = 'CAPABILITY_ERROR') {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new CapabilityError(message, code);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapeString(value) {
  return JSON.stringify(value);
}

function canonicalString(value, path = '$', ancestors = new Set(), depth = 0, maxDepth = 128) {
  if (depth > maxDepth) fail(`${path} exceeds maximum JSON value depth (${maxDepth})`, 'VALUE_DEPTH_LIMIT');
  if (value === null) return 'null';
  if (typeof value === 'string') return escapeString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must contain only finite numbers`, 'NON_FINITE_NUMBER');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value !== 'object') {
    fail(`${path} contains a non-JSON value (${typeof value})`, 'INVALID_JSON_VALUE');
  }
  if (ancestors.has(value)) fail(`${path} contains a cycle`, 'CYCLIC_VALUE');
  ancestors.add(value);

  let output;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${path} must be a plain JSON array`, 'INVALID_JSON_ARRAY');
    if (Reflect.ownKeys(value).some((key) => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))) {
      fail(`${path} contains a non-index array property`, 'INVALID_JSON_ARRAY');
    }
    const entries = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!own(value, index)) fail(`${path}[${index}] is a sparse array entry`, 'SPARSE_ARRAY');
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || property.get || property.set) fail(`${path}[${index}] must be a plain data value`, 'INVALID_JSON_VALUE');
      entries.push(canonicalString(value[index], `${path}[${index}]`, ancestors, depth + 1, maxDepth));
    }
    output = `[${entries.join(',')}]`;
  } else {
    if (!isPlainObject(value)) fail(`${path} must be a plain JSON object`, 'INVALID_JSON_OBJECT');
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail(`${path} contains a symbol key`, 'INVALID_JSON_VALUE');
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set) fail(`${path}.${key} must be an enumerable plain data value`, 'INVALID_JSON_VALUE');
    }
    const keys = Object.keys(value).sort();
    const entries = [];
    for (const key of keys) {
      const child = value[key];
      if (typeof child === 'undefined') fail(`${path}.${key} is undefined`, 'INVALID_JSON_VALUE');
      entries.push(`${escapeString(key)}:${canonicalString(child, `${path}.${key}`, ancestors, depth + 1, maxDepth)}`);
    }
    output = `{${entries.join(',')}}`;
  }

  ancestors.delete(value);
  return output;
}

function canonicalClone(value, path = '$', maxDepth = 128) {
  const canonical = canonicalString(value, path, new Set(), 0, maxDepth);
  return { canonical, value: JSON.parse(canonical) };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function utf8Length(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function fnv1a64(value) {
  let hash = FNV_OFFSET_64;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const bytes = codePoint <= 0x7f
      ? [codePoint]
      : codePoint <= 0x7ff
        ? [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)]
        : codePoint <= 0xffff
          ? [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)]
          : [0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)];
    for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function hashSeed(seed) {
  const canonical = canonicalString(seed, '$.seed');
  if (typeof seed === 'number') return (Math.trunc(seed) >>> 0) || 0x6d2b79f5;
  const folded = fnv1a64(canonical);
  return (Number.parseInt(folded.slice(-8), 16) >>> 0) || 0x6d2b79f5;
}

function createRandom(seed, state) {
  if (seed === null) {
    return () => fail('ctx.random() requires an explicit execution seed', 'SEED_REQUIRED');
  }
  let randomState = hashSeed(seed);
  return () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    randomState >>>= 0;
    state.randomDraws += 1;
    return randomState / 0x1_0000_0000;
  };
}

function validateSchemaDefinition(schema, path) {
  if (!isPlainObject(schema)) fail(`${path} must be a schema object`, 'INVALID_SCHEMA');
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) fail(`${path} has unsupported schema keyword ${key}`, 'UNSUPPORTED_SCHEMA_KEYWORD');
  }
  if (typeof schema.type !== 'string' || !SUPPORTED_TYPES.has(schema.type)) {
    fail(`${path}.type must be one of ${[...SUPPORTED_TYPES].join(', ')}`, 'INVALID_SCHEMA');
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    fail(`${path}.enum must be a non-empty array`, 'INVALID_SCHEMA');
  }
  if (schema.enum !== undefined) schema.enum.forEach((candidate, index) => canonicalString(candidate, `${path}.enum[${index}]`));
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) fail(`${path}.properties must be an object`, 'INVALID_SCHEMA');
    for (const [key, child] of Object.entries(schema.properties)) {
      validateSchemaDefinition(child, `${path}.properties.${key}`);
    }
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))) {
    fail(`${path}.required must be an array of property names`, 'INVALID_SCHEMA');
  }
  if (schema.type === 'array' && schema.items !== undefined) validateSchemaDefinition(schema.items, `${path}.items`);
  for (const constraint of ['minimum', 'maximum', 'minItems', 'maxItems']) {
    if (schema[constraint] !== undefined && (!Number.isFinite(schema[constraint]) || schema[constraint] < 0 && constraint.includes('Items'))) {
      fail(`${path}.${constraint} must be a finite ${constraint.includes('Items') ? 'non-negative integer' : 'number'}`, 'INVALID_SCHEMA');
    }
    if (constraint.includes('Items') && schema[constraint] !== undefined && !Number.isInteger(schema[constraint])) {
      fail(`${path}.${constraint} must be a non-negative integer`, 'INVALID_SCHEMA');
    }
  }
  if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) {
    fail(`${path}.minimum must not exceed maximum`, 'INVALID_SCHEMA');
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) {
    fail(`${path}.minItems must not exceed maxItems`, 'INVALID_SCHEMA');
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    fail(`${path}.additionalProperties must be a boolean`, 'INVALID_SCHEMA');
  }
  if (schema.type !== 'object' && (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined)) {
    fail(`${path} uses object constraints on a non-object schema`, 'INVALID_SCHEMA');
  }
  if (schema.type !== 'array' && (schema.items !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined)) {
    fail(`${path} uses array constraints on a non-array schema`, 'INVALID_SCHEMA');
  }
  if (schema.type !== 'number' && schema.type !== 'integer' && (schema.minimum !== undefined || schema.maximum !== undefined)) {
    fail(`${path} uses numeric constraints on a non-number schema`, 'INVALID_SCHEMA');
  }
}

function valueTypeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
}

function validateValue(value, schema, path) {
  if (!valueTypeMatches(value, schema.type)) {
    fail(`${path} must be ${schema.type}`, 'SCHEMA_TYPE_MISMATCH');
  }
  if ((schema.type === 'number' || schema.type === 'integer') && !Number.isFinite(value)) {
    fail(`${path} must be a finite number`, 'NON_FINITE_NUMBER');
  }
  if (schema.enum && !schema.enum.some((candidate) => canonicalString(candidate, `${path}.enum`) === canonicalString(value, path))) {
    fail(`${path} must match one of the allowed enum values`, 'SCHEMA_ENUM_MISMATCH');
  }
  if (schema.minimum !== undefined && value < schema.minimum) fail(`${path} must be at least ${schema.minimum}`, 'SCHEMA_MINIMUM');
  if (schema.maximum !== undefined && value > schema.maximum) fail(`${path} must be at most ${schema.maximum}`, 'SCHEMA_MAXIMUM');
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (!own(value, key)) fail(`${path}.${key} is required`, 'SCHEMA_REQUIRED');
    }
    for (const [key, child] of Object.entries(value)) {
      if (!own(schema.properties ?? {}, key)) {
        if (schema.additionalProperties === false) fail(`${path}.${key} is an additional property`, 'SCHEMA_ADDITIONAL_PROPERTY');
        continue;
      }
      validateValue(child, schema.properties[key], `${path}.${key}`);
    }
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${path} must contain at least ${schema.minItems} items`, 'SCHEMA_MIN_ITEMS');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`${path} must contain at most ${schema.maxItems} items`, 'SCHEMA_MAX_ITEMS');
    if (schema.items) value.forEach((child, index) => validateValue(child, schema.items, `${path}[${index}]`));
  }
}

function normalizeLimits(limits = {}) {
  if (!isPlainObject(limits)) fail('limits must be an object', 'INVALID_LIMITS');
  const result = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(limits)) {
    if (!own(DEFAULT_LIMITS, key)) fail(`unknown runtime limit ${key}`, 'INVALID_LIMITS');
    if (!Number.isSafeInteger(value) || value <= 0) fail(`limits.${key} must be a positive safe integer`, 'INVALID_LIMITS');
    result[key] = value;
  }
  return Object.freeze(result);
}

function validateDescriptor(descriptor) {
  if (!isPlainObject(descriptor)) fail('each capability descriptor must be a plain object', 'INVALID_DESCRIPTOR');
  if (Object.getOwnPropertySymbols(descriptor).length > 0) fail('capability descriptors cannot contain symbol keys', 'INVALID_DESCRIPTOR');
  for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(descriptor))) {
    if (!ALLOWED_DESCRIPTOR_FIELDS.has(key)) fail(`capability descriptor has unsupported field ${key}`, 'INVALID_DESCRIPTOR');
    if (!property.enumerable || property.get || property.set) fail(`capability descriptor field ${key} must be an enumerable data value`, 'INVALID_DESCRIPTOR');
  }
  if (typeof descriptor.id !== 'string' || !/^[a-z][a-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(descriptor.id)) {
    fail(`invalid capability ID ${String(descriptor.id)}`, 'INVALID_DESCRIPTOR');
  }
  for (const field of ['title', 'description']) {
    if (typeof descriptor[field] !== 'string' || descriptor[field].trim() === '') fail(`${descriptor.id}.${field} must be a non-empty string`, 'INVALID_DESCRIPTOR');
  }
  if (descriptor.kind !== 'atomic' && descriptor.kind !== 'composed') fail(`${descriptor.id}.kind must be atomic or composed`, 'INVALID_DESCRIPTOR');
  if (!Array.isArray(descriptor.dependsOn) || descriptor.dependsOn.some((id) => typeof id !== 'string')) {
    fail(`${descriptor.id}.dependsOn must be an array of capability IDs`, 'INVALID_DESCRIPTOR');
  }
  if (new Set(descriptor.dependsOn).size !== descriptor.dependsOn.length) fail(`${descriptor.id} declares a duplicate dependency`, 'INVALID_DESCRIPTOR');
  if (descriptor.kind === 'atomic' && descriptor.dependsOn.length > 0) fail(`atomic capability ${descriptor.id} cannot declare dependencies`, 'INVALID_DESCRIPTOR');
  if (descriptor.kind === 'composed' && descriptor.dependsOn.length === 0) fail(`composed capability ${descriptor.id} must declare at least one dependency`, 'INVALID_DESCRIPTOR');
  if (typeof descriptor.run !== 'function') fail(`${descriptor.id}.run must be a function`, 'INVALID_DESCRIPTOR');
  validateSchemaDefinition(descriptor.inputSchema, `${descriptor.id}.inputSchema`);
  validateSchemaDefinition(descriptor.outputSchema, `${descriptor.id}.outputSchema`);
  if (descriptor.inputSchema.type !== 'object') fail(`${descriptor.id}.inputSchema must describe an object`, 'INVALID_SCHEMA');
  for (const schema of [descriptor.inputSchema, descriptor.outputSchema]) {
    for (const annotation of ['title', 'description']) {
      if (schema[annotation] !== undefined && typeof schema[annotation] !== 'string') fail(`${descriptor.id}.${annotation} schema annotation must be a string`, 'INVALID_SCHEMA');
    }
  }
  if (descriptor.source !== undefined && (typeof descriptor.source !== 'string' || descriptor.source.trim() === '')) fail(`${descriptor.id}.source must be a non-empty string`, 'INVALID_IDENTITY');
  if (descriptor.version !== undefined && (typeof descriptor.version !== 'string' || descriptor.version.trim() === '')) fail(`${descriptor.id}.version must be a non-empty string`, 'INVALID_IDENTITY');
  if (!Array.isArray(descriptor.examples)) fail(`${descriptor.id}.examples must be an array`, 'INVALID_DESCRIPTOR');
  for (const [index, example] of descriptor.examples.entries()) {
    if (!isPlainObject(example) || !own(example, 'input') || !own(example, 'expected')) {
      fail(`${descriptor.id}.examples[${index}] must contain input and expected`, 'INVALID_DESCRIPTOR');
    }
    const inputCanonical = canonicalClone(example.input, `${descriptor.id}.examples[${index}].input`);
    validateValue(inputCanonical.value, descriptor.inputSchema, `${descriptor.id}.examples[${index}].input`);
    const expectedCanonical = canonicalClone(example.expected, `${descriptor.id}.examples[${index}].expected`);
    validateValue(expectedCanonical.value, descriptor.outputSchema, `${descriptor.id}.examples[${index}].expected`);
  }
}

function descriptorIdentity(descriptor, baseIdentity) {
  const source = descriptor.source ?? baseIdentity.source;
  const version = descriptor.version ?? baseIdentity.version;
  if (typeof source !== 'string' || source.trim() === '') fail(`${descriptor.id}.source must be a non-empty string`, 'INVALID_IDENTITY');
  if (typeof version !== 'string' || version.trim() === '') fail(`${descriptor.id}.version must be a non-empty string`, 'INVALID_IDENTITY');
  return Object.freeze({ source, version, kind: 'declared' });
}

function snapshotDescriptor(descriptor) {
  const metadata = {};
  for (const key of Object.keys(descriptor)) {
    if (key !== 'run') metadata[key] = descriptor[key];
  }
  const frozenMetadata = canonicalClone(metadata, `${descriptor.id}.descriptor`).value;
  return deepFreeze({ ...frozenMetadata, run: descriptor.run });
}

function createOrderPreference(maxOrder) {
  const values = [];
  let total = 0n;
  for (let order = 0; order <= maxOrder; order += 1) {
    const value = order === 0 ? 1n : total;
    values.push({ order, value: value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString() });
    total += value;
  }
  return Object.freeze({
    rule: 'Order 0 has value 1; each higher order has the sum of all earlier order values.',
    values: Object.freeze(values.map((entry) => Object.freeze(entry))),
    declared: true,
  });
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive safe integer`, 'INVALID_LIMITS');
}

export function createRegistry(capabilities, options = {}) {
  if (!Array.isArray(capabilities)) fail('capabilities must be an array', 'INVALID_REGISTRY');
  if (!isPlainObject(options)) fail('registry options must be an object', 'INVALID_REGISTRY');
  const baseIdentity = Object.freeze({
    source: options.source ?? 'unspecified',
    version: options.version ?? 'unspecified',
    kind: 'declared',
  });
  if (typeof baseIdentity.source !== 'string' || baseIdentity.source.trim() === '') fail('source must be a non-empty string', 'INVALID_IDENTITY');
  if (typeof baseIdentity.version !== 'string' || baseIdentity.version.trim() === '') fail('version must be a non-empty string', 'INVALID_IDENTITY');
  const limits = normalizeLimits(options.limits);
  const descriptors = new Map();
  for (const descriptor of capabilities) {
    validateDescriptor(descriptor);
    const snapshot = snapshotDescriptor(descriptor);
    if (descriptors.has(snapshot.id)) fail(`duplicate capability ID ${snapshot.id}`, 'DUPLICATE_ID');
    descriptors.set(snapshot.id, snapshot);
  }
  for (const descriptor of descriptors.values()) {
    for (const dependency of descriptor.dependsOn) {
      if (!descriptors.has(dependency)) fail(`${descriptor.id} has unknown dependency ${dependency}`, 'UNKNOWN_DEPENDENCY');
    }
  }

  const orders = new Map();
  const visiting = new Set();
  function deriveOrder(id) {
    if (orders.has(id)) return orders.get(id);
    if (visiting.has(id)) fail(`dependency cycle detected at ${id}`, 'DEPENDENCY_CYCLE');
    visiting.add(id);
    const descriptor = descriptors.get(id);
    const order = descriptor.dependsOn.length === 0
      ? 0
      : 1 + Math.max(...descriptor.dependsOn.map(deriveOrder));
    visiting.delete(id);
    orders.set(id, order);
    return order;
  }
  for (const id of descriptors.keys()) deriveOrder(id);

  const maxOrder = Math.max(0, ...orders.values());
  const preference = createOrderPreference(maxOrder);
  const orderValues = new Map(preference.values.map(({ order, value }) => [order, value]));
  const baseView = (id) => {
    const descriptor = descriptors.get(id);
    return Object.freeze({ ...descriptor, dependsOn: Object.freeze([...descriptor.dependsOn]), order: orders.get(id), orderValue: orderValues.get(orders.get(id)) });
  };

  function get(id) {
    const descriptor = descriptors.get(id);
    if (!descriptor) fail(`unknown capability ${String(id)}`, 'UNKNOWN_CAPABILITY');
    return baseView(id);
  }

  function list() {
    return [...descriptors.keys()].sort((left, right) => left.localeCompare(right)).map(baseView);
  }

  function graph() {
    const nodes = list().map(({ id, order, dependsOn }) => Object.freeze({ id, order, dependsOn }));
    const edges = [];
    for (const descriptor of descriptors.values()) {
      for (const dependency of descriptor.dependsOn) edges.push(Object.freeze({ from: dependency, to: descriptor.id }));
    }
    edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
    return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges), orderValues: preference.values });
  }

  function execute(id, input, executeOptions = {}) {
    if (!isPlainObject(executeOptions)) fail('execution options must be an object', 'INVALID_EXECUTION_OPTIONS');
    if (own(executeOptions, 'seed') && executeOptions.seed !== null && typeof executeOptions.seed !== 'string' && typeof executeOptions.seed !== 'number') {
      fail('seed must be a string or finite number', 'INVALID_SEED');
    }
    const seed = own(executeOptions, 'seed') ? executeOptions.seed : null;
    if (typeof seed === 'number' && !Number.isFinite(seed)) fail('seed must be a finite number', 'INVALID_SEED');
    if (!descriptors.has(id)) fail(`unknown capability ${String(id)}`, 'UNKNOWN_CAPABILITY');
    const state = { calls: 0, tracePayloadBytes: 0, randomDraws: 0, random: null };
    state.random = createRandom(seed, state);

    function chargeTrace(bytes, capabilityId) {
      state.tracePayloadBytes += bytes;
      if (state.tracePayloadBytes > limits.maxTracePayloadBytes) {
        fail(`trace payload limit exceeded (${limits.maxTracePayloadBytes} bytes) while executing ${capabilityId}`, 'TRACE_PAYLOAD_LIMIT');
      }
    }

    function runNode(capabilityId, rawInput, depth) {
      if (depth > limits.maxCallDepth) fail(`call depth limit exceeded (${limits.maxCallDepth}) at ${capabilityId}`, 'CALL_DEPTH_LIMIT');
      state.calls += 1;
      if (state.calls > limits.maxCalls) fail(`call count limit exceeded (${limits.maxCalls}) at ${capabilityId}`, 'CALL_COUNT_LIMIT');
      const descriptor = descriptors.get(capabilityId);
      const inputSnapshot = canonicalClone(rawInput, `${capabilityId}.input`, limits.maxValueDepth);
      if (!isPlainObject(inputSnapshot.value)) fail(`${capabilityId} input must be an object`, 'INPUT_NOT_OBJECT');
      validateValue(inputSnapshot.value, descriptor.inputSchema, `${capabilityId}.input`);
      const inputBytes = utf8Length(inputSnapshot.canonical);
      if (inputBytes > limits.maxValueBytes) fail(`${capabilityId} input exceeds value limit (${limits.maxValueBytes} bytes)`, 'VALUE_SIZE_LIMIT');
      const input = deepFreeze(inputSnapshot.value);
      const declared = new Set(descriptor.dependsOn);
      const called = new Set();
      const calls = [];
      const randomDrawStart = state.randomDraws;
      const context = Object.freeze({
        seed,
        random: state.random,
        call(dependencyId, dependencyInput) {
          if (typeof dependencyId !== 'string' || !declared.has(dependencyId)) {
            fail(`${capabilityId} made undeclared dependency call ${String(dependencyId)}`, 'UNDECLARED_CALL');
          }
          called.add(dependencyId);
          const child = runNode(dependencyId, dependencyInput, depth + 1);
          calls.push(child.trace);
          return child.value;
        },
      });

      let rawResult;
      try {
        rawResult = descriptor.run(input, context);
      } catch (error) {
        if (error instanceof CapabilityError) throw error;
        fail(`execution failed in ${capabilityId}: ${error?.message ?? String(error)}`, 'CAPABILITY_RUN_FAILED');
      }
      if (rawResult && (typeof rawResult === 'object' || typeof rawResult === 'function') && typeof rawResult.then === 'function') {
        if (typeof rawResult.catch === 'function') rawResult.catch(() => {});
        fail(`${capabilityId}.run returned a Promise; runtime capabilities must be synchronous`, 'ASYNC_CAPABILITY');
      }
      const missing = descriptor.dependsOn.filter((dependency) => !called.has(dependency));
      if (missing.length > 0) fail(`${capabilityId} declared dependency ${missing.join(', ')} but it was not called`, 'UNUSED_DEPENDENCY');
      const resultSnapshot = canonicalClone(rawResult, `${capabilityId}.output`, limits.maxValueDepth);
      validateValue(resultSnapshot.value, descriptor.outputSchema, `${capabilityId}.output`);
      const resultBytes = utf8Length(resultSnapshot.canonical);
      if (resultBytes > limits.maxValueBytes) fail(`${capabilityId} output exceeds value limit (${limits.maxValueBytes} bytes)`, 'VALUE_SIZE_LIMIT');
      const identity = descriptorIdentity(descriptor, baseIdentity);
      const traceFields = {
        id: capabilityId,
        order: orders.get(capabilityId),
        identity,
        seed,
        inputCanonical: inputSnapshot.canonical,
        inputHash: fnv1a64(inputSnapshot.canonical),
        resultCanonical: resultSnapshot.canonical,
        resultHash: fnv1a64(resultSnapshot.canonical),
        randomDraws: state.randomDraws - randomDrawStart,
      };
      const traceBaseBytes = utf8Length(canonicalString({ ...traceFields, calls: [] }));
      chargeTrace(traceBaseBytes + Math.max(0, calls.length - 1), capabilityId);
      const trace = Object.freeze({ ...traceFields, calls: Object.freeze(calls) });
      return { value: deepFreeze(resultSnapshot.value), trace };
    }

    const execution = runNode(id, input, 1);
    const inputSnapshot = canonicalClone(input, `${id}.input`);
    const resultSnapshot = canonicalClone(execution.value, `${id}.result`);
    const identity = descriptorIdentity(descriptors.get(id), baseIdentity);
    const replay = Object.freeze({
      seed,
      inputCanonical: inputSnapshot.canonical,
      resultCanonical: resultSnapshot.canonical,
      inputHash: fnv1a64(inputSnapshot.canonical),
      resultHash: fnv1a64(resultSnapshot.canonical),
      calls: state.calls,
      tracePayloadBytes: state.tracePayloadBytes,
    });
    return Object.freeze({
      id,
      input: deepFreeze(inputSnapshot.value),
      result: execution.value,
      trace: execution.trace,
      identity,
      replay,
    });
  }

  function replay(prior) {
    if (!isPlainObject(prior)) fail('replay receipt must be an object', 'INVALID_REPLAY_RECEIPT');
    if (!isPlainObject(prior.replay)) fail('replay receipt is missing replay evidence', 'INVALID_REPLAY_RECEIPT');
    const fresh = execute(prior.id, prior.input, { seed: prior.replay.seed });
    const mismatches = [];
    const oldInputCanonical = safeCanonical(prior.input);
    const oldResultCanonical = safeCanonical(prior.result);
    if (prior.id !== fresh.id) mismatches.push('id');
    if (safeCanonical(prior.identity) !== safeCanonical(fresh.identity)) mismatches.push('identity');
    if (oldInputCanonical !== fresh.replay.inputCanonical || prior.replay.inputCanonical !== fresh.replay.inputCanonical) mismatches.push('inputCanonical');
    if (prior.replay.inputHash !== fresh.replay.inputHash) mismatches.push('inputHash');
    if (safeCanonical(prior.replay.seed) !== safeCanonical(fresh.replay.seed)) mismatches.push('seed');
    const exact = oldResultCanonical === fresh.replay.resultCanonical && prior.replay.resultCanonical === fresh.replay.resultCanonical;
    if (!exact) mismatches.push('result');
    if (prior.replay.resultCanonical !== fresh.replay.resultCanonical) mismatches.push('resultCanonical');
    const hash = prior.replay.resultHash === fresh.replay.resultHash;
    if (!hash) mismatches.push('resultHash');
    if (safeCanonical(prior.trace) !== safeCanonical(fresh.trace)) mismatches.push('trace');
    if (prior.replay.calls !== fresh.replay.calls) mismatches.push('calls');
    if (prior.replay.tracePayloadBytes !== fresh.replay.tracePayloadBytes) mismatches.push('tracePayloadBytes');
    return Object.freeze({
      receipt: fresh,
      matches: mismatches.length === 0,
      exact,
      hash,
      mismatches: Object.freeze([...new Set(mismatches)]),
    });
  }

  return Object.freeze({
    list,
    get,
    graph,
    execute,
    replay,
    orderPreference: () => preference,
    limits: () => Object.freeze({ ...limits }),
  });
}

function safeCanonical(value) {
  try {
    return canonicalString(value);
  } catch {
    return undefined;
  }
}
