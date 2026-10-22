import { canonicalJson as canonicalize } from '../../canonical-json/canonical-json.mjs';

const plainObject = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function validateJson(value, label = 'value', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} is not finite JSON data.`);
  if (seen.has(value)) throw new TypeError(`${label} contains a cycle.`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError(`${label}[${index}] is missing.`);
      validateJson(value[index], `${label}[${index}]`, seen);
    }
  } else {
    if (!plainObject(value)) throw new TypeError(`${label} must use plain JSON objects.`);
    for (const key of Object.keys(value)) validateJson(value[key], `${label}.${key}`, seen);
  }
  seen.delete(value);
  return value;
}

/** canonical-json@1 (exp/canonical-json). Was a copy here that re-validated the whole tree at every level. */
export function canonicalJson(value) {
  return canonicalize(value);
}

export function hashState(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(canonicalJson(value))) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function cloneJson(value) {
  validateJson(value);
  return structuredClone(value);
}

/** Freeze a JSON tree in place, children first. Was deepFreeze (composed.mjs) and freezeJson (pixel-cache.mjs). */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Structural equality of JSON values (key order does not matter). Was a copy in composed.mjs and runtime.mjs. */
export function equalJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}
