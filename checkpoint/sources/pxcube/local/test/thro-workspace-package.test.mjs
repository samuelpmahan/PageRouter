import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const runtime = process.env.THRO_PACKAGE_RUNTIME ? pathToFileURL(process.env.THRO_PACKAGE_RUNTIME.replaceAll('\\', '/') + '/') : new URL('../../experiences/thro/dist/', import.meta.url);
const { openWorkspace, archiveKey } = await import(new URL('workspace.mjs', runtime));
const { createNativeRenderer, nativeDesign } = await import(new URL('native-cards.mjs', runtime));
const { paintings } = await import(new URL('studio/upload-disc-to-shelf/model.js', runtime));
const api = await import(new URL('workspace-package.mjs', runtime)).catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const identity = Object.freeze({ sourceId: '10cdb152bb516acaa4d6f13f02a940c0526d6e15d68cdb253f83381fcad224e5', artifactId: '43ab5d286baf677b69f6bfb7eb020a73b733d640ed30869d407d8e24f119df2f', nativeRendererBuild: '28ac2b39fab85255' });
const manifest = JSON.parse(fs.readFileSync(new URL('prepared-fixture.json', runtime)));
const fixture = manifest.discs.map(disc => ({ ...disc, depiction: { kind: 'photo', name: disc.name, src: `data:image/webp;base64,${fs.readFileSync(new URL(disc.file, runtime)).toString('base64')}` } }));
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }; };
const locks = () => ({ request: async (_name, _options, action) => action() });
const hash = text => createHash('sha256').update(text).digest('hex');
async function prepared() {
  const backing = storage(), lock = locks(), workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(typeof workspace.exportPackage, 'function', 'committed package export must be available');
  assert.equal(typeof api.adoptWorkspacePackage, 'function', 'validated empty-namespace adoption must be available');
  const rows = workspace.model.experience.shelf();
  await workspace.createBag('Sam curated exact versions', [rows[2].address, rows[0].address]);
  const kept = await workspace.keep(await workspace.single(rows[0].address));
  const packageValue = await workspace.exportPackage({ identity, provenance: { kind: 'synthetic-test-curation', approved: false } });
  return { workspace, backing, lock, rows, kept, packageValue };
}
function rewrite(packageValue, transform) {
  const copy = structuredClone(packageValue), raw = JSON.parse(copy.archive.raw);
  transform(raw); copy.archive.raw = JSON.stringify(raw); copy.archive.byteLength = Buffer.byteLength(copy.archive.raw); copy.archive.sha256 = hash(copy.archive.raw); return copy;
}
function decode(value) { if (Object.hasOwn(value, 'scalar')) return value.scalar; if (value.array) return value.array.map(decode); if (value.object) return Object.fromEntries(value.object.map(([k, v]) => [k, decode(v)])); return { part: value.part }; }
function encode(value) { if (value === null || typeof value !== 'object') return { scalar: value }; if (Array.isArray(value)) return { array: value.map(encode) }; return { object: Object.entries(value).map(([k, v]) => [k, encode(v)]) }; }
function literalContext(raw, change) {
  const pair = raw.bindings.filter(([name]) => /^ds\.px\.studio\.demo\.\d+\.context$/.test(name)).at(-1), node = raw.nodes.find(node => node.id === pair[1]);
  const context = decode(node.material); change(context); delete node.calculation; delete node.inputs; node.material = encode(context);
}
function syntheticPng(width, height) {
  function chunk(type, body) {
    const payload = Buffer.concat([Buffer.from(type), body]); let crc = 0xffffffff;
    for (const byte of payload) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), trailer = Buffer.alloc(4); header.writeUInt32BE(body.length); trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, payload, trailer]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

