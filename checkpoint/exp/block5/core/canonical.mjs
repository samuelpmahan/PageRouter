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

export function canonicalJson(value) {
  validateJson(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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
