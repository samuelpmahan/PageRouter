import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const runtime = process.env.THRO_PACKAGE_RUNTIME ? pathToFileURL(process.env.THRO_PACKAGE_RUNTIME.replaceAll('\\', '/') + '/') : new URL('../../experiences/thro/dist/', import.meta.url);
const api = await import(new URL('workspace-package.mjs', runtime));
const { openWorkspace } = await import(new URL('workspace.mjs', runtime));
// CI can generate the documented v1 envelope without a private multi-MiB fixture.
// A task run can additionally supply the actual previously delivered package.
async function exampleV1() {
  if (process.env.THRO_V1_EXAMPLE) return JSON.parse(fs.readFileSync(process.env.THRO_V1_EXAMPLE, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('prepared-fixture.json', runtime)));
  const fixture = manifest.discs.map(disc => ({ ...disc, depiction: { kind: 'photo', name: disc.name, src: `data:image/webp;base64,${fs.readFileSync(new URL(disc.file, runtime)).toString('base64')}` } }));
  const values = new Map(), backing = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const lock = { request: async (_name, _options, action) => action() };
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  const rows = workspace.model.experience.shelf();
  await workspace.createBag('Known v1 data profile fixture', [rows[2].address, rows[0].address]);
  await workspace.keep(await workspace.single(rows[0].address));
  const identity = { sourceId: 'efb93ae994ed5316e946302a6cdba1bb64669223ed3a953cbb468226f9da8911', artifactId: '865250c1941bc52319e42c03a59501b9ad892c74545de5f4ed84a158be53eef2', nativeRendererBuild: '28ac2b39fab85255' };
  const output = await workspace.exportPackage({ identity, provenance: { syntheticV1Envelope: true } });
  return { schema: 'thro-workspace-package@1', version: 1, identity, provenance: { syntheticV1Envelope: true }, archive: output.archive };
}
const delivered = await exampleV1();
const identity = { ...delivered.identity, sourceId: 'a'.repeat(64), artifactId: 'b'.repeat(64) };
const legacyProfile = 'thro-delivered-workspace-v1@1';
const storage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const locks = { request: async (_name, _options, action) => action() };
const sha = raw => createHash('sha256').update(raw).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
function seal(value) {
  if (value.version !== 2) return value;
  const { raw: _raw, ...archive } = value.archive;
  value.integrity = { algorithm: 'sha256', sha256: sha(canonical({ schema: value.schema, version: value.version, compatibility: value.compatibility, origin: value.origin, extensions: value.extensions, archive })) };
  return value;
}
async function v2(options = {}) { return api.createWorkspacePackage({ raw: delivered.archive.raw, identity, provenance: { label: 'Synthetic compatibility test' }, ...options }); }
function rewritten(input, fn) {
  const value = structuredClone(input), raw = JSON.parse(value.archive.raw); fn(raw);
  value.archive.raw = JSON.stringify(raw); value.archive.byteLength = Buffer.byteLength(value.archive.raw); value.archive.sha256 = sha(value.archive.raw); return seal(value);
}
function decode(value) { if ('scalar' in value) return value.scalar; if (value.array) return value.array.map(decode); if (value.object) return Object.fromEntries(value.object.map(([key, item]) => [key, decode(item)])); return { part: value.part }; }
function encode(value) { if (value === null || typeof value !== 'object') return { scalar: value }; if (Array.isArray(value)) return { array: value.map(encode) }; return { object: Object.entries(value).map(([key, item]) => [key, encode(item)]) }; }

test('v2 derives data requirements and accepts a UI-only producer identity change', async () => {
  const value = await v2();
  assert.equal(value.schema, 'thro-workspace-package@2');
  assert.equal(value.compatibility.dataSchema, 'thro-workspace-state@1');
  assert.equal(value.compatibility.editProfile, 'thro-prepared-workspace@1');
  assert.ok(value.compatibility.requiredCapabilities.includes('studio-single-svg@1'));
  assert.deepEqual(value.origin.identity, identity);
  const target = storage();
  await api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:v2-ui-change', package: value, expectedIdentity: delivered.identity });
  assert.equal((await openWorkspace({ storage: target, locks, key: 'thro.test:v2-ui-change' })).model.context.graphics.length, 1);
});

