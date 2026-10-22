import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, CanonicalJsonError, CONTRACT_ID } from './canonical-json.mjs';
import { CASES, CONTRACT_ID as REFERENCE_ID } from '../../../work/pxc-kernel/test/canonical-cases.mjs';
import { canonical as kernel, KernelError } from '../../../work/pxc-kernel/src/canonical.mjs';

test('the shared module names the same contract as the kernel reference', () => {
  assert.equal(CONTRACT_ID, REFERENCE_ID);
});

test(`canonical-json module obeys ${REFERENCE_ID}`, async (t) => {
  for (const c of CASES) {
    await t.test(c.name, () => {
      if ('ok' in c) assert.equal(canonicalJson(c.make()), c.ok);
      else assert.throws(() => canonicalJson(c.make()), (e) => e instanceof CanonicalJsonError && e instanceof TypeError && e.code === c.refuse);
    });
  }
});

test('negativeZero: preserve keeps -0 distinct from 0 and nothing else changes', () => {
  const opt = { negativeZero: 'preserve' };
  assert.equal(canonicalJson(-0, opt), '-0');
  assert.equal(canonicalJson([-0, 0, 1], opt), '[-0,0,1]');
  assert.equal(canonicalJson({ b: -0, a: 0 }, opt), '{"a":0,"b":-0}');
  assert.ok(Object.is(JSON.parse(canonicalJson(-0, opt)), -0));
  assert.equal(canonicalJson(-0, { negativeZero: 'fold' }), '0');
  assert.throws(() => canonicalJson(1, { negativeZero: 'keep' }), RangeError);
  assert.throws(() => canonicalJson(NaN, opt), (e) => e.code === 'NON_FINITE');
});

test('a refusal carries a path and a code', () => {
  assert.throws(() => canonicalJson({ a: [1, { b: new Date(0) }] }), (e) => e.code === 'NOT_JSON' && e.path === '$.a[1].b' && /\$\.a\[1\]\.b/.test(e.message));
  assert.throws(() => canonicalJson([1, , 3]), (e) => e.code === 'SPARSE_ARRAY' && e.path === '$[1]');
});

test('a getter is never invoked', () => {
  let calls = 0;
  assert.throws(() => canonicalJson({ get g() { calls += 1; return 1; } }));
  assert.equal(calls, 0);
});

// A seeded generator of hostile and ordinary values. Whatever the kernel accepts, this module
// accepts with the same text; whatever the kernel refuses, this module refuses with the same code.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x1_0000_0000; };
}
function generate(next, depth) {
  const pick = (n) => Math.floor(next() * n);
  const leaf = [
    () => null, () => true, () => false, () => pick(1000) - 500, () => -0, () => NaN, () => Infinity, () => undefined,
    () => 0.1 * pick(30), () => 1e21 * next(), () => 'k' + pick(50), () => 'é\u{1F600} "\\', () => '\ud800',
    () => 10n, () => new Date(pick(1e9)), () => new Uint8Array(2), () => new Map(), () => Symbol('s'), () => () => 1,
  ];
  if (depth <= 0 || next() < 0.35) return leaf[pick(leaf.length)]();
  const kind = pick(10);
  if (kind < 4) return Array.from({ length: pick(4) }, () => generate(next, depth - 1));
  if (kind === 4) { const a = Array.from({ length: pick(4) + 1 }, () => generate(next, depth - 1)); delete a[pick(a.length)]; return a; }
  if (kind === 5) { const a = [generate(next, depth - 1)]; a.extra = 1; return a; }
  if (kind === 6) { const o = { a: generate(next, depth - 1) }; o[Symbol('k')] = 1; return o; }
  if (kind === 7) { const o = {}; Object.defineProperty(o, 'g', { get: () => 1, enumerable: true }); return o; }
  const o = {};
  for (let i = pick(4); i > 0; i -= 1) o[['b', 'a', '10', '9', 'é', '\u{1F600}', ''][pick(7)]] = generate(next, depth - 1);
  return o;
}

test('parity with the kernel on 4000 seeded values (accept: same text; refuse: same code)', () => {
  const next = rng(20261021);
  let accepted = 0; let refused = 0;
  for (let i = 0; i < 4000; i += 1) {
    const value = generate(next, 4);
    let want; let wantCode;
    try { want = kernel(value); } catch (e) { assert.ok(e instanceof KernelError); wantCode = e.code; }
    let got; let gotCode;
    try { got = canonicalJson(value); } catch (e) { assert.ok(e instanceof CanonicalJsonError); gotCode = e.code; }
    assert.equal(gotCode, wantCode, `case ${i}: ${String(wantCode)} vs ${String(gotCode)}`);
    assert.equal(got, want, `case ${i}`);
    if (wantCode) refused += 1; else accepted += 1;
  }
  assert.ok(accepted > 200 && refused > 200, `fuzz must exercise both sides (${accepted} accepted, ${refused} refused)`);
});
