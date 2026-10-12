// Canonical JSON, byte-compatible with exp/atlas/calculations.mjs in
// PageRouter, so crosscheck case ids match the ones recorded there.
function number(value, name = 'value') {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return value;
}
function object(value, name = 'value') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name} must be a plain object`);
  return value;
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(number(value));
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  object(value);
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
