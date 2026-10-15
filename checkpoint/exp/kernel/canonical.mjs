// Canonical JSON text: object keys sorted by UTF-16 code units, no whitespace,
// strings and numbers written by JSON.stringify. For JSON data this is RFC 8785
// output (all six reference vectors pass). canonicalLax and canonicalJson
// differ only on values that are not JSON data, and both behaviors are
// depended on.
//
// canonicalLax never checks its input. Its output feeds snapshot digests and
// the site build identity, so its bytes must not change, including on these
// inputs, which canonical.test.mjs pins as current behavior:
//   [undefined] and [] both give "[]"; [,1] gives "[,1]"
//   NaN and Infinity give "null"
//   {a:undefined} gives {"a":undefined}, which is not JSON
//   Date and Map give "{}"; toJSON is not called
//   undefined, a function or a Symbol gives undefined, not a string
//   a cycle overflows the stack (RangeError)
//
// canonicalJson runs validateJson first, so anything that is not finite,
// acyclic, dense, plain JSON data throws a TypeError naming where it failed;
// canonical.test.mjs pins each message. plainObject, validateJson and
// canonicalJson moved here verbatim from exp/block5/core/canonical.mjs, which
// re-exports validateJson and canonicalJson. exp/block5/core/providers.mjs
// hashes the source text of validateJson and canonicalJson (fn.toString())
// into PROVIDER_IDENTITY.implementationId, so any edit to either function's
// text, even whitespace, changes block5's provider identity.

export function canonicalLax(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLax).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalLax(value[k])}`).join(',')}}`;
}

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
