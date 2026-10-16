import {test} from 'node:test';
import assert from 'node:assert/strict';
import {equalJson} from './equal-json.mjs';

// Both argument orders must agree, so every pair is checked twice.
const both = (left, right) => [equalJson(left, right), equalJson(right, left)];
const ownKey = (object, key, value) => Object.defineProperty(object, key, {value, enumerable: true, writable: true, configurable: true});

// description, left, right, expected
const jsonCases = [
  ['equal numbers', 1, 1, true],
  ['different numbers', 1, 2, false],
  ['0 and -0 are equal (=== semantics)', 0, -0, true],
  ['equal strings', 'a', 'a', true],
  ['different strings', 'a', 'b', false],
  ['the number 1 and the string "1" are different', 1, '1', false],
  ['0 and null are different', 0, null, false],
  ['0 and false are different', 0, false, false],
  ['empty string and null are different', '', null, false],
  ['null equals null', null, null, true],
  ['equal booleans', true, true, true],
  ['different booleans', true, false, false],
  ['a number and an empty array are different', 1, [], false],
  ['an empty array and an empty object are different', [], {}, false],
  ['an empty array and null are different', [], null, false],
  ['an empty object and null are different', {}, null, false],
  ['an array and an object with the same index keys are different', [1, 2], {0: 1, 1: 2}, false],
  ['an array and an object with index keys and length are different', [1, 2], {0: 1, 1: 2, length: 2}, false],
  ['two empty arrays', [], [], true],
  ['two empty objects', {}, {}, true],
  ['equal arrays', [1, 'a', null, [true]], [1, 'a', null, [true]], true],
  ['arrays in a different order are different', [1, 2, 3], [3, 2, 1], false],
  ['arrays of different length are different', [1, 2], [1, 2, 3], false],
  ['a longer array with a different tail is different', [1, 2, 3], [1, 2, 4], false],
  ['equal nested arrays', [[1, [2]], [3]], [[1, [2]], [3]], true],
  ['nested arrays differing in one leaf', [[1, [2]], [3]], [[1, [9]], [3]], false],
  ['equal objects', {a: 1, b: 'x'}, {a: 1, b: 'x'}, true],
  ['objects with the same keys in a different order are equal', {a: 1, b: 2}, {b: 2, a: 1}, true],
  ['objects with a different value', {a: 1, b: 2}, {a: 1, b: 3}, false],
  ['an object with an extra key is different', {a: 1}, {a: 1, b: 2}, false],
  ['objects with the same key count and different keys', {a: 1}, {b: 1}, false],
  ['equal nested objects', {a: {b: {c: [1, {d: null}]}}}, {a: {b: {c: [1, {d: null}]}}}, true],
  ['nested objects differing in one deep value', {a: {b: {c: [1, {d: null}]}}}, {a: {b: {c: [1, {d: 0}]}}}, false],
  ['an object holding an array against an object holding an object', {a: []}, {a: {}}, false],
  // Keys that are also names on Object.prototype. These are legal JSON keys, and a
  // library that calls valueOf or toString, or reads constructor, mishandles them
  // (fast-deep-equal 3.1.3 throws a TypeError or answers false for equal clones).
  ['equal objects with a "toString" key', {toString: 'x'}, {toString: 'x'}, true],
  ['different objects with a "toString" key', {toString: 'x'}, {toString: 'y'}, false],
  ['equal objects with a "valueOf" key', {valueOf: 1}, {valueOf: 1}, true],
  ['different objects with a "valueOf" key', {valueOf: 1}, {valueOf: 2}, false],
  ['equal objects with a "constructor" key', {constructor: {a: 1}}, {constructor: {a: 1}}, true],
  ['different objects with a "constructor" key', {constructor: 1}, {constructor: 2}, false],
  ['equal objects with a "hasOwnProperty" key', {hasOwnProperty: 1}, {hasOwnProperty: 1}, true],
  ['an inherited name does not count as a key', {a: 1}, {toString: 1}, false],
  ['an own "__proto__" key, equal', JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"__proto__":{"a":1}}'), true],
  ['an own "__proto__" key, different value', JSON.parse('{"__proto__":1}'), JSON.parse('{"__proto__":2}'), false],
  ['an own "__proto__" key against a plain empty object', JSON.parse('{"__proto__":{}}'), {}, false],
  ['an own "__proto__" key is not matched by the inherited one (Object.prototype also has no keys)', JSON.parse('{"__proto__":{}}'), {a: 1}, false],
  ['an own "__proto__" key against the same value under another key',JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"b":{"a":1}}'), false],
  ['keys that are empty or hold odd characters', {'': 1, ' ': 2, 'a.b': 3, '日本': 4}, {'日本': 4, 'a.b': 3, ' ': 2, '': 1}, true],
];

test('answers the same for every JSON case, in both argument orders', () => {
  for (const [description, left, right, expected] of jsonCases) {
    assert.deepEqual(both(left, right), [expected, expected], description);
  }
});

test('an object is equal to itself without being searched', () => {
  const shared = {a: [1, {b: null}]};
  assert.equal(equalJson(shared, shared), true);
  assert.equal(equalJson([shared, 1], [shared, 1]), true);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(equalJson(cyclic, cyclic), true);
});

