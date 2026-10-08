import { canonicalJson, validateJson } from './canonical.mjs';

function freezeJson(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export function createPixelCache() {
  const scopes = new Map();
  const canonicalEntries = new Map();
  let hits = 0;
  let misses = 0;

  function lookupCanonical(key) {
    if (typeof key !== 'string') throw new TypeError('Canonical cache key must be a string.');
    if (!canonicalEntries.has(key)) {
      misses += 1;
      return { hit: false, value: undefined };
    }
    hits += 1;
    return { hit: true, value: structuredClone(canonicalEntries.get(key)) };
  }

  function storeCanonical(key, value) {
    if (typeof key !== 'string') throw new TypeError('Canonical cache key must be a string.');
    canonicalEntries.set(key, freezeJson(structuredClone(validateJson(value, 'cache output'))));
    return value;
  }

  function lookupScopedCanonical(scope, key, { borrowed = false } = {}) {
    if (typeof scope !== 'string') throw new TypeError('Cache scope must be a canonical string.');
    if (typeof key !== 'string') throw new TypeError('Canonical scoped cache key must be a string.');
    const entries = scopes.get(scope);
    if (!entries?.has(key)) {
      misses += 1;
      return { hit: false, value: undefined };
    }
    hits += 1;
    const value = entries.get(key);
    return { hit: true, value: borrowed ? value : structuredClone(value) };
  }

  function storeScopedCanonical(scope, key, value) {
    if (typeof scope !== 'string') throw new TypeError('Cache scope must be a canonical string.');
    if (typeof key !== 'string') throw new TypeError('Canonical scoped cache key must be a string.');
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    scopes.get(scope).set(key, freezeJson(structuredClone(validateJson(value, 'cache output'))));
    return value;
  }

  function lookupScoped(scope, inputs, options) {
    return lookupScopedCanonical(scope, canonicalJson(inputs), options);
  }

  function storeScoped(scope, inputs, value) {
    return storeScopedCanonical(scope, canonicalJson(inputs), value);
  }

  return Object.freeze({
    lookup(request) {
      const scope = canonicalJson({ provider: request.provider, calculation: request.calculation, program: request.program ?? null });
      return lookupScoped(scope, request.inputs);
    },
    store(request, value) {
      const scope = canonicalJson({ provider: request.provider, calculation: request.calculation, program: request.program ?? null });
      return storeScoped(scope, request.inputs, value);
    },
    // Runtime callers can build one exact canonical key and reuse it for lookup/store.
    lookupCanonical,
    storeCanonical,
    lookupScoped,
    storeScoped,
    lookupScopedCanonical,
    storeScopedCanonical,
    clear() {
      scopes.clear();
      canonicalEntries.clear();
      hits = 0;
      misses = 0;
    },
    stats() {
      let entries = 0;
      for (const values of scopes.values()) entries += values.size;
      return Object.freeze({ entries: entries + canonicalEntries.size, hits, misses });
    },
  });
}
