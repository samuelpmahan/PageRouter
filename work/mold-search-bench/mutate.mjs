// Mutation check for mold-search-v2.test.ts: each mutation must make the tests fail. Restores the file afterwards.
// Run from D:\PageRouter: node work/mold-search-bench/mutate.mjs
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = 'checkpoint/sources/pxcube/vendor/studio/upload-disc-to-shelf';
const file = `${dir}/mold-search.ts`;
const original = fs.readFileSync(file, 'utf8');
const MUTATIONS = {
  'whole word no better than substring': ['return 0.5 + Math.max', 'return 1.6 + Math.max'],
  'plus erased again': [".replace(/\\+/g, ' plus ')", ''],
  'accents not folded': [".replace(/\\p{M}/gu, '')", ''],
  'hyphen not joined': ["(joined !== folded ? ' ' + joined : '')", "''"],
  'untyped mold words ignored': ['untyped * 0.05', 'untyped * 0'],
};
let survived = 0;
try {
  for (const [name, [from, to]] of Object.entries(MUTATIONS)) {
    if (!original.includes(from)) throw new Error(`mutation "${name}" does not apply`);
    fs.writeFileSync(file, original.replace(from, to));
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--test', 'mold-search-v2.test.ts'], { cwd: dir, encoding: 'utf8', timeout: 300_000 });
    const failed = (run.stdout.match(/^not ok \d+ - (.*)$/gm) ?? []);
    console.log(`${failed.length ? 'caught  ' : 'SURVIVED'} ${name}${failed.length ? ` (${failed.length} tests failed)` : ''}`);
    if (!failed.length) survived++;
  }
} finally {
  fs.writeFileSync(file, original);
}
process.exit(survived ? 1 : 0);
