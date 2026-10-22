// canonical-json@1: the one canonical JSON text for everything PageRouter hashes or uses as a key.
//
// This is the PxC kernel's contract (work/pxc-kernel/src/canonical.mjs `canonical`, the reference) as a
// dependency-free module that the deployed checkpoint code can import: dist/ flattens exp/, so it cannot
// reach into work/. The two files are twins. work/pxc-kernel/test/canonical-cases.mjs holds the contract
// as data and canonical-json.test.mjs checks this file against both those cases and the kernel itself.
// Change them together or not at all.
//
//   sorted keys (UTF-16 code unit order) | finite numbers, -0 folded to 0 | no cycles | depth <= 256
//
// Refused, never coerced (JSON.stringify would drop, null or rewrite each one, so two different values
// could share one hash): undefined, functions, symbols, BigInt, Date, Map, Set, typed arrays, class
// instances, holes, array properties that are not elements, symbol keys, accessors, non-enumerable
// fields, arrays with a foreign prototype.
//
// One option: { negativeZero: 'preserve' } writes -0 as `-0` instead of `0`. Only a lossless codec
// (checkpoint/exp/compression) needs it, because it must tell the two apart on the way back.

export const CONTRACT_ID = 'canonical-json@1';
export const MAX_DEPTH = 256;

export class CanonicalJsonError extends TypeError {
  constructor(message, code, path) {
    super(message);
    this.name = 'CanonicalJsonError';
    this.code = code;
    this.path = path;
  }
}

const INDEX = /^(0|[1-9]\d*)$/;

function fail(message, code, path) {
  throw new CanonicalJsonError(`Cannot canonicalize value: ${message}`, code, path);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value, path, depth, seen, zero) {
  if (depth > MAX_DEPTH) fail(`${path} exceeds depth ${MAX_DEPTH}`, 'VALUE_DEPTH', path);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) fail(`${path} is not a finite number`, 'NON_FINITE', path);
      return Object.is(value, -0) ? zero : String(value);
    case 'object': break;
    default: fail(`${path} is not JSON (${typeof value})`, 'NOT_JSON', path);
  }
  if (seen.has(value)) fail(`${path} contains a cycle`, 'CYCLE', path);
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${path} is not a plain array`, 'NOT_JSON', path);
    for (const key of Reflect.ownKeys(value)) {
      if (key !== 'length' && !(typeof key === 'string' && INDEX.test(key) && Number(key) < value.length)) {
        fail(`${path} has a property that is not an element (${String(key)})`, 'NOT_JSON', path);
      }
    }
    const items = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) fail(`${path}[${i}] is a hole`, 'SPARSE_ARRAY', `${path}[${i}]`);
      if (!('value' in Object.getOwnPropertyDescriptor(value, i))) fail(`${path}[${i}] is an accessor`, 'NOT_JSON', `${path}[${i}]`);
      items.push(walk(value[i], `${path}[${i}]`, depth + 1, seen, zero));
    }
    out = `[${items.join(',')}]`;
  } else {
    if (!isPlainObject(value)) fail(`${path} is not a plain object`, 'NOT_JSON', path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const d = descriptors[key];
      if (typeof key === 'symbol') fail(`${path} has a symbol key`, 'NOT_JSON', path);
      if (!d.enumerable) fail(`${path}.${key} is not enumerable`, 'NOT_JSON', `${path}.${key}`);
      if (!('value' in d)) fail(`${path}.${key} is an accessor`, 'NOT_JSON', `${path}.${key}`);
    }
    const keys = Object.keys(descriptors).sort();
    out = `{${keys.map((k) => {
      const field = descriptors[k].value;
      if (field === undefined) fail(`${path}.${k} is undefined`, 'NOT_JSON', `${path}.${k}`);
      return `${JSON.stringify(k)}:${walk(field, `${path}.${k}`, depth + 1, seen, zero)}`;
    }).join(',')}}`;
  }
  seen.delete(value);
  return out;
}

/** The canonical text of a JSON value, or a CanonicalJsonError (a TypeError with .code and .path). */
export function canonicalJson(value, { negativeZero = 'fold' } = {}) {
  if (negativeZero !== 'fold' && negativeZero !== 'preserve') {
    throw new RangeError(`negativeZero must be 'fold' or 'preserve', not ${String(negativeZero)}`);
  }
  return walk(value, '$', 0, new Set(), negativeZero === 'preserve' ? '-0' : '0');
}

/** The functions whose source defines the output, for providers that pin implementation source text. */
export const CANONICAL_JSON_FUNCTIONS = Object.freeze([canonicalJson, walk, isPlainObject, fail]);
