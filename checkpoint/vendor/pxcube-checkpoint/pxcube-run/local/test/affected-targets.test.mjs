import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveTargets } from '../affected-targets.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxcube-targets-'));
  fs.cpSync(repo, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}.pxcube`) });
  git(root, ['init', '-q']); git(root, ['config', 'user.email', 'test@example.test']); git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'base']);
  return root;
}
test('Studio source changes target its actual Studio consumers, not every Experience', async () => {
  const root = fixture();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.appendFileSync(path.join(root, 'vendor/studio/upload-disc-to-shelf/style.css'), '\n/* target fixture */\n');
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'studio']);
  const targets = await resolveTargets(root, { base });
  assert.deepEqual(targets.filter((target) => target.affected).map((target) => target.id), ['build-bag', 'explore-shelf', 'on-course', 'upload-disc-to-shelf', 'upload-disc-to-shelf-delta', 'your-shelf']);
  fs.rmSync(root, { recursive: true, force: true });
});
test('a launcher-only change does not invalidate an Experience package', async () => {
  const root = fixture();
  const base = git(root, ['rev-parse', 'HEAD']);
  fs.appendFileSync(path.join(root, 'launcher/shell.css'), '\n/* target fixture */\n');
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'launcher']);
  const targets = await resolveTargets(root, { base });
  assert.equal(targets.some((target) => target.affected), false);
  fs.rmSync(root, { recursive: true, force: true });
});
