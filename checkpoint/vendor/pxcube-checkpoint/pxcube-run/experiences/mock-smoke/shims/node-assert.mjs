// Minimal browser stand-in for the default export of `node:assert/strict`.
// Covers the assertions the MockPxC test files use. deepEqual is structural
// over JSON-shaped values; this is not a full port of node's algorithm, and
// the file header says so on purpose.
const fmt = value => {
  try { const text = JSON.stringify(value); return text === undefined ? String(value) : text; }
  catch { return String(value); }
};
class AssertionError extends Error {
  constructor(message) { super(message); this.name = 'AssertionError'; }
}
const isObject = value => typeof value === 'object' && value !== null;
function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a), keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(key => Object.hasOwn(b, key) && deepEq(a[key], b[key]));
}
function ok(value, message) {
  if (!value) throw new AssertionError(message ?? `Expected a truthy value, got ${fmt(value)}`);
}
function equal(actual, expected, message) {
  if (actual !== expected) throw new AssertionError(message ?? `Expected ${fmt(expected)}, got ${fmt(actual)}`);
}
function notEqual(actual, expected, message) {
  if (actual === expected) throw new AssertionError(message ?? `Expected values to differ, both were ${fmt(actual)}`);
}
function strictEqual(actual, expected, message) {
  if (actual !== expected) throw new AssertionError(message ?? `Expected strict equality: ${fmt(actual)} !== ${fmt(expected)}`);
}
function notStrictEqual(actual, expected, message) {
  if (actual === expected) throw new AssertionError(message ?? `Expected strict inequality, both were ${fmt(actual)}`);
}
function deepEqual(actual, expected, message) {
  if (!deepEq(actual, expected)) throw new AssertionError(message ?? `Expected deep equality.\nactual:   ${fmt(actual)}\nexpected: ${fmt(expected)}`);
}
function notDeepEqual(actual, expected, message) {
  if (deepEq(actual, expected)) throw new AssertionError(message ?? `Expected deep inequality, got ${fmt(actual)}`);
}
function match(value, regexp, message) {
  if (typeof value !== 'string' || !regexp.test(value)) throw new AssertionError(message ?? `${fmt(value)} does not match ${String(regexp)}`);
}
function doesNotMatch(value, regexp, message) {
  if (typeof value === 'string' && regexp.test(value)) throw new AssertionError(message ?? `${fmt(value)} matches ${String(regexp)}`);
}
function throws(fn, expected, message) {
  if (typeof fn !== 'function') throw new TypeError('throws() expects a function');
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  if (!error) throw new AssertionError(typeof expected === 'string' ? expected : (message ?? 'Expected the function to throw'));
  if (expected instanceof RegExp) {
    const text = error && error.message ? error.message : String(error);
    if (!expected.test(text)) throw new AssertionError(message ?? `Thrown error ${fmt(text)} does not match ${String(expected)}`);
  } else if (typeof expected === 'function' && expected !== RegExp) {
    if (!(error instanceof expected)) throw new AssertionError(message ?? `Expected ${expected.name}, got ${error && error.constructor ? error.constructor.name : typeof error}`);
  }
}
function doesNotThrow(fn, message) {
  try { fn(); } catch (error) { throw new AssertionError(message ?? `Unexpected throw: ${error && error.message ? error.message : String(error)}`); }
}
function fail(message) { throw new AssertionError(message ?? 'Failed'); }
const assert = Object.assign(function assert(value, message) { ok(value, message); }, {
  ok, equal, notEqual, strictEqual, notStrictEqual,
  deepEqual, notDeepEqual, deepStrictEqual: deepEqual, notDeepStrictEqual: notDeepEqual,
  match, doesNotMatch, throws, doesNotThrow, fail, AssertionError,
});
export default assert;
