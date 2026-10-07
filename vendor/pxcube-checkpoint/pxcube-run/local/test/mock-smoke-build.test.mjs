import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const experience = path.join(root, 'experiences/mock-smoke');

test('MockPxC browser package contains the app-imported test seam and its complete closure', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: experience, stdio: 'pipe' });
  const target = path.join(experience, 'dist/tests/local/test/test-seam.mjs');
  assert.ok(existsSync(target), 'app.mjs imports this path before running tests');
  const source = readFileSync(target, 'utf8');
  for (const [, relative] of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const resolved = path.resolve(path.dirname(target), relative);
    assert.ok(existsSync(resolved), `test seam import exists: ${relative}`);
  }
  assert.match(source, /export function setActiveTestSession/);
  assert.match(readFileSync(path.join(experience, 'dist/app.mjs'), 'utf8'), /\.\/tests\/local\/test\/test-seam\.mjs/);
});
