import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, buildSnapshot, createPatch, applyPatch, packSnapshot, unpackSnapshot, validateSnapshot } from '../../src/compiled-patch.mjs';

const bytes = (value) => Buffer.from(value, 'utf8').toString('base64');
const bin = (...values) => Buffer.from(values).toString('base64');
const project = (overrides = {}) => ({
  id: 'adversarial-fixture',
  sources: {
    'src/alpha.txt': { encoding: 'utf8', data: 'alpha\n' },
    'src/beta.txt': { encoding: 'utf8', data: 'βeta 🧪\n' },
    'src/blob.bin': { encoding: 'base64', data: bin(0, 255, 17, 0, 34, 128) },
    'src/empty.txt': { encoding: 'utf8', data: '' },
  },
  targets: [
    { id: 'independent', inputs: ['src/alpha.txt'], dependencies: [], outputs: { 'dist/independent.txt': { source: 'src/alpha.txt' } } },
    { id: 'duplicate-bytes', inputs: ['src/alpha.txt'], dependencies: [], outputs: { 'dist/alpha-copy.txt': { source: 'src/alpha.txt' } } },
    { id: 'bundle', inputs: ['src/alpha.txt', 'src/beta.txt'], dependencies: ['independent'], outputs: { 'dist/bundle.txt': { concat: ['src/alpha.txt', 'src/beta.txt'], separator: '--\n' } } },
    { id: 'binary', inputs: ['src/blob.bin'], dependencies: [], outputs: { 'dist/blob.bin': { source: 'src/blob.bin' } } },
    { id: 'empty', inputs: ['src/empty.txt'], dependencies: [], outputs: { 'dist/empty.txt': { source: 'src/empty.txt' } } },
  ],
  ...overrides,
});
const content = (snap, path) => Buffer.from(snap.files[path].data, 'base64');
const cloned = (x) => structuredClone(x);
const reject = (promise) => assert.rejects(promise);

 test('hash is SHA-256 over exact bytes and UTF-8 strings', async () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(await hash('abc'), expected);
  assert.equal(await hash(new Uint8Array([97, 98, 99])), expected);
});

test('snapshot is deterministic and carries output/source integrity metadata', async () => {
  const [a, b] = await Promise.all([buildSnapshot(project()), buildSnapshot(project())]);
  assert.deepEqual(a, b);
  assert.equal(a.schema, 'compiled-snapshot@1');
  assert.equal(a.project, 'adversarial-fixture');
  assert.ok(a.digest);
  assert.equal(content(a, 'dist/independent.txt').toString(), 'alpha\n');
  assert.equal(content(a, 'dist/empty.txt').length, 0);
  assert.deepEqual(content(a, 'dist/blob.bin'), Buffer.from([0, 255, 17, 0, 34, 128]));
  assert.equal(content(a, 'dist/bundle.txt').toString(), 'alpha\n--\nβeta 🧪\n');
  for (const file of Object.values(a.files)) {
    assert.equal(file.bytes, Buffer.from(file.data, 'base64').length);
    assert.ok(file.sha256);
  }
});

test('buildSnapshot accepts explicit prior baseline and reports unaffected outputs reused', async () => {
  const base = await buildSnapshot(project());
  const changed = project();
  changed.sources['src/beta.txt'] = { encoding: 'utf8', data: 'βeta changed 🧪\n' };
  const next = await buildSnapshot(changed, { baseline: base });
  assert.notEqual(next.digest, base.digest);
  assert.ok(next.build.rebuilt.includes('bundle'));
  assert.ok(next.build.reused.includes('independent'));
  assert.ok(next.build.reused.includes('binary'));
  assert.deepEqual(content(next, 'dist/independent.txt'), content(base, 'dist/independent.txt'));
  assert.deepEqual(content(next, 'dist/blob.bin'), content(base, 'dist/blob.bin'));
  assert.notDeepEqual(content(next, 'dist/bundle.txt'), content(base, 'dist/bundle.txt'));
});

test('declared dependency edits rebuild transitive closure and preserve unrelated branches', async () => {
  const base = await buildSnapshot(project());
  const changed = project();
  changed.sources['src/alpha.txt'] = { encoding: 'utf8', data: 'ALPHA\n' };
  const next = await buildSnapshot(changed, { baseline: base });
  assert.ok(next.build.rebuilt.includes('independent'));
  assert.ok(next.build.rebuilt.includes('bundle'));
  assert.ok(next.build.reused.includes('binary'));
  assert.ok(next.build.reused.includes('empty'));
  assert.match(content(next, 'dist/bundle.txt').toString(), /^ALPHA\n/);
});

test('patch round trip handles additions, deletions, UTF-8, binary, zero bytes, and patch chains', async () => {
  const a = await buildSnapshot(project());
  const bSpec = project();
  delete bSpec.sources['src/empty.txt'];
  bSpec.targets = bSpec.targets.filter((target) => target.id !== 'empty');
  bSpec.sources['src/new.txt'] = { encoding: 'utf8', data: '追加 🌲\n' };
  bSpec.targets.push({ id: 'new-file', inputs: ['src/new.txt'], dependencies: [], outputs: { 'dist/new.txt': { source: 'src/new.txt' } } });
  bSpec.sources['src/blob.bin'] = { encoding: 'base64', data: bin(255, 0, 1, 2, 0, 128, 254) };
  const b = await buildSnapshot(bSpec, { baseline: a });
  const patchAB = await createPatch(a, b);
  const appliedB = await applyPatch(a, patchAB);
  assert.deepEqual(appliedB, b);
  assert.equal(content(appliedB, 'dist/new.txt').toString(), '追加 🌲\n');
  assert.ok(!('dist/empty.txt' in appliedB.files));
  assert.deepEqual(content(appliedB, 'dist/blob.bin'), Buffer.from([255, 0, 1, 2, 0, 128, 254]));

  bSpec.sources['src/new.txt'] = { encoding: 'utf8', data: '連鎖 patch 🧵\n' };
  bSpec.sources['src/empty.txt'] = { encoding: 'utf8', data: 'restored' };
  bSpec.targets.push({ id: 'restored-file', inputs: ['src/empty.txt'], dependencies: [], outputs: { 'dist/restored.txt': { source: 'src/empty.txt' } } });
  const c = await buildSnapshot(bSpec, { baseline: appliedB });
  const patchBC = await createPatch(appliedB, c);
  assert.deepEqual(await applyPatch(appliedB, patchBC), c);
  assert.deepEqual(await applyPatch(a, patchAB), b);
});