test('delivered v1 has an explicit reader profile, independent of recipient app hashes', async () => {
  const target = storage();
  await api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:v1-new-runtime', package: delivered, legacyProfile, expectedIdentity: identity });
  assert.equal(target.values.size, 1);
  await assert.rejects(api.adoptWorkspacePackage({ storage: storage(), locks, key: 'thro.test:v1-no-policy', package: delivered }), { code: 'THRO_PACKAGE_UNSUPPORTED' });
  const unrecognized = structuredClone(delivered); unrecognized.identity.sourceId = 'f'.repeat(64);
  const report = await api.inspectWorkspacePackage({ package: unrecognized, legacyProfile });
  assert.equal(report.editable, false); assert.equal(report.captures.length, 1);
  await assert.rejects(api.adoptWorkspacePackage({ storage: storage(), locks, key: 'thro.test:unmapped-v1', package: unrecognized, legacyProfile }), { code: 'THRO_PACKAGE_UNSUPPORTED' });
});

test('static inspection exposes retained SVG despite unknown edit ABI without renderer or replay', async () => {
  const value = await v2();
  const unknown = rewritten(value, raw => { raw.nodes.find(node => node.function === 'fn.studio.card').function = 'fn.future.card'; });
  unknown.compatibility.editProfile = 'future-workspace@9';
  seal(unknown);
  const report = await api.inspectWorkspacePackage({ package: unknown });
  assert.equal(report.editable, false);
  assert.equal(report.status, 'unsupported');
  assert.equal(report.captures.length, 1);
  assert.equal(report.captures[0].format, 'svg');
  assert.equal(sha(report.captures[0].svg), report.captures[0].hash);
  assert.equal(report.captures[0].png, null, 'legacy export records do not contain original PNG bytes');
  const target = storage();
  await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:future', package: unknown }), { code: 'THRO_PACKAGE_UNSUPPORTED' });
  assert.equal(target.values.size, 0);
});

test('undeclared or unknown required capabilities fail adoption without writing', async () => {
  for (const change of [value => value.compatibility.requiredCapabilities.push('future-required@7'), value => { value.compatibility.requiredCapabilities = []; }]) {
    const value = await v2(); change(value); seal(value);
    const target = storage();
    await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:missing-requirements', package: value }));
    assert.equal(target.values.size, 0);
  }
  for (const value of [{ schema: 'thro-workspace-package@99', version: 99, opaque: ['retain me'] }, rewritten(await v2(), raw => { raw.version = 99; })]) {
    const before = JSON.stringify(value), target = storage();
    const report = await api.inspectWorkspacePackage({ package: value });
    assert.equal(report.status, 'unsupported'); assert.equal(report.captures.length, 0);
    assert.equal(JSON.stringify(value), before);
    await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:future-outer', package: value }), { code: 'THRO_PACKAGE_UNSUPPORTED' });
    assert.equal(target.values.size, 0);
  }
});

test('canonical envelope integrity covers origin, requirements and optional metadata independently of raw hash', async () => {
  const value = await v2();
  assert.equal(value.integrity?.algorithm, 'sha256');
  assert.equal(value.integrity.sha256, seal(structuredClone(value)).integrity.sha256);
  const tampered = structuredClone(value); tampered.origin.provenance.label = 'Altered metadata';
  const target = storage();
  await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:tampered-origin', package: tampered }), { code: 'THRO_PACKAGE_INVALID' });
  assert.equal(target.values.size, 0);
});