test('a curated package adopts into one empty namespace with real legacy captures and exact cutout bytes', async () => {
  const { workspace, rows, kept, packageValue } = await prepared();
  assert.equal(packageValue.schema, 'thro-workspace-package@1');
  assert.equal(packageValue.version, 1);
  assert.equal(packageValue.archive.encoding, 'utf-8');
  assert.equal(packageValue.archive.byteLength, Buffer.byteLength(packageValue.archive.raw));
  assert.equal(packageValue.archive.sha256, hash(packageValue.archive.raw));
  const target = storage(), key = 'thro.test:installed-player';
  const adopted = await api.adoptWorkspacePackage({ storage: target, locks: locks(), key, package: packageValue, expectedIdentity: identity });
  assert.equal(adopted.key, key);
  const opened = await openWorkspace({ storage: target, locks: locks(), key });
  assert.equal(opened.model.experience.shelf().length, 3);
  assert.equal(opened.model.value(rows[0].address).depiction.src, fixture[0].depiction.src);
  assert.deepEqual(opened.model.experience.bags()[0].bag.versions, workspace.model.experience.bags()[0].bag.versions);
  assert.deepEqual(opened.model.value(kept.address), kept.capture);
  assert.equal(opened.model.context.graphics[0], kept.address);
  const originalBytes = (await workspace.exportPackage({ identity })).archive.raw;
  await opened.change({ name: 'Independent installed edit' });
  const secondOpen = await openWorkspace({ storage: target, locks: locks(), key });
  assert.equal(secondOpen.model.context.name, 'Independent installed edit');
  assert.equal((await workspace.exportPackage({ identity })).archive.raw, originalBytes, 'editing installed world does not mutate source world');
});

test('identity equality is independent of object key order', async () => {
  const { packageValue } = await prepared();
  await api.adoptWorkspacePackage({ storage: storage(), locks: locks(), key: 'thro.test:ordered', package: packageValue,
    expectedIdentity: { nativeRendererBuild: identity.nativeRendererBuild, artifactId: identity.artifactId, sourceId: identity.sourceId } });
});

test('invalid namespace, unavailable locks, quota and uncertain readback fail without rollback', async () => {
  const { packageValue } = await prepared();
  const absent = storage();
  await assert.rejects(api.adoptWorkspacePackage({ storage: absent, locks: locks(), key: 'outside-namespace', package: packageValue, expectedIdentity: identity })); assert.equal(absent.values.size, 0);
  await assert.rejects(api.adoptWorkspacePackage({ storage: absent, locks: {}, key: 'thro.test:no-locks', package: packageValue, expectedIdentity: identity }), { code: 'THRO_STORAGE_UNAVAILABLE' }); assert.equal(absent.values.size, 0);
  const quota = storage(); quota.setItem = () => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); };
  await assert.rejects(api.adoptWorkspacePackage({ storage: quota, locks: locks(), key: 'thro.test:quota', package: packageValue, expectedIdentity: identity }), { code: 'THRO_STORAGE_UNAVAILABLE' }); assert.equal(quota.values.size, 0);
  const uncertain = storage(); uncertain.setItem = (key, _value) => uncertain.values.set(key, 'Synthetic readback winner');
  await assert.rejects(api.adoptWorkspacePackage({ storage: uncertain, locks: locks(), key: 'thro.test:uncertain', package: packageValue, expectedIdentity: identity }), { code: 'THRO_STORAGE_UNCERTAIN' }); assert.equal(uncertain.getItem('thro.test:uncertain'), 'Synthetic readback winner');
});

