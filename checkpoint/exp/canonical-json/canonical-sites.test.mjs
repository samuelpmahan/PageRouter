// Every canonical-JSON site in checkpoint/exp must obey the same contract (canonical-json@1).
// The cases live with the reference implementation, the PxC kernel, in work/pxc-kernel/test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, CONTRACT_ID } from '../../../work/pxc-kernel/test/canonical-cases.mjs';
import { canonicalJson as block5 } from '../block5/core/canonical.mjs';
import { canonical as compression } from '../compression/canonical.mjs';
import { canonical as atlas } from '../atlas/calculations.mjs';
import { canonical as patch } from '../../src/compiled-patch.mjs';

const NEGATIVE_ZERO_CASES = new Map([
  ['-0 folds to 0', '-0'],
  ['-0 in an array folds to 0', '[-0]'],
  ['-0 in an object folds to 0', '{"a":-0}'],
]);

const SITES = [
  { site: 'block5 canonicalJson', fn: block5, expectOk: (c) => c.ok },
  { site: 'atlas canonical', fn: atlas, expectOk: (c) => c.ok },
  { site: 'compiled-patch canonical', fn: patch, expectOk: (c) => c.ok },
  // The compression codec is lossless: it must tell -0 from 0, so it asks for the contract's
  // negativeZero 'preserve' form. That is its only difference.
  { site: 'compression canonical', fn: compression, expectOk: (c) => NEGATIVE_ZERO_CASES.get(c.name) ?? c.ok },
];

for (const { site, fn, expectOk } of SITES) {
  test(`${site} obeys ${CONTRACT_ID}`, async (t) => {
    for (const c of CASES) {
      await t.test(c.name, () => {
        if ('ok' in c) assert.equal(fn(c.make()), expectOk(c));
        else assert.throws(() => fn(c.make()), TypeError, `${site} must refuse (${c.refuse})`);
      });
    }
  });
}

test('every refusing site refuses with the contract error code', () => {
  for (const { site, fn } of SITES) {
    for (const c of CASES.filter((x) => 'refuse' in x)) {
      assert.throws(() => fn(c.make()), (e) => e.code === c.refuse, `${site}: ${c.name} must carry code ${c.refuse}`);
    }
  }
});
