import test from 'node:test';
import assert from 'node:assert/strict';
import {byteLength, canonical, clone} from './canonical.mjs';

test('canonical JSON sorts object keys and retains prototype-looking data keys', () => {
  const value = JSON.parse('{"z":0,"__proto__":{"constructor":1},"a":[null,true,"x"]}');

  assert.equal(canonical(value), '{"__proto__":{"constructor":1},"a":[null,true,"x"],"z":0}');
  const copy = clone(value);
  assert.equal(Object.hasOwn(copy, '__proto__'), true);
  assert.deepEqual(copy, value);
});

test('canonical UTF-8 byte count includes multibyte characters', () => {
  assert.equal(byteLength({x: '𝌆'}), 12);
});

test('canonical clone preserves negative zero as a distinct finite JSON number', () => {
  assert.equal(canonical(-0), '-0');
  assert.equal(Object.is(clone(-0), -0), true);
});

test('canonical JSON rejects values JSON cannot represent faithfully', () => {
  const cycle = {};
  cycle.self = cycle;
  class Custom { constructor() { this.x = 1; } }
  const customArray = [];
  Object.setPrototypeOf(customArray, {});

  for (const value of [undefined, () => {}, Symbol('x'), NaN, Infinity, cycle, new Custom(), customArray]) {
    assert.throws(() => canonical(value), TypeError);
  }
});