test('saved native PNG remains inspectable when its recipe build is unsupported for editing', async () => {
  const { createNativeRenderer, nativeDesign } = await import(new URL('native-cards.mjs', runtime));
  const manifest = JSON.parse(fs.readFileSync(new URL('prepared-fixture.json', runtime)));
  const fixture = manifest.discs.map(disc => ({ ...disc, depiction: { kind: 'photo', name: disc.name, src: `data:image/webp;base64,${fs.readFileSync(new URL(disc.file, runtime)).toString('base64')}` } }));
  // Deliberately only a synthetic header carrier, not a browser-pixel claim.
  const header = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(header); header.write('IHDR', 12); header.writeUInt32BE(1920, 16); header.writeUInt32BE(1080, 20);
  const png = `data:image/png;base64,${header.toString('base64')}`;
  const renderGraphic = createNativeRenderer(async request => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image width="1920" height="1080" href="${png}"/></svg>`, width: 1920, height: 1080, build: identity.nativeRendererBuild, placement: { scale: request.scale, dx: 0, dy: 0 } }));
  const workspace = await openWorkspace({ storage: storage(), locks, fixture, renderGraphic });
  const design = nativeDesign(workspace.model.context.design, 'discstudio:b01');
  await workspace.change({ design }); await workspace.keep(await workspace.single(workspace.model.context.selectedDisc, design));
  const known = await workspace.exportPackage({ identity });
  const dormant = rewritten(known, raw => {
    const pair = raw.bindings.filter(([name]) => /^ds\.px\.studio\.demo\.\d+\.context$/.test(name)).at(-1);
    const node = raw.nodes.find(item => item.id === pair[1]), context = decode(node.material);
    context.singleDesign.rendererBuild = 'future-build'; delete node.calculation; delete node.inputs; node.material = encode(context);
  });
  await assert.rejects(api.inspectWorkspacePackage({ package: dormant }), { code: 'THRO_PACKAGE_INVALID' }, 'dormant recipe cannot omit its content-derived requirement');
  const unknown = rewritten(known, raw => {
    const visit = tag => {
      if (tag.scalar === '28ac2b39fab85255') tag.scalar = 'future-build';
      if (tag.array) tag.array.forEach(visit);
      if (tag.object) tag.object.forEach(([, value]) => visit(value));
    };
    raw.nodes.filter(node => node.material).forEach(node => visit(node.material));
  });
  unknown.compatibility.requiredCapabilities = unknown.compatibility.requiredCapabilities.filter(item => !item.startsWith('discstudio-recipe@'));
  unknown.compatibility.requiredCapabilities.push('discstudio-recipe@future-build/b01'); seal(unknown);
  const report = await api.inspectWorkspacePackage({ package: unknown });
  assert.equal(report.editable, false);
  assert.equal(report.captures[0].png, png);
  const capture = JSON.parse(unknown.archive.raw).nodes.map(node => node.material && decode(node.material)).find(value => value?.schema === 'studio-graphic@1');
  assert.deepEqual(report.captures[0].provenance, capture.graphic.provenance);
  assert.ok(report.missing.includes('discstudio-recipe@future-build/b01'));
  const target = storage();
  await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks, key: 'thro.test:unknown-native-recipe', package: unknown, renderGraphic: () => { throw Error('Must not render'); } }), { code: 'THRO_PACKAGE_UNSUPPORTED' });
  assert.equal(target.values.size, 0);
});

test('origin and optional JSON extensions survive edit and reload atomically in the same cell', async () => {
  const value = await v2({ extensions: { 'future.optional': { untouched: ['retain', 4] } } });
  const target = storage(), key = 'thro.test:origin-roundtrip';
  await api.adoptWorkspacePackage({ storage: target, locks, key, package: value });
  let opened = await openWorkspace({ storage: target, locks, key });
  await opened.change({ name: 'Editable transferred shelf' });
  opened = await openWorkspace({ storage: target, locks, key });
  const output = await opened.exportPackage({ identity: delivered.identity, provenance: { recipient: 'test' } });
  assert.deepEqual(output.origin, value.origin);
  assert.deepEqual(output.extensions, value.extensions);
  assert.equal(output.archive.sha256, sha(output.archive.raw));
  assert.equal(target.values.size, 1, 'no separately committed metadata key');
});

test('static inspection rejects a hash-valid capture with forged owning source binding', async () => {
  const value = await v2();
  const forged = rewritten(value, raw => {
    const node = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1');
    const capture = decode(node.material); capture.source.disc = 'ds.px.nonexistent.disc';
    delete node.calculation; delete node.inputs; node.material = encode(capture);
  });
  await assert.rejects(api.inspectWorkspacePackage({ package: forged }), { code: 'THRO_PACKAGE_INVALID' });
});

test('static inspection retains original envelope and never substitutes an executable image', async () => {
  const value = await v2(), original = JSON.stringify(value);
  const report = await api.inspectWorkspacePackage({ package: value });
  assert.equal(JSON.stringify(value), original);
  assert.equal(report.captures.length, 1);
  const active = rewritten(value, raw => {
    const node = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1');
    const capture = decode(node.material); capture.graphic.svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'; capture.hash = sha(capture.graphic.svg);
    delete node.calculation; delete node.inputs; node.material = encode(capture);
    const graphic = raw.nodes.find(item => item.id === new Map(raw.bindings).get(capture.source.graphic));
    delete graphic.calculation; delete graphic.inputs; graphic.material = encode(capture.graphic);
  });
  await assert.rejects(api.inspectWorkspacePackage({ package: active }), { code: 'THRO_PACKAGE_INVALID' });
});
