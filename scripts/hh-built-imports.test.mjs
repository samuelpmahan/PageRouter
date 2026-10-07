import {test} from 'node:test';
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
  assert.ok(visited.has(resolve(hhRoot, 'style-playground.mjs')), 'HH entry must reach the style adapter');
});
