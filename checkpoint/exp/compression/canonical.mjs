function fail(message) {
  throw new TypeError(`Cannot canonicalize value: ${message}`);
}

function encode(value, active) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('numbers must be finite');
    if (Object.is(value, -0)) return '-0';
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') fail(`${typeof value} is not JSON data`);
  if (active.has(value)) fail('cycles are not JSON data');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail('arrays must be plain');
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          fail('arrays may contain only indexed elements');
        }
      }
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail('sparse arrays are not JSON data');
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          fail('array elements must be enumerable data properties');
        }
        items.push(encode(descriptor.value, active));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('objects must be plain');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key === 'symbol')) {
      fail('symbol keys are not JSON data');
    }
    const keys = Object.keys(descriptors).sort();
    const fields = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail('object fields must be enumerable data properties');
      }
      fields.push(`${JSON.stringify(key)}:${encode(descriptor.value, active)}`);
    }
    return `{${fields.join(',')}}`;
  } finally {
    active.delete(value);
  }
}

export function canonical(value) {
  return encode(value, new Set());
}

export function clone(value) {
  return JSON.parse(canonical(value));
}

export function byteLength(value) {
  return new TextEncoder().encode(canonical(value)).byteLength;
}
