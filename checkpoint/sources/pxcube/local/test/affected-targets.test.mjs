import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveTargets } from '../affected-targets.mjs';
import { loadManifest } from '../../crisp/lib/manifest.mjs';
import { provideExperience } from '../../tidy/manifest.mjs';

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
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    fs.appendFileSync(path.join(root, 'vendor/studio/upload-disc-to-shelf/style.css'), '\n/* target fixture */\n');
    git(root, ['add', '.']); git(root, ['commit', '-qm', 'studio']);
    const targets = await resolveTargets(root, { base });
    assert.deepEqual(targets.filter((target) => target.affected).map((target) => target.id), ['build-bag', 'explore-shelf', 'on-course', 'thro', 'upload-disc-to-shelf', 'upload-disc-to-shelf-delta', 'your-shelf']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('a launcher-only change does not invalidate an Experience package', async () => {
  const root = fixture();
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    const before = await resolveTargets(root, { base });
    fs.appendFileSync(path.join(root, 'launcher/shell.css'), '\n/* target fixture */\n');
    git(root, ['add', '.']); git(root, ['commit', '-qm', 'launcher']);
    const targets = await resolveTargets(root, { base });
    assert.equal(targets.some((target) => target.affected), false);
    assert.deepEqual(targets.map(({ id, packageKey }) => ({ id, packageKey })), before.map(({ id, packageKey }) => ({ id, packageKey })));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the registered thro manifest preserves the prepared Experience runtime contract', async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(repo, 'experiences/thro/experience.json')));
  assert.deepEqual(raw, { tidy: { type: 'pxcube-thro' } });
  const supplied = provideExperience(repo, 'pxcube-thro');
  assert.equal(supplied.root, 'experiences/thro');
  const { manifestSource, ...effective } = await loadManifest(path.join(repo, 'experiences/thro'));
  assert.equal(manifestSource.type, 'pxcube-thro');
  assert.equal(manifestSource.digest, supplied.digest);
  assert.deepEqual(effective, {
    id: 'thro', version: '0.1.0', title: 'thro',
    description: 'Generate video graphics from a prepared fixture shelf.',
    entry: 'index.html', mounts: ['studio'], build: 'node build.mjs', outDir: 'dist',
    sandbox: ['allow-scripts', 'allow-same-origin', 'allow-downloads', 'allow-modals', 'allow-forms'],
    demo: { mode: 'create' },
  });
});

test('thro shared build inputs invalidate its package key and target without affecting Hello', async t => {
  const root = fixture();
  try {
    const before = new Map((await resolveTargets(root)).map(target => [target.id, target]));
    for (const relative of [
      'local/build-studio.mjs',
      'local/studio-sandbox/style.css',
      'local/mock-mounts.mjs',
      'local/experience-mount.mjs',
      'local/scenarios.mjs',
      'vendor/studio/upload-disc-to-shelf/style.css',
      'local/studio-demo/model.mjs',
      'local/scene-host.mjs',
      'local/scenes/discstudio-photo-card.mjs',
      'vendor/studio-renderer/src/presentation.js',
    ]) {
      await t.test(relative, async () => {
        const file = path.join(root, relative), original = fs.readFileSync(file);
        try {
          fs.appendFileSync(file, '\n/* thro dependency regression */\n');
          const targets = new Map((await resolveTargets(root)).map(target => [target.id, target]));
          const consumers = ['thro'];
          if (relative === 'local/scene-host.mjs' || relative === 'local/scenes/discstudio-photo-card.mjs') {
            consumers.push('build-bag', 'create-graphics', 'export-graphics', 'on-course');
          }
          for (const id of consumers) {
            assert.notEqual(targets.get(id).packageKey, before.get(id).packageKey, `changed dependency must not reuse yesterday's ${id} package`);
            assert.equal(targets.get(id).affected, true, `${id} consumes the changed dependency`);
          }
          assert.equal(targets.get('hello').packageKey, before.get('hello').packageKey);
          assert.equal(targets.get('hello').affected, false);
        } finally { fs.writeFileSync(file, original); }
      });
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('thro runtime and fixture edits invalidate its package without changing unrelated packages', async t => {
  const root = fixture();
  try {
    const before = new Map((await resolveTargets(root)).map(target => [target.id, target]));
    for (const relative of ['experiences/thro/thro.css', 'experiences/thro/assets/discs/sample-servo.webp']) {
      await t.test(relative, async () => {
        const file = path.join(root, relative), original = fs.readFileSync(file);
        try {
          fs.appendFileSync(file, '\nfixture change');
          const targets = new Map((await resolveTargets(root)).map(target => [target.id, target]));
          assert.notEqual(targets.get('thro').packageKey, before.get('thro').packageKey);
          assert.equal(targets.get('thro').affected, true);
          for (const [id, target] of targets) if (id !== 'thro') {
            assert.equal(target.packageKey, before.get(id).packageKey, `${id} package remains reusable`);
            assert.equal(target.affected, false, `${id} is not a consumer of thro's own files`);
          }
        } finally { fs.writeFileSync(file, original); }
      });
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('thro typed definition changes invalidate its package and preserve an unrelated raw manifest', async () => {
  const root = fixture();
  try {
    const file = path.join(root, '.tidy/manifest.json');
    const registry = JSON.parse(fs.readFileSync(file));
    assert.ok(Object.hasOwn(registry.types, 'pxcube-thro'));
    const before = new Map((await resolveTargets(root)).map(target => [target.id, target]));
    registry.types['pxcube-thro'].experience.title = 'Prepared thro title';
    fs.writeFileSync(file, JSON.stringify(registry));
    const targets = new Map((await resolveTargets(root)).map(target => [target.id, target]));
    assert.notEqual(targets.get('thro').packageKey, before.get('thro').packageKey);
    assert.equal(targets.get('thro').affected, true);
    assert.equal(targets.get('hello').packageKey, before.get('hello').packageKey);
    assert.equal(targets.get('hello').affected, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
