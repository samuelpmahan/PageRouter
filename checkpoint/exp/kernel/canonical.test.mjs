import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalLax, canonicalJson, validateJson} from './canonical.mjs';

// JSON data: both functions give the same RFC 8785 text.
const data = [
  [null, 'null'], [true, 'true'], [false, 'false'], [0, '0'], [-0, '0'], [1e21, '1e+21'], [1e-7, '1e-7'],
  [0.1 + 0.2, '0.30000000000000004'], [-1.5, '-1.5'], ['', '""'], ['a"b\\c\n\u0001', '"a\\"b\\\\c\\n\\u0001"'],
  ['€😀', '"€😀"'], [[], '[]'], [{}, '{}'], [[1, [2, [3]]], '[1,[2,[3]]]'],
  [{b: 1, a: [true, null], c: {z: '', y: {}}}, '{"a":[true,null],"b":1,"c":{"y":{},"z":""}}'],
  // Keys sort by UTF-16 code units, not by code point or locale.
  [{'😀': 1, 'ﬁ': 2, 'b': 3, 'B': 4, '10': 5, '9': 6}, '{"10":5,"9":6,"B":4,"b":3,"😀":1,"ﬁ":2}'],
  [Object.assign(Object.create(null), {b: 2, a: 1}), '{"a":1,"b":2}'],
  // An own "__proto__" key, as JSON.parse makes it, is ordinary data.
  [JSON.parse('{"z":0,"__proto__":{"a":1}}'), '{"__proto__":{"a":1},"z":0}'],
];

test('canonicalLax and canonicalJson write the same canonical text for JSON data', () => {
  for (const [value, text] of data) {
    assert.equal(canonicalLax(value), text);
    assert.equal(canonicalJson(value), text);
  }
});

test('canonical text parses back to equal data and is a fixed point', () => {
  for (const [value, text] of data) {
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(value)));
    assert.equal(canonicalLax(JSON.parse(text)), text);
  }
});

// canonicalLax: current behavior on values that are not JSON data. Each line is
// pinned on purpose. Changing one changes snapshot digests and the site build
// identity, so it must be a called change, not a side effect.
test('canonicalLax pins its current behavior on values that are not JSON data', () => {
  const cycle = {}; cycle.self = cycle;
  const cases = [
    ['[undefined] and [] collide', [undefined], '[]'],
    ['[] itself', [], '[]'],
    ['undefined between elements leaves an empty slot', [1, undefined, 2], '[1,,2]'],
    ['a sparse array keeps its hole', [, 1], '[,1]'],
    ['a function element leaves an empty slot', [() => 1], '[]'],
    ['NaN becomes null', NaN, 'null'],
    ['Infinity becomes null', Infinity, 'null'],
    ['-Infinity becomes null', -Infinity, 'null'],
    ['NaN inside an object becomes null', {a: NaN}, '{"a":null}'],
    ['{a:undefined} writes the word undefined (not JSON)', {a: undefined}, '{"a":undefined}'],
    ['a function property writes the word undefined', {f() {}}, '{"f":undefined}'],
    ['toJSON is not called', {toJSON: () => 'x'}, '{"toJSON":undefined}'],
    ['Date has no own keys', new Date(0), '{}'],
    ['Map has no own keys', new Map([[1, 2]]), '{}'],
    ['Set has no own keys', new Set([1]), '{}'],
    ['a boxed number has no own keys', Object(1), '{}'],
    ['a class instance writes its own keys', new (class P { constructor() { this.a = 1; } })(), '{"a":1}'],
    ['inherited keys are skipped', Object.assign(Object.create({inherited: 1}), {own: 2}), '{"own":2}'],
    ['a lone surrogate is escaped, not rejected', {'\ud800': '\udc00'}, '{"\\ud800":"\\udc00"}'],
  ];
  for (const [name, value, text] of cases) assert.equal(canonicalLax(value), text, name);
  assert.equal(canonicalLax(undefined), undefined, 'undefined gives undefined, not a string');
  assert.equal(canonicalLax(() => 1), undefined, 'a function gives undefined');
  assert.equal(canonicalLax(Symbol('s')), undefined, 'a Symbol gives undefined');
  assert.throws(() => canonicalLax(1n), TypeError, 'BigInt throws from JSON.stringify');
  assert.throws(() => canonicalLax(cycle), RangeError, 'a cycle overflows the stack');
});

// canonicalJson: anything that is not finite, acyclic, dense, plain JSON data
// throws a TypeError before any text is written.
test('canonicalJson rejects values that are not JSON data with a TypeError', () => {
  const cycle = {}; cycle.self = cycle;
  const cases = [
    [undefined, 'value is not finite JSON data.'],
    [() => 1, 'value is not finite JSON data.'],
    [Symbol('s'), 'value is not finite JSON data.'],
    [1n, 'value is not finite JSON data.'],
    [NaN, 'value contains a non-finite number.'],
    [Infinity, 'value contains a non-finite number.'],
    [[undefined], 'value[0] is not finite JSON data.'],
    [[, 1], 'value[0] is missing.'],
    [{a: undefined}, 'value.a is not finite JSON data.'],
    [{a: [1, {b: NaN}]}, 'value.a[1].b contains a non-finite number.'],
    [{toJSON: () => 'x'}, 'value.toJSON is not finite JSON data.'],
    [new Date(0), 'value must use plain JSON objects.'],
    [new Map(), 'value must use plain JSON objects.'],
    [Object(1), 'value must use plain JSON objects.'],
    [new (class P {})(), 'value must use plain JSON objects.'],
    [cycle, 'value.self contains a cycle.'],
  ];
  for (const [value, message] of cases) assert.throws(() => canonicalJson(value), {name: 'TypeError', message});
});

// Not RFC 8785: a lone surrogate is escaped, not rejected (canonicalize 5.1.0
// throws). Pinned as current behavior, like canonicalLax's.
test('canonicalJson escapes lone surrogates instead of rejecting them', () => {
  assert.equal(canonicalJson({'\ud800': '\udc00'}), '{"\\ud800":"\\udc00"}');
  assert.equal(canonicalJson(['a\udfff']), '["a\\udfff"]');
});

test('validateJson returns its input, uses the given label, and allows shared non-cyclic references', () => {
  const shared = {x: 1};
  const value = {a: shared, b: [shared, shared]};
  assert.equal(validateJson(value), value);
  assert.equal(canonicalJson(value), '{"a":{"x":1},"b":[{"x":1},{"x":1}]}');
  assert.throws(() => validateJson({n: Infinity}, 'rule parameters'), {name: 'TypeError', message: 'rule parameters.n contains a non-finite number.'});
  const list = []; list.push(list);
  assert.throws(() => validateJson(list, 'grid state'), {name: 'TypeError', message: 'grid state[0] contains a cycle.'});
});
