import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hashValue, KernelError } from '../src/canonical.mjs';
import { CASES, CONTRACT_ID } from './canonical-cases.mjs';

test(`${CONTRACT_ID}: the kernel is the reference implementation`, async (t) => {
  for (const c of CASES) {
    await t.test(c.name, () => {
      if ('ok' in c) {
        assert.equal(canonical(c.make()), c.ok);
      } else {
        assert.throws(() => canonical(c.make()), (e) => e instanceof KernelError && e.code === c.refuse, `expected ${c.refuse}`);
      }
    });
  }
});

test('a refusal names the path of the offending value', () => {
  assert.throws(() => canonical({ a: [1, { b: new Date(0) }] }), (e) => e.code === 'NOT_JSON' && /\$\.a\[1\]\.b/.test(e.message));
  const arr = [1]; arr.extra = 1;
  assert.throws(() => canonical({ k: arr }), (e) => /\$\.k/.test(e.message));
});

test('a getter is never invoked', () => {
  let calls = 0;
  const o = { get g() { calls += 1; return 1; } };
  assert.throws(() => canonical(o));
  assert.equal(calls, 0);
});

test('hashes of valid values do not move: a pinned sample of Part hashes', () => {
  const sample = { id: 'x', rows: [[1, 2.5, -0], { k: 'v', n: null }], ok: true };
  assert.equal(hashValue(sample).text, '{"id":"x","ok":true,"rows":[[1,2.5,0],{"k":"v","n":null}]}');
  assert.equal(hashValue(sample).hash, hashValue(JSON.parse(JSON.stringify(sample))).hash);
  assert.equal(hashValue(sample).hash, '6d21216ac1ced681');
  assert.equal(hashValue({ s: '\u00e9\ud83d\ude00\u2028', z: [], a: { b: {} }, n: 1e21 }).hash, '6011a29763b57f10');
});
