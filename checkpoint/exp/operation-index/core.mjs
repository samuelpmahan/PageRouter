const FORMAT_VERSION = 1;
const DEFAULT_STORAGE_KEY = 'operation-index:v1';
const MAX_JSON_DEPTH = 64;

function cloneJson(value, path = '$', depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new TypeError(`${path} exceeds maximum JSON depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite numbers`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => cloneJson(entry, `${path}[${index}]`, depth + 1));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${path}.${key} must be a JSON data property`);
      Object.defineProperty(copy, key, { value: cloneJson(descriptor.value, `${path}.${key}`, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return copy;
  }
  throw new TypeError(`${path} must contain finite JSON data`);
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('crypto.randomUUID is required; provide idFactory in this environment');
}

function readStorage(storage, storageKey) {
  if (!storage) return { runs: [], droppedCount: 0 };
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return { runs: [], droppedCount: 0 };
    const parsed = JSON.parse(raw);
    if (parsed?.formatVersion !== FORMAT_VERSION || !Array.isArray(parsed.runs)) {
      throw new TypeError('stored index has an unsupported shape');
    }
    return {
      runs: cloneJson(parsed.runs, '$.runs'),
      droppedCount: Number.isSafeInteger(parsed.droppedCount) && parsed.droppedCount >= 0 ? parsed.droppedCount : 0,
    };
  } catch (error) {
    return { runs: [], droppedCount: 0, error: `read: ${error?.message ?? String(error)}` };
  }
}

/** A small bounded, JSON-only index. `source` is caller-supplied provenance; times are never inferred. */
export function createOperationIndex({
  now = () => new Date().toISOString(),
  idFactory = defaultId,
  storage,
  storageKey = DEFAULT_STORAGE_KEY,
  maxRuns = 100,
  maxRunBytes = 1_000_000,
} = {}) {
  if (typeof now !== 'function' || typeof idFactory !== 'function') throw new TypeError('now and idFactory must be functions');
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 1) throw new TypeError('maxRuns must be a positive safe integer');
  if (!Number.isSafeInteger(maxRunBytes) || maxRunBytes < 1) throw new TypeError('maxRunBytes must be a positive safe integer');
  if (storage && (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function')) {
    throw new TypeError('storage must implement getItem and setItem');
  }
  const initial = readStorage(storage, storageKey);
  let runs = initial.runs.slice(-maxRuns);
  let droppedCount = initial.droppedCount + Math.max(0, initial.runs.length - maxRuns);
  let sequence = runs.reduce((max, run) => Math.max(max, Number.isSafeInteger(run.sequence) ? run.sequence : 0), 0);
  let storageError = initial.error ?? null;
  const listeners = new Set();
  const usedIds = new Set(runs.map((run) => run.id));

  function snapshot() {
    return cloneJson({
      formatVersion: FORMAT_VERSION,
      runs,
      limits: { maxRuns, maxRunBytes },
      droppedCount,
      storage: { enabled: Boolean(storage), error: storageError },
    });
  }

  function persist() {
    if (!storage) return;
    try {
      storageError = null;
      storage.setItem(storageKey, JSON.stringify(snapshot()));
    } catch (error) {
      storageError = `write: ${error?.message ?? String(error)}`;
    }
  }

  function notify() {
    for (const listener of [...listeners]) {
      try { listener(snapshot()); } catch { /* One observer cannot interrupt the index or another observer. */ }
    }
  }

  function record(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('record input must be an object');
    for (const key of ['runtime', 'action', 'source', 'status', 'operations', 'edges', 'evidence']) {
      if (!(key in input)) throw new TypeError(`record input is missing ${key}`);
    }
    if (!Array.isArray(input.operations) || !Array.isArray(input.edges)) throw new TypeError('operations and edges must be arrays');
    const observedAt = now();
    if (typeof observedAt !== 'string' && typeof observedAt !== 'number') throw new TypeError('now() must return a string or number');
    const baseId = String(idFactory());
    if (!baseId) throw new TypeError('idFactory() must return a non-empty ID');
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}~${suffix++}`;
    const nextSequence = sequence + 1;
    const run = cloneJson({ ...input, id, sequence: nextSequence, observedAt });
    if (new TextEncoder().encode(JSON.stringify(run)).byteLength > maxRunBytes) {
      throw new RangeError(`record exceeds maxRunBytes (${maxRunBytes})`);
    }
    sequence = nextSequence;
    usedIds.add(id);
    runs.push(run);
    if (runs.length > maxRuns) {
      const excess = runs.length - maxRuns;
      runs.splice(0, excess);
      droppedCount += excess;
    }
    persist();
    notify();
    return cloneJson(run);
  }

  function clear() {
    droppedCount += runs.length;
    runs = [];
    persist();
    notify();
    return snapshot();
  }

  return Object.freeze({
    record,
    list: () => cloneJson(runs),
    snapshot,
    exportJSON: () => JSON.stringify(snapshot()),
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear,
  });
}
