import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveTargets } from '../affected-targets.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('Game Boy picker lists exactly the registered base-game overlays', () => {
  const catalog = readJson('experiences/gameboy/cartridges.json').cartridges;
  const registry = readJson('.tidy/manifest.json').types;
  const registered = Object.values(registry)
    .filter(item => typeof item.root === 'string' && item.root.startsWith('experiences/'))
    .map(item => ({ id: path.basename(item.root), entry: path.join(item.root, 'experience.json') }))
    .filter(item => fs.existsSync(path.join(root, item.entry)) && readJson(item.entry).base === 'gameboy')
    .map(item => item.id)
    .sort();
  assert.deepEqual(catalog.map(item => item.id).sort(), registered);
  assert.deepEqual(catalog.map(item => item.id), ['connect4', 'connect4-pxc', 'snake']);
});

test('two distinct Connect Four cartridges inherit Game Boy and keep their model outputs separate', () => {
  for (const id of ['connect4', 'connect4-pxc']) {
    const manifest = readJson(`experiences/${id}/experience.json`);
    assert.equal(manifest.base, 'gameboy');
    assert.equal(manifest.build, 'node build.mjs');
    assert.equal(manifest.outDir, 'dist');
    assert.equal(readJson('.tidy/manifest.json').types[`pxcube-${id}`].root, `experiences/${id}`);
  }
  assert.match(fs.readFileSync(path.join(root, 'experiences/connect4-pxc/build.mjs'), 'utf8'), /rules\.mjs/);
  assert.match(fs.readFileSync(path.join(root, 'experiences/connect4-pxc/build.mjs'), 'utf8'), /pxc\.mjs/);
});

test('the PXC cartridge target hashes its canonical rules and existing PxC runtime dependencies', async () => {
  const target = (await resolveTargets(root)).find(item => item.id === 'connect4-pxc');
  assert.ok(target, 'PxC cartridge has a package target');
  assert.ok(target.inputs.includes('experiences/connect4/rules.mjs'));
  assert.ok(target.inputs.includes('../../vendor/hh/services/pxc.mjs'));
});
