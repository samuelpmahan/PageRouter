// Canonical JSON text: object keys sorted by UTF-16 code units, no whitespace,
// strings and numbers written by JSON.stringify. For JSON data this is RFC 8785
// output (all six reference vectors pass).
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
// For input that must be JSON data, exp/block5/core/canonical.mjs canonicalJson
// validates first and throws a TypeError instead.

export function canonicalLax(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalLax).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalLax(value[k])}`).join(',')}}`;
}