test('native adoption preserves retained carrier bytes without repainting on the recipient (synthetic producer, no browser-pixel claim)', async () => {
  const png = syntheticPng(1920, 1080);
  const renderGraphic = createNativeRenderer(async request => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image width="1920" height="1080" href="data:image/png;base64,${png}"/></svg>`, width: 1920, height: 1080, build: identity.nativeRendererBuild, placement: { scale: request.scale, dx: 0, dy: 0 } }));
  const workspace = await openWorkspace({ storage: storage(), locks: locks(), fixture, renderGraphic });
  await workspace.change({ design: nativeDesign(workspace.model.context.design, 'discstudio:b01') });
  const kept = await workspace.keep(await workspace.single(workspace.model.context.selectedDisc));
  const packageValue = await workspace.exportPackage({ identity, provenance: { testRenderer: 'synthetic-transparent-full-canvas-carrier' } });
  const target = storage(), key = 'thro.test:native-hook';
  await api.adoptWorkspacePackage({ storage: target, locks: locks(), key, package: packageValue, expectedIdentity: identity });
  const reopened = await openWorkspace({ storage: target, locks: locks(), key, renderGraphic }); assert.deepEqual(reopened.model.value(kept.address), kept.capture);
  let repainted = false;
  await api.adoptWorkspacePackage({ storage: storage(), locks: locks(), key: 'thro.test:different-recipient', package: packageValue, expectedIdentity: identity,
    renderGraphic: async () => { repainted = true; throw Error('Recipient pixels would differ'); } });
  assert.equal(repainted, false);
  const forged = rewrite(packageValue, raw => {
    const captureNode = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1');
    const capture = decode(captureNode.material); capture.graphic.provenance.preparedPhotoSha256 = 'f'.repeat(64);
    delete captureNode.calculation; delete captureNode.inputs; captureNode.material = encode(capture);
    const graphicId = raw.bindings.find(([name]) => name === capture.source.graphic)[1]; raw.nodes.find(node => node.id === graphicId).material = encode(capture.graphic);
  });
  const rejected = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: rejected, locks: locks(), key: 'thro.test:forged-native-photo', package: forged, expectedIdentity: identity })); assert.equal(rejected.values.size, 0);
});

test('dormant uppercase image references fail closed even when not used by a capture', async () => {
  const { packageValue } = await prepared();
  const forged = rewrite(packageValue, raw => {
    const id = Math.max(...raw.nodes.map(node => node.id)) + 1;
    raw.nodes.push({ id, material: encode('<svg xmlns="http://www.w3.org/2000/svg"><image HREF="//example.invalid/image.png"/></svg>') });
    raw.bindings.push([raw.shelfAddress + '.untrusted', id]);
  });
  const target = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks: locks(), key: 'thro.test:uppercase-media', package: forged, expectedIdentity: identity })); assert.equal(target.values.size, 0);
});

test('escaped SVG style resources are outside the generated-material contract', async () => {
  const { packageValue } = await prepared();
  const forged = rewrite(packageValue, raw => {
    const id = Math.max(...raw.nodes.map(node => node.id)) + 1;
    raw.nodes.push({ id, material: encode('<svg xmlns="http://www.w3.org/2000/svg"><style>@im\\70ort "//example.invalid/a.css";</style></svg>') });
    raw.bindings.push([raw.shelfAddress + '.escaped', id]);
  });
  await assert.rejects(api.adoptWorkspacePackage({ storage: storage(), locks: locks(), key: 'thro.test:escaped', package: forged, expectedIdentity: identity }));
});

test('uncaptured live lineup and dormant design corruption cannot install a startup failure', async () => {
  const workspace = await openWorkspace({ storage: storage(), locks: locks(), fixture });
  await workspace.change({ throMode: 'battle' }); await workspace.battle(workspace.model.context.selection.slice(0, 2));
  const packageValue = await workspace.exportPackage({ identity });
  const invalid = [
    raw => { const id = raw.bindings.find(([name]) => name === workspace.model.context.competitionAddress)[1], node = raw.nodes.find(node => node.id === id), material = decode(node.material); material.styles = null; delete node.calculation; delete node.inputs; node.material = encode(material); },
    raw => { const id = raw.bindings.find(([name]) => name === workspace.model.context.competitionAddress)[1], node = raw.nodes.find(node => node.id === id), material = decode(node.material); material.constraints = [null]; delete node.calculation; delete node.inputs; node.material = encode(material); literalContext(raw, context => { context.throMode = 'single'; }); },
    raw => literalContext(raw, context => { context.design = nativeDesign(context.design, 'discstudio:b01'); }),
    raw => literalContext(raw, context => { context.legacyDesign = nativeDesign(context.design, 'discstudio:b01'); }),
    raw => literalContext(raw, context => { context.design.placement = 'javascript:unsupported'; }),
  ];
  for (const change of invalid) { const backing = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:live-state', package: rewrite(packageValue, change), expectedIdentity: identity })); assert.equal(backing.values.size, 0); }
});

test('mixed painted/photo shelf validates native state against its actual selected photo', async () => {
  const mixed = fixture.map((item, i) => i === 0 ? { ...item, depiction: paintings[0] } : item);
  const renderGraphic = createNativeRenderer(async request => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image width="1920" height="1080" href="data:image/png;base64,${syntheticPng(1920, 1080)}"/></svg>`, width: 1920, height: 1080, build: identity.nativeRendererBuild, placement: { scale: request.scale, dx: 0, dy: 0 } }));
  const workspace = await openWorkspace({ storage: storage(), locks: locks(), fixture: mixed, renderGraphic });
  await workspace.change({ selectedDisc: workspace.model.experience.shelf()[1].address, design: nativeDesign(workspace.model.context.design, 'discstudio:b01') });
  const packageValue = await workspace.exportPackage({ identity });
  await api.adoptWorkspacePackage({ storage: storage(), locks: locks(), key: 'thro.test:mixed-shelf', package: packageValue, expectedIdentity: identity });
});

