import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const modules = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).sort();

test('a kernel module imports only other kernel modules', () => {
  for (const file of modules) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
      assert.match(specifier, /^\.\/[\w.-]+\.mjs$/, `${file} imports ${specifier}`);
      assert.ok(fs.existsSync(path.join(dir, specifier)), `${file} imports missing ${specifier}`);
    }
  }
});

test('every kernel module has a test beside it', () => {
  for (const file of modules) assert.ok(fs.existsSync(path.join(dir, file.replace(/\.mjs$/, '.test.mjs'))), `${file} has no test`);
});
