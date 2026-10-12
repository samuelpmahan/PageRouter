import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freezeTree, freezeTreeParentFirst, freeze} from './freeze.mjs';

const ALL = {freezeTree, freezeTreeParentFirst, freeze};

// An enumerable getter that records whether its owner was frozen when it ran.
function watched(owner, name, value, seen) {
  Object.defineProperty(owner, name, {get() { seen.push(Object.isFrozen(owner)); return value; }, enumerable: true, configurable: true});
  return owner;
}

for (const [name, fn] of Object.entries(ALL)) {
  test(`${name} freezes nested objects and arrays and returns its argument`, () => {
    const leaf = {c: 1}, inner = [2, [3]], root = {a: {b: leaf}, list: [{x: 1}, inner]};
    assert.equal(fn(root), root);
    for (const node of [root, root.a, leaf, root.list, root.list[0], inner, inner[1]]) assert.ok(Object.isFrozen(node));
  });

  test(`${name} returns primitives, null and undefined unchanged`, () => {
    for (const value of [undefined, null, 0, -0, 42, NaN, '', 'ab', true, false, 10n]) assert.ok(Object.is(fn(value), value));
    const symbol = Symbol('s');
    assert.equal(fn(symbol), symbol);
  });

  test(`${name} leaves functions, symbol keys, non-enumerable properties and Map entries alone`, () => {
    const fnProp = {}, method = function () {}; method.prop = fnProp;
    const bySymbol = {}, hidden = {}, entry = {}, map = new Map([['k', entry]]);
    const root = {method, [Symbol('k')]: bySymbol, map};
    Object.defineProperty(root, 'hidden', {value: hidden, enumerable: false});
    fn(root);
    assert.ok(Object.isFrozen(root) && Object.isFrozen(map));
    for (const node of [method, fnProp, bySymbol, hidden, entry]) assert.equal(Object.isFrozen(node), false);
    const lone = function () {}; lone.prop = {};
    assert.equal(fn(lone), lone);
    assert.equal(Object.isFrozen(lone), false);
  });
}

test('freezeTree visits children before the node', () => {
  const seen = [], root = watched({}, 'g', {}, seen);
  freezeTree(root);
  assert.deepEqual(seen, [false]);
  assert.ok(Object.isFrozen(root.g));
});

test('freezeTree does not descend into a frozen root or a frozen child', () => {
  const underRoot = {}, root = Object.freeze({child: underRoot});
  assert.equal(freezeTree(root), root);
  assert.equal(Object.isFrozen(underRoot), false);
  const grandchild = {}, sibling = {}, parent = {frozen: Object.freeze({grandchild}), sibling};
  freezeTree(parent);
  assert.ok(Object.isFrozen(parent) && Object.isFrozen(sibling));
  assert.equal(Object.isFrozen(grandchild), false);
});

test('freezeTree overflows the stack on a cycle of unfrozen nodes', () => {
  const a = {}, b = {a}; a.b = b;
  assert.throws(() => freezeTree(a), RangeError);
});

test('freezeTreeParentFirst freezes the node before its children', () => {
  const seen = [], root = watched({}, 'g', {}, seen);
  freezeTreeParentFirst(root);
  assert.deepEqual(seen, [true]);
  assert.ok(Object.isFrozen(root.g));
});

test('freezeTreeParentFirst skips frozen nodes and ends a cycle', () => {
  const underRoot = {}, root = Object.freeze({child: underRoot});
  freezeTreeParentFirst(root);
  assert.equal(Object.isFrozen(underRoot), false);
  const a = {}, b = {a}; a.b = b;
  assert.equal(freezeTreeParentFirst(a), a);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(b));
});

test('freeze visits children before the node and descends into frozen nodes', () => {
  const seen = [], root = watched({}, 'g', {}, seen);
  freeze(root);
  assert.deepEqual(seen, [false]);
  const underRoot = {}, frozenRoot = Object.freeze({child: underRoot});
  freeze(frozenRoot);
  assert.ok(Object.isFrozen(underRoot));
  const grandchild = {}, parent = {frozen: Object.freeze({grandchild})};
  freeze(parent);
  assert.ok(Object.isFrozen(grandchild));
});

test('freeze overflows the stack on any cycle, even under a frozen root', () => {
  const a = {}, b = {a}; a.b = b;
  assert.throws(() => freeze(a), RangeError);
  const c = {}, d = {c}; c.d = d; Object.freeze(c);
  assert.throws(() => freeze(c), RangeError);
});