test('prepared package rejects external depiction sources, missing capture titles and rewound or exhausted allocators', async () => {
  const { packageValue } = await prepared();
  const invalid = [
    raw => { raw.serial = 0; }, raw => { raw.serial = Number.MAX_SAFE_INTEGER - 1; },
    raw => { const node = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1'), capture = decode(node.material); delete capture.title; delete node.calculation; delete node.inputs; node.material = encode(capture); },
    raw => { const id = Math.max(...raw.nodes.map(node => node.id)) + 1; raw.nodes.push({ id, material: encode({ src: 'https://example.invalid/remote-image.svg' }) }); raw.bindings.push([raw.shelfAddress + '.external', id]); },
  ];
  for (const change of invalid) { const backing = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:closed-state', package: rewrite(packageValue, change), expectedIdentity: identity })); assert.equal(backing.values.size, 0); }
});

test('package budgets count UTF-8 values and field names and reject malformed tagged fields', async () => {
  assert.throws(() => api.snapshotJson({ ['x'.repeat(64 * 1024 * 1024 + 65537)]: 'small' }), /byte budget/);
  const { packageValue } = await prepared();
  const utf8 = structuredClone(packageValue); utf8.archive.raw += '🌲'; utf8.archive.byteLength = utf8.archive.raw.length; utf8.archive.sha256 = hash(utf8.archive.raw);
  const malformed = rewrite(packageValue, raw => { const node = raw.nodes.find(node => node.material?.object); node.material.object.push(node.material.object[0]); });
  for (const bad of [utf8, malformed]) { const target = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: target, locks: locks(), key: 'thro.test:budgets', package: bad, expectedIdentity: identity })); assert.equal(target.values.size, 0); }
});

test('export refuses queued work, failed draft and stale-owner conflict', async () => {
  const { workspace, backing, lock } = await prepared();
  const pending = workspace.change({ name: 'Queued' });
  await assert.rejects(workspace.exportPackage({ identity }), { code: 'THRO_PACKAGE_BUSY' }); await pending;
  const newer = await openWorkspace({ storage: backing, locks: lock, fixture }); await newer.change({ name: 'New tab' });
  await assert.rejects(workspace.change({ name: 'Stale draft' }));
  await assert.rejects(workspace.exportPackage({ identity }), { code: 'THRO_PACKAGE_BUSY' });
});

