import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeTree} from './canonical.mjs';

test('freezeTree freezes a JSON tree in place, returns it, and leaves scalars alone', () => {
  const tree = {a: [1, {b: 2}], c: {d: []}};
  assert.equal(freezeTree(tree), tree);
  for (const node of [tree, tree.a, tree.a[1], tree.c, tree.c.d]) assert.ok(Object.isFrozen(node));
  assert.equal(freezeTree(5), 5);
  assert.equal(freezeTree(null), null);
  assert.doesNotThrow(() => freezeTree(tree));
});
