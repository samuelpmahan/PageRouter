import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../run.mjs';
import { workspace, spec, setManifest, cli } from './scaffold-helpers.mjs';
import { provideExperience } from '../../tidy/manifest.mjs';
import { scaffoldExperience } from '../../crisp/lib/scaffold.mjs';

test('tidy provides a detached build definition and names missing or invalid inputs', () => {
  const repo = workspace();
  try {
    const first = provideExperience(repo, 'pxcube-build-bag');
    assert.equal(first.manifest.title, 'BuildBag');
    assert.equal(first.root, 'experiences/build-bag');
    first.manifest.title = 'mutated caller';
    assert.equal(provideExperience(repo, 'pxcube-build-bag').manifest.title, 'BuildBag');
    assert.throws(() => provideExperience(repo, 'absent'), /unknown type/);
    setManifest(repo, { 'pxcube-build-bag': { ...spec(), root: '../elsewhere' } });
    assert.throws(() => provideExperience(repo, 'pxcube-build-bag'), /root/);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('crisp generates reproducibly from tidy, supports a second id, and refuses to overwrite work', async () => {
  const a = workspace(), b = workspace();
  try {
    const first = await scaffoldExperience(a, 'pxcube-build-bag');
    const second = await scaffoldExperience(b, 'pxcube-build-bag');
    assert.deepEqual(first, second);
    for (const file of Object.keys(first.outputs)) assert.deepEqual(fs.readFileSync(path.join(a, first.root, file)), fs.readFileSync(path.join(b, second.root, file)));
    const authored = path.join(a, first.root, 'app.mjs');
    fs.appendFileSync(authored, '\n// my next contribution\n');
    await assert.rejects(scaffoldExperience(a, 'pxcube-build-bag'), /exists/);
    assert.match(fs.readFileSync(authored, 'utf8'), /my next contribution/);
    setManifest(a, { 'pxcube-build-bag': spec(), 'pxcube-second': spec('second') });
    assert.equal(cli(a, 'scaffold', '--from-tidy', 'pxcube-second').status, 0);
    assert.ok(fs.existsSync(path.join(a, 'experiences/second/app.mjs')));
    setManifest(a, { broken: { ...spec('broken'), experience: { ...spec().experience, scaffold: { ...spec().experience.scaffold, template: 'missing' } } } });
    await assert.rejects(scaffoldExperience(a, 'broken'), /template/);
    assert.equal(fs.existsSync(path.join(a, 'experiences/broken')), false);
  } finally { for (const repo of [a, b]) fs.rmSync(repo, { recursive: true, force: true }); }
});

test('CLI scaffold -> tidy-fed package -> launcher; a changed manifest changes the next build', async () => {
  const repo = workspace();
  try {
    const result = cli(repo, 'scaffold', '--from-tidy', 'pxcube-build-bag');
    assert.equal(result.status, 0, result.stderr);
    const before = fs.readFileSync(path.join(repo, 'experiences/build-bag/app.mjs'));
    const first = await build(repo);
    assert.equal(first.report.results[0].ok, true, first.report.results[0].error);
    const config = site => JSON.parse(fs.readFileSync(path.join(site, 'experiences/build-bag/config.json')));
    assert.equal(config(first.site).title, 'BuildBag');
    const changed = spec(); changed.experience.title = 'BuildBag — a new direction';
    setManifest(repo, { 'pxcube-build-bag': changed });
    const second = await build(repo);
    assert.equal(second.report.results[0].ok, true, second.report.results[0].error);
    assert.equal(config(second.site).title, changed.experience.title);
    assert.equal(config(first.site).title, 'BuildBag');
    assert.notEqual(first.report.results[0].sourceHash, second.report.results[0].sourceHash);
    assert.deepEqual(fs.readFileSync(path.join(repo, 'experiences/build-bag/app.mjs')), before);
    const receipt = JSON.parse(fs.readFileSync(path.join(second.site, 'experiences/build-bag/pxcube-receipt.json')));
    assert.equal(receipt.manifestSource.type, 'pxcube-build-bag');
    assert.equal(receipt.manifestSource.digest, provideExperience(repo, 'pxcube-build-bag').digest);
    assert.match(fs.readFileSync(path.join(second.site, 'index.html'), 'utf8'), /BuildBag/);
    changed.experience.mounts = ['missing'];
    setManifest(repo, { 'pxcube-build-bag': changed });
    const failed = await build(repo);
    assert.equal(failed.report.results[0].ok, false);
    assert.equal(fs.existsSync(path.join(failed.site, 'experiences/build-bag/index.html')), false);
    assert.equal(config(second.site).title, changed.experience.title);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