test('does not guard against cycles: two separate cyclic objects overflow the stack', () => {
  const make = () => { const node = {}; node.self = node; return node; };
  assert.throws(() => equalJson(make(), make()), RangeError);
});

test('does not mutate its arguments', () => {
  const left = {a: [1, {b: 2}], c: 'x'}, right = {c: 'x', a: [1, {b: 2}]};
  const before = JSON.stringify([left, right]);
  equalJson(left, right);
  assert.equal(JSON.stringify([left, right]), before);
});

// A seeded generator of JSON values (no -0, the one number deepStrictEqual separates from 0)
// checked against node:assert's deepStrictEqual, an independent definition of equality.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const KEYS = ['a', 'b', 'id', '', '0', '__proto__', 'constructor', 'toString', 'valueOf', 'length', '日本'];
const LEAVES = [null, true, false, 0, 1, -1, 0.5, 0.1 + 0.2, 0.3, 1e21, 5e-324, '', 'a', '1', 'null', 'é'];
function generate(r, depth = 0) {
  const roll = r();
  if (depth >= 4 || roll < 0.4) return LEAVES[Math.floor(r() * LEAVES.length)];
  if (roll < 0.7) return Array.from({length: Math.floor(r() * 5)}, () => generate(r, depth + 1));
  const object = {};
  for (let count = Math.floor(r() * 5); count > 0; count -= 1) ownKey(object, KEYS[Math.floor(r() * KEYS.length)], generate(r, depth + 1));
  return object;
}
const copy = value => (Array.isArray(value) ? value.map(copy) : value && typeof value === 'object'
  ? Object.keys(value).reduce((object, key) => ownKey(object, key, copy(value[key])), {}) : value);
const reverseKeys = value => (Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
  ? Object.keys(value).reverse().reduce((object, key) => ownKey(object, key, reverseKeys(value[key])), {}) : value);
// Replace one randomly chosen node of a copy with another random value.
function nearMiss(r, value) {
  const edit = (node) => {
    if (r() < 0.25 || node === null || typeof node !== 'object') return generate(r, 3);
    const keys = Object.keys(node);
    if (!keys.length) return generate(r, 3);
    const chosen = keys[Math.floor(r() * keys.length)];
    if (Array.isArray(node)) { const next = node.slice(); next[chosen] = edit(node[chosen]); return next; }
    return ownKey(copy(node), chosen, edit(node[chosen]));
  };
  return edit(copy(value));
}
const strictlyEqual = (left, right) => { try { assert.deepStrictEqual(left, right); return true; } catch { return false; } };

test('agrees with node:assert deepStrictEqual on thousands of generated JSON values and near misses', () => {
  const r = random(20261012);
  let equal = 0, different = 0;
  for (let index = 0; index < 3000; index += 1) {
    const value = generate(r);
    const pairs = [[value, copy(value)], [value, reverseKeys(value)], [value, nearMiss(r, value)], [nearMiss(r, value), value], [value, generate(r)]];
    for (const [left, right] of pairs) {
      const expected = strictlyEqual(left, right);
      assert.deepEqual(both(left, right), [expected, expected], `${JSON.stringify(left)} against ${JSON.stringify(right)}`);
      if (expected) equal += 1; else different += 1;
    }
  }
  assert.ok(equal > 6000 && different > 1000, `the sample must hold both outcomes (equal ${equal}, different ${different})`);
});

test('the one JSON difference from deepStrictEqual: 0 and -0 are equal here', () => {
  assert.equal(equalJson([0], [-0]), true);
  assert.equal(strictlyEqual([0], [-0]), false);
});

// Not promises. These pin what the copies in composed.mjs and runtime.mjs did before this
// module existed, for values that are not JSON, so a change here is a decision and not a surprise.
// fast-deep-equal 3.1.3 answers differently on each of them.
test('outside JSON: pinned behavior of the code this module replaced', () => {
  assert.equal(equalJson(NaN, NaN), false, 'NaN is never equal to NaN');
  assert.equal(equalJson([NaN], [NaN]), false);
  assert.equal(equalJson(new Date(0), new Date(1)), true, 'a Date has no own enumerable keys');
  assert.equal(equalJson(new Date(0), {}), true);
  assert.equal(equalJson(/a/, /b/), true, 'a RegExp has no own enumerable keys');
  assert.equal(equalJson(new Map([[1, 2]]), new Map()), true, 'a Map has no own enumerable keys');
  assert.equal(equalJson(new Set([1]), new Set()), true);
  assert.equal(equalJson({run: () => 1}, {run: () => 1}), false, 'functions are compared by identity');
  assert.equal(equalJson({run: Math.abs}, {run: Math.abs}), true);
  assert.equal(equalJson([, 1], [2, 1]), true, 'a hole in the left array is skipped');
  assert.equal(equalJson({a: undefined}, {}), false, 'an undefined value is still a key');
  assert.equal(equalJson({a: undefined}, {b: undefined}), false);
  assert.equal(equalJson({a: undefined}, {a: undefined}), true);
  assert.equal(equalJson(undefined, undefined), true);
  assert.equal(equalJson(undefined, null), false);
});
