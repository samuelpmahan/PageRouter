import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { unpackSnapshot, validateSnapshot } from '../src/compiled-patch.mjs';
import { parseRoute, pinURL } from '../src/project-router.mjs';

const root = path.resolve(import.meta.dirname, '..');
const site = path.resolve(process.env.PAGEROUTER_SITE_ROOT ?? path.join(root, 'dist'));
const leaf = path.join(site, 'compiled/thro');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    assert.equal(entry.isSymbolicLink(), false, 'the assembled mount contains regular files');
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(path.join(directory, entry.name), relative) : [relative];
  });
}

test('thro has an independent route and an exact snapshot of its fresh PxCube package', async () => {
  const catalog = json(path.join(site, 'data/catalog.json'));
  assert.deepEqual(catalog.projects.slice(0, 4).map(project => project.id), ['pxcube', 'hh', 'justin', 'capability-lab']);
  const project = catalog.projects.find(project => project.id === 'thro');
  assert.ok(project, 'fresh thro mount must be in the assembled catalog');
  assert.equal(project.entry, 'index.html');
  assert.equal(project.trusted, true);
  assert.deepEqual(parseRoute('#/thro/run', catalog.projects), { project: 'thro', view: 'run', leaf: '' });
  assert.equal(pinURL(project, 'https://fixture.invalid/demo/'), 'https://fixture.invalid/demo/compiled/thro/index.html');
  const snapshot = unpackSnapshot(JSON.parse(gunzipSync(fs.readFileSync(path.join(site, 'data/thro.snapshot.json.gz')))));
  await validateSnapshot(snapshot);
  assert.equal(snapshot.project, 'thro');
  assert.equal(snapshot.digest, project.digest);
  const relativeFiles = files(leaf);
  assert.deepEqual([...relativeFiles].sort(), Object.keys(snapshot.files).sort());
  assert.equal(project.fileCount, relativeFiles.length);
  for (const relative of relativeFiles) {
    const bytes = fs.readFileSync(path.join(leaf, relative));
    assert.equal(sha(bytes), snapshot.files[relative].sha256, `snapshot must cover ${relative}`);
    assert.deepEqual(bytes, fs.readFileSync(path.join(site, 'compiled/pxcube/experiences/thro', relative)), `independent mount must reuse fresh package bytes: ${relative}`);
  }
});

test('assembled thro keeps its self-contained runtime imports and original prepared photos', () => {
  const pending = [path.join(leaf, 'thro-app.mjs')], visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(fs.existsSync(file), `missing module ${path.relative(leaf, file)}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1].split(/[?#]/, 1)[0]);
      assert.ok(target.startsWith(`${leaf}${path.sep}`), `runtime import escaped thro: ${match[1]}`);
      assert.ok(fs.existsSync(target), `missing local runtime import ${match[1]}`);
      if (/\.(?:mjs|js)$/.test(target)) pending.push(target);
    }
  }
  assert.ok(visited.has(path.join(leaf, 'locked-storage.mjs')));
  assert.ok(visited.has(path.join(leaf, 'renderer/src/media.js')));
  const fixture = json(path.join(leaf, 'prepared-fixture.json'));
  assert.equal(fixture.fixtureOnly, true);
  for (const disc of fixture.discs) assert.equal(sha(fs.readFileSync(path.join(leaf, disc.file))), disc.sha256, `prepared crop must retain exact bytes: ${disc.id}`);
});

test('thro build identity covers output bytes and retains honest fixture/auth status', () => {
  const info = json(path.join(leaf, 'BUILD_INFO.json'));
  assert.equal(info.product, 'thro');
  assert.equal(info.fixtureOnly, true);
  assert.equal(info.authentication, 'not-configured');
  assert.equal(info.humanAcceptance, 'pending');
  assert.match(info.sourceId, /^[a-f0-9]{64}$/);
  const hash = createHash('sha256');
  for (const name of files(leaf).filter(name => name !== 'BUILD_INFO.json')) hash.update(name).update('\0').update(fs.readFileSync(path.join(leaf, name))).update('\0');
  assert.equal(info.artifactId, hash.digest('hex'));
  const html = fs.readFileSync(path.join(leaf, 'index.html'), 'utf8');
  assert.match(html, /class="wordmark"[^>]*aria-label="thro"/);
  assert.match(html, /<use href="#brand-mark-header"\/>/);
  assert.match(html, /id="diagnostics"[^>]*hidden/);
});
