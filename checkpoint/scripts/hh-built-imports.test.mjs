import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve, dirname, relative} from 'node:path';

const hhRoot = resolve(import.meta.dirname, '../dist/compiled/hh');

test('built HH entry resolves its local module imports', () => {
  const pending = [resolve(hhRoot, 'app.mjs')];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(existsSync(file), `Missing built module ${relative(hhRoot, file)}`);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1].split(/[?#]/, 1)[0]);
      assert.ok(existsSync(target), `${relative(hhRoot, file)} imports missing ${match[1]}`);
      if (/\.(?:mjs|js)$/.test(target)) pending.push(target);
    }
  }
  // The public page is an examinable demo, not a test bench (Sam, 30 Oct: "We don't need fast-check or devtools").
  for (const left of ['style-playground.mjs', 'pxc-devtools/devtools.mjs', 'vendor/fast-check-4.10.2.bundle.mjs']) {
    assert.ok(!visited.has(resolve(hhRoot, left)), `HH entry must not reach ${left}`);
    assert.ok(!existsSync(resolve(hhRoot, left)), `HH must not ship ${left}`);
  }
});

test('PageRouter entry URL selects its exact module bytes instead of a cached older app', () => {
  const root = resolve(hhRoot, '../..');
  const moduleDigest = createHash('sha256').update(readFileSync(resolve(root, 'app.mjs'))).digest('hex');
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert.ok(html.includes(`src="app.mjs?v=${moduleDigest}"`),
    'The root module URL must change with its exact bytes, independent of build clocks');
});
