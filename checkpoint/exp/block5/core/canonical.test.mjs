import test from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze, equalJson } from './canonical.mjs';

test('deepFreeze freezes a JSON tree in place, returns it, and leaves scalars alone', () => {
  const tree = { a: [1, { b: 2 }], c: { d: [] } };
  assert.equal(deepFreeze(tree), tree);
  for (const node of [tree, tree.a, tree.a[1], tree.c, tree.c.d]) assert.ok(Object.isFrozen(node));
  assert.equal(deepFreeze(5), 5);
  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze('x'), 'x');
  assert.doesNotThrow(() => deepFreeze(tree));
});

test('equalJson compares structure, not key order; arrays are ordered; types matter', () => {
  assert.ok(equalJson({ a: 1, b: [1, 2, { c: null }] }, { b: [1, 2, { c: null }], a: 1 }));
  assert.ok(equalJson(null, null) && equalJson('x', 'x') && equalJson([], []) && equalJson({}, {}));
  assert.ok(!equalJson([1, 2], [2, 1]));
  assert.ok(!equalJson({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!equalJson({ a: 1 }, { b: 1 }));
  assert.ok(!equalJson({ a: undefined }, { b: undefined }));
  assert.ok(!equalJson([], {}));
  assert.ok(!equalJson(1, '1'));
  assert.ok(!equalJson(null, {}));
});