test('patch is exact-baseline-bound and rejects wrong project or modified baseline', async () => {
  const a = await buildSnapshot(project());
  const bSpec = project(); bSpec.sources['src/beta.txt'] = { encoding: 'utf8', data: 'changed' };
  const b = await buildSnapshot(bSpec, { baseline: a });
  const patch = await createPatch(a, b);
  const wrongProject = await buildSnapshot(project({ id: 'other-project' }));
  await reject(applyPatch(wrongProject, patch));
  const altered = cloned(a);
  altered.files['dist/independent.txt'].data = bytes('tampered');
  await reject(applyPatch(altered, patch));
});

test('patch validation rejects malformed, duplicate, traversal, absolute, and tampered operations atomically', async () => {
  const a = await buildSnapshot(project());
  const bSpec = project(); bSpec.sources['src/beta.txt'] = { encoding: 'utf8', data: 'changed' };
  const b = await buildSnapshot(bSpec, { baseline: a });
  const patch = await createPatch(a, b);
  const baselineBefore = cloned(a);
  const mutations = [
    p => { p.schema = 'compiled-patch@999'; },
    p => { p.ops.push(cloned(p.ops[0])); },
    p => { p.ops[0].path = '../escape'; },
    p => { p.ops[0].path = '/absolute/escape'; },
    p => { p.ops[0].data = bin(9, 9, 9); },
    p => { p.ops[0].afterSha256 = '0'.repeat(64); },
    p => { p.ops[0].kind = 'splice'; p.ops[0].start = -1; p.ops[0].deleteCount = 0; },
    p => { p.targetDigest = 'wrong-target'; },
  ];
  for (const mutate of mutations) {
    const bad = cloned(patch); mutate(bad);
    await reject(applyPatch(a, bad));
    assert.deepEqual(a, baselineBefore, 'rejection must not mutate the baseline');
  }
});

test('project graph rejects missing dependencies, cycles, duplicate outputs, and unsafe paths', async () => {
  const base = project();
  const cases = [
    { ...base, targets: [...base.targets, { id: 'ghost-child', inputs: [], dependencies: ['missing'], outputs: {} }] },
    { ...base, targets: base.targets.map(t => t.id === 'independent' ? { ...t, dependencies: ['bundle'] } : t) },
    { ...base, targets: [...base.targets, { id: 'duplicate', inputs: ['src/alpha.txt'], dependencies: [], outputs: { 'dist/independent.txt': { source: 'src/alpha.txt' } } }] },
    { ...base, targets: [...base.targets, { id: 'traversal', inputs: ['src/alpha.txt'], dependencies: [], outputs: { '../outside.txt': { source: 'src/alpha.txt' } } }] },
    { ...base, sources: { ...base.sources, '../escape.txt': { encoding: 'utf8', data: 'bad' } } },
    { ...base, targets: [{ id: '__proto__', inputs: ['src/alpha.txt'], dependencies: [], outputs: { 'dist/proto.txt': { source: 'src/alpha.txt' } } }] },
    { ...base, targets: [{ id: 'constructor', inputs: ['src/alpha.txt'], dependencies: [], outputs: { 'dist/constructor.txt': { source: 'src/alpha.txt' } } }] },
  ];
  for (const invalid of cases) await reject(buildSnapshot(invalid));
});

test('snapshot metadata tampering is rejected even when the output bytes appear unchanged', async () => {
  const a = await buildSnapshot(project());
  const bSpec = project(); bSpec.sources['src/beta.txt'] = { encoding: 'utf8', data: 'changed' };
  const b = await buildSnapshot(bSpec, { baseline: a });
  const patch = await createPatch(a, b);
  const bad = cloned(patch);
  bad.manifest.sources['src/alpha.txt'] = '0'.repeat(64);
  await reject(applyPatch(a, bad));
});


test('packed snapshot delivery deduplicates exact byte payloads and round-trips losslessly', async () => {
  const snapshot = await buildSnapshot(project());
  const packed = packSnapshot(snapshot);
  assert.equal(packed.schema, 'compiled-snapshot-pack@1');
  assert.ok(Object.keys(packed.payloads).length < Object.keys(snapshot.files).length);
  assert.deepEqual(unpackSnapshot(packed), snapshot);
  await validateSnapshot(unpackSnapshot(packed));
});

test('tampered or missing packed payloads fail ordinary snapshot hash validation', async () => {
  const snapshot = await buildSnapshot(project());
  const packed = packSnapshot(snapshot);
  const bad = cloned(packed);
  const hashKey = Object.keys(bad.payloads)[0];
  bad.payloads[hashKey] = bytes('substituted payload');
  await reject(validateSnapshot(unpackSnapshot(bad)));
  const missing = cloned(packed);
  delete missing.payloads[Object.keys(missing.payloads)[0]];
  assert.throws(() => unpackSnapshot(missing));
});