test('adoption rejects each mismatched build identity and corrupt raw bytes without writing', async () => {
  const { packageValue } = await prepared();
  for (const field of Object.keys(identity)) {
    const backing = storage(), expectedIdentity = { ...identity, [field]: field === 'nativeRendererBuild' ? 'another-build' : 'f'.repeat(64) };
    await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:identity', package: packageValue, expectedIdentity })); assert.equal(backing.values.size, 0);
  }
  const corrupt = structuredClone(packageValue); corrupt.archive.raw += ' ';
  const backing = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:hash', package: corrupt, expectedIdentity: identity })); assert.equal(backing.values.size, 0);
});

test('plain JSON snapshots reject executable metadata and do not observe caller mutation during validation', async () => {
  const { packageValue, workspace } = await prepared();
  await assert.rejects(workspace.exportPackage({ identity, provenance: { bad: () => {} } }));
  const backing = storage(), input = structuredClone(packageValue), expected = { ...identity };
  const adopting = api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:snapshot', package: input, expectedIdentity: expected });
  input.archive.raw = '{}'; input.identity.sourceId = 'f'.repeat(64); expected.artifactId = 'e'.repeat(64);
  await adopting;
  const reopened = await openWorkspace({ storage: backing, locks: locks(), key: 'thro.test:snapshot' }); assert.equal(reopened.model.experience.shelf().length, 3);
});

test('occupied destinations and an asynchronous concurrent installation are never overwritten', async () => {
  const { packageValue } = await prepared();
  for (const occupied of ['', 'malformed bytes']) {
    const backing = storage(); backing.setItem('thro.test:occupied', occupied);
    await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:occupied', package: packageValue, expectedIdentity: identity })); assert.equal(backing.getItem('thro.test:occupied'), occupied);
  }
  const backing = storage(), promise = api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:race', package: packageValue, expectedIdentity: identity });
  backing.setItem('thro.test:race', 'concurrent winner');
  await assert.rejects(promise); assert.equal(backing.getItem('thro.test:race'), 'concurrent winner');
});

test('closed graph validation rejects unknown calculations, unread links and unsafe serial addresses', async () => {
  const { packageValue } = await prepared();
  const mutations = [raw => { raw.nodes.find(node => node.function).function = 'fn.unapproved'; }, raw => { raw.bindings[0][1] = 9999999; }, raw => { raw.bindings.push(['ds.px.studio.demo.9007199254740992.context', raw.bindings[0][1]]); }];
  for (const mutate of mutations) { const backing = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:graph', package: rewrite(packageValue, mutate), expectedIdentity: identity })); assert.equal(backing.values.size, 0); }
});

test('valid-hash forged captures, invalid context links and active or external SVG are rejected before writing', async () => {
  const { packageValue } = await prepared();
  const mutations = [
    raw => { const node = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1'); const capture = decode(node.material); capture.specimen.disc.id = 'wrong-copy'; node.material = encode(capture); },
    raw => { const pair = raw.bindings.filter(([name]) => /^ds\.px\.studio\.demo\.\d+\.context$/.test(name)).at(-1); const node = raw.nodes.find(node => node.id === pair[1]); const context = decode(node.material); context.selectedDisc = 'ds.px.missing'; node.material = encode(context); },
    raw => { const node = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1'); const capture = decode(node.material); capture.graphic.svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'; capture.hash = hash(capture.graphic.svg); node.material = encode(capture); },
    raw => { const node = raw.nodes.find(node => node.material && decode(node.material)?.schema === 'studio-graphic@1'); const capture = decode(node.material); capture.graphic.svg = '<svg xmlns="http://www.w3.org/2000/svg"><image href="//example.invalid/a.png"/></svg>'; capture.hash = hash(capture.graphic.svg); node.material = encode(capture); },
  ];
  for (const mutate of mutations) { const backing = storage(); await assert.rejects(api.adoptWorkspacePackage({ storage: backing, locks: locks(), key: 'thro.test:forged', package: rewrite(packageValue, mutate), expectedIdentity: identity })); assert.equal(backing.values.size, 0); }
});
