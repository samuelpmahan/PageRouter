import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openWorkspace, archiveKey } from './dist/workspace.mjs';
import { createArchiveCodec } from './dist/archive-codec.mjs';
import { pack, unpack } from './dist/archive-storage.mjs';
import { captureIdentity } from './dist/model.mjs';
import { loadFixture } from './dist/prepared-fixture.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('./prepared-fixture.json', import.meta.url)));
const fixture = manifest.discs.map(disc => {
  const bytes = fs.readFileSync(new URL(disc.file, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), disc.sha256);
  return { ...disc, depiction: { kind: 'photo', src: `data:image/webp;base64,${bytes.toString('base64')}`, name: disc.name } };
});
const legacyFixture = fixture.map(({ flightOverrides, flightCitation, ...item }) => item);
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}
function locks() {
  const queues = new Map();
  return { request(name, _options, action) {
    const result = (queues.get(name) ?? Promise.resolve()).then(action);
    queues.set(name, result.catch(() => {}));
    return result;
  } };
}

test('prepared photos, exact bag membership and retained captures survive reopening', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  const rows = workspace.model.experience.shelf();
  assert.equal(rows.length, 9);
  assert.ok(rows.every(row => row.disc.depiction.kind === 'photo'));
  assert.deepEqual(rows.map(row => row.seed.name), ['Servo', 'Buzzz SS', 'Anchor', 'Luna', 'Challenger', 'Focus', 'APX', 'Zone', 'Buzzz']);
  const ordered = [rows[2].address, rows[0].address];
  const bagAddress = await workspace.createBag('Two exact copies', ordered);
  assert.deepEqual(workspace.model.value(bagAddress).versions.map(version => version.address), ordered);
  const preview = await workspace.single(rows[0].address);
  const kept = await workspace.keep(preview);
  assert.equal(kept.capture.graphic.svg, preview.graphic.svg);
  assert.ok(backing.getItem(archiveKey).length < 2000000, 'the prepared demo plus capture stays below its tested storage budget');
  console.log(JSON.stringify({ fixture: manifest.fixtureId, retainedCaptureCharacters: backing.getItem(archiveKey).length }));
  await workspace.change({ design: { ...workspace.model.context.design, accent: '#ff00aa' } });
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(reopened.model.experience.bags().length, 1);
  assert.equal(reopened.model.value(kept.address).graphic.svg, preview.graphic.svg);
  assert.equal(reopened.model.context.design.accent, '#ff00aa');
});

const servoCitation = Object.freeze({ sourceKind: 'manufacturer', url: 'https://mvpdiscsports.com/discs/servo/', verifiedOn: '2026-10-22' });
const servoFlightFixture = fixture.map(item => item.id === 'sample-servo'
  ? { ...item, flightOverrides: { speed: 6.5 }, flightCitation: servoCitation }
  : item);

test('validated prepared Servo facts reach native render and retained capture without changing the seed catalog', async () => {
  const backing = storage(), lock = locks();
  let renderedResolved;
  const renderGraphic = async input => {
    if (!input.design.study.startsWith('discstudio:')) return null;
    renderedResolved = structuredClone(input.resolved);
    return addressedWorkspaceGraphic(input);
  };
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture: servoFlightFixture, renderGraphic });
  const row = workspace.model.experience.shelf().find(item => item.seed.name === 'Servo');
  assert.equal(workspace.model.experience.seedAt(row.disc.mold).speed, 7, 'the catalog seed remains the original value');
  assert.equal(workspace.model.experience.resolve(row.disc).speed, 6.5);
  assert.deepEqual(row.disc.flightCitation, servoCitation);

  const design = nativeWorkspaceDesign(workspace);
  await workspace.change({ design });
  const preview = await workspace.single(row.address);
  assert.equal(renderedResolved.speed, 6.5, 'the renderer receives the prepared override');
  assert.deepEqual(renderedResolved.flightCitation, servoCitation, 'the field citation follows resolved facts');
  const kept = await workspace.keep(preview);
  assert.equal(kept.capture.specimen.resolved.speed, 6.5);
  assert.deepEqual(kept.capture.specimen.disc.flightCitation, servoCitation);
});

test('prepared fixture accepts only finite cited flight overrides and rejects null or missing citations', async () => {
  const bytesByFile = new Map(manifest.discs.map(disc => [disc.file, fs.readFileSync(new URL(disc.file, import.meta.url))]));
  async function loadWith(change) {
    const candidate = structuredClone(manifest);
    change(candidate.discs[0]);
    return loadFixture({ base: new URL('./', import.meta.url), fetcher: async url => {
      if (url.pathname.endsWith('/prepared-fixture.json')) return { ok: true, json: async () => candidate };
      const relative = decodeURIComponent(url.pathname.split('/').slice(-3).join('/'));
      const bytes = bytesByFile.get(relative);
      if (!bytes) throw Error(`Unexpected fixture request: ${url}`);
      return { ok: true, arrayBuffer: async () => bytes };
    } });
  }
  const invalid = [
    disc => { disc.flightOverrides = { speed: null }; disc.flightCitation = servoCitation; },
    disc => { disc.flightOverrides = { speed: Number.NaN }; disc.flightCitation = servoCitation; },
    disc => { disc.flightOverrides = { speed: 6.5 }; delete disc.flightCitation; },
    disc => { disc.flightOverrides = { speed: 6.5 }; disc.flightCitation = null; },
    disc => { disc.flightOverrides = { speed: 6.5 }; disc.flightCitation = { ...servoCitation, sourceKind: '' }; },
    disc => { disc.flightOverrides = { speed: 6.5, unknown: 2 }; disc.flightCitation = servoCitation; },
  ];
  for (const [index, mutate] of invalid.entries()) await assert.rejects(loadWith(mutate), /Invalid prepared flight correction/, `invalid correction ${index}`);
  const loaded = await loadWith(disc => { disc.flightOverrides = { speed: 6.5 }; disc.flightCitation = servoCitation; });
  assert.deepEqual(loaded[0].flightOverrides, { speed: 6.5 });
  assert.deepEqual(loaded[0].flightCitation, servoCitation);
  const backing = storage();
  await assert.rejects(openWorkspace({ storage: backing, locks: locks(), fixture: [{ ...fixture[0], flightOverrides: { speed: null }, flightCitation: servoCitation }] }), /Invalid prepared flight correction/);
  assert.equal(backing.getItem(archiveKey), null, 'an invalid direct fixture cannot seed any archive bytes');
});

test('an existing prepared archive is not migrated by a later fixture correction', async () => {
  const backing = storage(), lock = locks();
  const original = await openWorkspace({ storage: backing, locks: lock, fixture: legacyFixture });
  const oldBytes = backing.getItem(archiveKey);
  const oldServo = original.model.experience.shelf().find(item => item.seed.name === 'Servo');
  assert.equal(original.model.experience.resolve(oldServo.disc).speed, 7);

  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture: servoFlightFixture });
  assert.equal(backing.getItem(archiveKey), oldBytes, 'existing archive bytes remain exactly unchanged');
  const reopenedServo = reopened.model.experience.shelf().find(item => item.seed.name === 'Servo');
  assert.equal(reopened.model.experience.resolve(reopenedServo.disc).speed, 7, 'only a freshly seeded workspace receives the correction');
});

test('stale bag save preserves newer archive, committed heads and complete pending intent', async () => {
  const backing = storage(), lock = locks();
  const stale = await openWorkspace({ storage: backing, locks: lock, fixture });
  const newer = await openWorkspace({ storage: backing, locks: lock, fixture });
  await newer.change({ name: 'Newer saved name' });
  const winningBytes = backing.getItem(archiveKey), oldHead = stale.model.contextAddress;
  const selection = stale.model.context.selection.slice(0, 2);
  await assert.rejects(stale.createBag('My retained pending bag', selection), { code: 'THRO_STORAGE_CONFLICT' });
  assert.equal(backing.getItem(archiveKey), winningBytes);
  assert.equal(stale.model.contextAddress, oldHead);
  assert.equal(stale.model.experience.bags().length, 0, 'failed candidate Bag never becomes visible');
  assert.deepEqual(stale.draft, { operation: 'create-bag', name: 'My retained pending bag', selection });
  await assert.rejects(stale.change({ name: 'Do not silently retry' }), { code: 'THRO_STORAGE_CONFLICT' });
  const { workspace: reloaded, recovery } = await stale.reload();
  assert.equal(reloaded.model.context.name, 'Newer saved name');
  assert.equal(recovery.name, 'My retained pending bag');
  assert.equal(backing.getItem(archiveKey), winningBytes);
});

test('contending prepared workspaces have one durable winner', async () => {
  const backing = storage(), lock = locks();
  const first = await openWorkspace({ storage: backing, locks: lock, fixture });
  const second = await openWorkspace({ storage: backing, locks: lock, fixture });
  const results = await Promise.allSettled([first.change({ name: 'First' }), second.change({ name: 'Second' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'THRO_STORAGE_CONFLICT');
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.ok(['First', 'Second'].includes(reopened.model.context.name));
});

test('a rejected write cannot promote a Bag or lose its draft', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  const previous = backing.getItem(archiveKey), originalWrite = backing.setItem;
  backing.setItem = () => { throw new DOMException('Fixture quota', 'QuotaExceededError'); };
  await assert.rejects(workspace.createBag('Uncommitted bag', workspace.model.context.selection), { code: 'THRO_STORAGE_UNAVAILABLE' });
  assert.equal(backing.getItem(archiveKey), previous);
  assert.equal(workspace.model.experience.bags().length, 0);
  assert.equal(workspace.draft.name, 'Uncommitted bag');
  backing.setItem = originalWrite;
});

test('Battle reuses exact lineup material, keeps points and retains preview bytes', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  const selection = workspace.model.context.selection.slice(0, 2);
  await workspace.battle(selection);
  const materialAddress = workspace.model.context.competitionAddress;
  const entry = workspace.model.value(materialAddress).entries[0];
  await workspace.editBattle({ kind: 'points', id: entry.id, points: 7 });
  const edited = workspace.model.context.competitionAddress;
  const preview = await workspace.battle(selection);
  assert.equal(workspace.model.context.competitionAddress, edited, 'redraw never starts a replacement lineup');
  assert.equal(workspace.model.value(edited).states[0].scores[entry.id], 7);
  const kept = await workspace.keep(preview);
  assert.equal(kept.capture.graphic.svg, preview.graphic.svg);
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(reopened.model.value(kept.address).graphic.svg, preview.graphic.svg);
  const rebuilt = await reopened.battle(selection);
  assert.equal(reopened.existingCapture(rebuilt)?.address, kept.address);
  assert.equal(reopened.existingCapture({ ...rebuilt, materialAddress: 'another-lineup' }), null);
});

test('existing kept capture survives reload without collapsing different physical origins', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  const preview = await workspace.single(workspace.model.context.selectedDisc);
  const kept = await workspace.keep(preview);
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture });
  const rebuilt = await reopened.single(reopened.model.context.selectedDisc);
  const retained = reopened.existingCapture?.(rebuilt);
  assert.equal(retained?.address, kept.address, 'a repeated implicit export can reuse its exact retained source/design/bytes');
  assert.equal(retained.capture.hash, kept.capture.hash);
  const other = reopened.model.experience.shelf()[1].address;
  assert.equal(reopened.existingCapture({ ...rebuilt, discAddress: other }), null, 'identical output bytes cannot collapse another physical copy');
  assert.equal(reopened.existingCapture({ ...rebuilt, design: { ...rebuilt.design, title: 'different intent' } }), null, 'changed design intent remains distinct');
  assert.equal(reopened.model.context.graphics.length, 1, 'lookup never creates another retained version');
  const explicit = await reopened.keep(rebuilt);
  assert.notEqual(explicit.address, kept.address, 'an explicit Keep still creates a version');
  assert.equal(reopened.existingCapture(rebuilt).address, explicit.address, 'lookup prefers the most recently kept exact version');
});

// A synthetic plain graphic exercises dispatch and durable ownership without a
// browser Canvas or a claim about the native renderer's visual quality.
const nativeWorkspaceGraphic = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect x="12" y="12" width="400" height="160" fill="#305e52"/></svg>',
  width: 1920,
  height: 1080,
  provenance: { schema: 'synthetic-native-workspace-fixture@1', rendererBuild: '28ac2b39fab85255', style: 'b01', fixtureOnly: true },
};
async function renderWorkspaceGraphic({ design }) {
  if (!design.study.startsWith('discstudio:')) return null;
  return structuredClone(nativeWorkspaceGraphic);
}
const nativeWorkspaceDesign = workspace => ({ ...workspace.model.context.design, study: 'discstudio:b01', rendererBuild: '28ac2b39fab85255', orientation: 'landscape' });
async function nativePreview(workspace, discAddress = workspace.model.context.selectedDisc) {
  let result;
  await assert.doesNotReject(async () => { result = await workspace.single(discAddress); }, 'the owning workspace must forward its native renderer into the model');
  assert.deepEqual(result.graphic, nativeWorkspaceGraphic);
  return result;
}

test('Single to Battle to Single restores remembered native and compatible legacy designs', async () => {
  const workspace = await openWorkspace({ storage: storage(), locks: locks(), fixture, renderGraphic: renderWorkspaceGraphic });
  const legacy = { ...workspace.model.context.design, study: 'number-plate', title: 'Remembered legacy treatment', accent: '#11aa88' };
  await workspace.change({ design: legacy });
  const native = nativeWorkspaceDesign(workspace);
  await workspace.change({ design: native });
  assert.deepEqual(workspace.model.context.singleDesign, native);
  assert.deepEqual(workspace.model.context.legacyDesign, legacy);
  await nativePreview(workspace);

  await workspace.change({ throMode: 'battle' });
  assert.deepEqual(workspace.model.context.design, legacy, 'Battle receives the remembered compatible legacy treatment');
  assert.deepEqual(workspace.model.context.singleDesign, native, 'switching mode does not replace the native Single treatment');
  const battle = await workspace.battle(workspace.model.context.selection.slice(0, 2));
  assert.equal(typeof battle.materialAddress, 'string');
  assert.notEqual(battle.graphic.svg, nativeWorkspaceGraphic.svg);

  await workspace.change({ throMode: 'single' });
  assert.deepEqual(workspace.model.context.design, native);
  assert.deepEqual(workspace.model.context.legacyDesign, legacy);
  await nativePreview(workspace);
});

test('Battle rejects an explicit native design before changing lineup or stored bytes', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic: renderWorkspaceGraphic });
  const native = nativeWorkspaceDesign(workspace);
  await workspace.change({ design: native });
  const before = { head: workspace.model.contextAddress, context: structuredClone(workspace.model.context), bytes: backing.getItem(archiveKey) };
  const rows = workspace.model.experience.shelf();
  await assert.rejects(workspace.battle([rows[1].address, rows[0].address], native));
  assert.equal(workspace.model.contextAddress, before.head);
  assert.deepEqual(workspace.model.context, before.context);
  assert.equal(backing.getItem(archiveKey), before.bytes, 'rejected native Battle cannot durably start a replacement lineup');
});

test('native capture and failed export receipt reload with the renderer and exact capture reuse', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic: renderWorkspaceGraphic });
  const native = nativeWorkspaceDesign(workspace);
  await workspace.change({ design: native });
  const preview = await nativePreview(workspace);
  let kept;
  await assert.doesNotReject(async () => { kept = await workspace.keep(preview); }, 'candidate capture rendering retains the injected native renderer');
  const failed = { status: 'Failed', capture: kept.address, svgHash: kept.capture.hash, format: 'png', error: 'Synthetic conversion failure' };
  await workspace.recordExport(failed);

  const { workspace: reopened } = await workspace.reload();
  assert.deepEqual(reopened.model.context.design, native);
  const retained = reopened.model.value(kept.address);
  assert.deepEqual(retained.graphic, nativeWorkspaceGraphic);
  assert.deepEqual(reopened.model.value(reopened.model.context.exports.at(-1)), failed);
  const rebuilt = await nativePreview(reopened);
  assert.equal(reopened.existingCapture(rebuilt)?.address, kept.address, 'reload preserves the injected renderer and the exact retained capture');
  assert.equal(reopened.model.context.graphics.length, 1);
});

test('stale native Keep preserves the newer archive and the complete pending capture intent', async () => {
  const backing = storage(), lock = locks();
  const first = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic: renderWorkspaceGraphic });
  const native = nativeWorkspaceDesign(first);
  await first.change({ design: native });
  const stale = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic: renderWorkspaceGraphic });
  const newer = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic: renderWorkspaceGraphic });
  const preview = await nativePreview(stale), oldHead = stale.model.contextAddress;
  await newer.change({ name: 'Newer native workspace' });
  const winningBytes = backing.getItem(archiveKey);

  await assert.rejects(stale.keep(preview), { code: 'THRO_STORAGE_CONFLICT' });
  assert.equal(backing.getItem(archiveKey), winningBytes);
  assert.equal(stale.model.contextAddress, oldHead);
  assert.equal(stale.model.context.graphics.length, 0);
  assert.equal(stale.draft.operation, 'keep');
  assert.equal(stale.draft.discAddress, preview.discAddress);
  assert.deepEqual(stale.draft.design, native);
  assert.equal(stale.conflict.code, 'THRO_STORAGE_CONFLICT');
});

test('a rejected native design preserves committed state and permits a corrected save', async () => {
  const backing = storage(), lock = locks();
  const renderGraphic = async input => {
    if (input.design.study === 'discstudio:b01' && input.design.nativeScale === 1.5) throw Error('Synthetic native geometry failure');
    return renderWorkspaceGraphic(input);
  };
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic });
  const valid = { ...nativeWorkspaceDesign(workspace), nativeScale: 1 };
  await workspace.change({ design: valid });
  const before = { head: workspace.model.contextAddress, context: structuredClone(workspace.model.context), bytes: backing.getItem(archiveKey) };
  const bad = { ...valid, nativeScale: 1.5 };

  await assert.rejects(workspace.change({ design: bad }), /Synthetic native geometry failure/);
  assert.equal(workspace.model.contextAddress, before.head, 'failed rendering cannot promote the candidate model');
  assert.deepEqual(workspace.model.context, before.context);
  assert.equal(backing.getItem(archiveKey), before.bytes, 'failed rendering cannot persist the unsupported design');
  assert.deepEqual(workspace.draft, { operation: 'change', context: { design: bad } });
  assert.equal(workspace.conflict, null, 'a geometry rejection does not latch a storage conflict');

  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic });
  assert.deepEqual(reopened.model.context.design, valid, 'ordinary reopening retains the last renderable native design');
  await nativePreview(reopened);

  const corrected = { ...valid, nativeScale: 1.25 };
  await workspace.change({ design: corrected });
  assert.deepEqual(workspace.model.context.design, corrected);
  assert.equal(workspace.draft, null, 'the next valid save clears the rejected intent');
  assert.notEqual(backing.getItem(archiveKey), before.bytes);
  const afterCorrection = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic });
  assert.deepEqual(afterCorrection.model.context.design, corrected);
  await nativePreview(afterCorrection);
});

const archiveCodec = createArchiveCodec({ pack, unpack });
const rawGraph = async backing => JSON.parse(await archiveCodec.unpackArchive(backing.getItem(archiveKey)));
const materialFunctionCount = (graph, name) => {
  const functions = new Map(graph.nodes.filter(node => node.function).map(node => [node.id, node.function]));
  return graph.nodes.filter(node => functions.get(node.calculation) === name).length;
};
function addressedWorkspaceGraphic(input) {
  if (!input.design.study.startsWith('discstudio:')) return null;
  return { ...structuredClone(nativeWorkspaceGraphic), provenance: {
    schema: 'thro-native-card@1', renderer: 'discstudio-cards', rendererBuild: '28ac2b39fab85255',
    preset: 'b01', physicalDiscId: input.disc.id, discAddress: input.discAddress,
    designAddress: input.designAddress, resolvedAddress: input.resolvedAddress,
    preparedPhotoSha256: createHash('sha256').update(Buffer.from(input.disc.depiction.src.split(',')[1], 'base64')).digest('hex'),
    appearance: { discSide: 'right', highlightTarget: 'digits', accentColor: input.design.accent },
    placement: { scale: 0.66, dx: 0, dy: 0 }, rasterOnly: true,
  } };
}

test('retained native Keep preserves history and full owning provenance without another render graph', async () => {
  const backing = storage(), lock = locks();
  let validations = 0;
  const renderGraphic = async input => { validations++; return addressedWorkspaceGraphic(input); };
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic });
  await workspace.change({ design: nativeWorkspaceDesign(workspace) });
  const initial = await workspace.single(workspace.model.context.selectedDisc);
  const first = await workspace.keep(initial);
  const oldPacked = backing.getItem(archiveKey), oldCapture = structuredClone(first.capture);
  const beforeGraph = await rawGraph(backing);
  const beforeRaw = await archiveCodec.unpackArchive(oldPacked);
  const readOnly = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic });
  assert.equal(backing.getItem(archiveKey), oldPacked, 'old v1 archive opening performs no write');
  const preview = await readOnly.single(readOnly.model.context.selectedDisc);
  assert.notEqual(preview.graphic.provenance.designAddress, first.capture.graphic.provenance.designAddress, 'fresh preview owns different addresses');
  const validationsBefore = validations;
  const second = await readOnly.keep(preview);
  const afterGraph = await rawGraph(backing), afterRaw = await archiveCodec.unpackArchive(backing.getItem(archiveKey));
  assert.equal(validations, validationsBefore + 1, 'reuse still executes native renderer validation');
  assert.equal(materialFunctionCount(afterGraph, 'fn.read'), materialFunctionCount(beforeGraph, 'fn.read'), 'reuse must not retain another resolved facts Part');
  const photoBytes = Buffer.byteLength(fixture[0].depiction.src);
  assert.ok(Buffer.byteLength(afterRaw)-Buffer.byteLength(beforeRaw) < photoBytes*2+50000, 'repeat Keep stores the new snapshot, not another native graphic/resolved graph');
  assert.notEqual(second.address, first.address);
  assert.notEqual(captureIdentity(second.capture), captureIdentity(first.capture), 'explicit Keep remains externally distinct');
  assert.deepEqual(second.capture.graphic, oldCapture.graphic, 'owning provenance is preserved exactly');
  assert.deepEqual(second.capture.design, oldCapture.design);
  assert.deepEqual(second.capture.specimen, oldCapture.specimen);
  assert.strictEqual(readOnly.model.pxc.get(second.capture.source.graphic), readOnly.model.pxc.get(first.capture.source.graphic), 'fresh address aliases the same retained graphic Part');
  assert.deepEqual(readOnly.model.value(first.address), oldCapture, 'all prior capture values remain exact');
  const afterPacked = backing.getItem(archiveKey);
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture, renderGraphic });
  assert.equal(backing.getItem(archiveKey), afterPacked, 'reopening saved aliases performs no write');
  assert.deepEqual(reopened.model.context.graphics, [first.address, second.address]);
  assert.deepEqual(reopened.model.value(first.address), oldCapture);
  assert.deepEqual(reopened.model.value(second.address), second.capture);
  assert.strictEqual(reopened.model.pxc.get(second.capture.source.graphic), reopened.model.pxc.get(first.capture.source.graphic));
});

test('retained legacy and Battle Keeps append snapshots without copying their scene trees', async () => {
  const backing = storage(), lock = locks();
  const workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  for (const mode of ['single', 'battle']) {
    const preview = mode === 'single' ? await workspace.single(workspace.model.context.selectedDisc) : await workspace.battle(workspace.model.context.selection.slice(0,2));
    const first = await workspace.keep(preview), oldCapture = structuredClone(first.capture);
    const before = await rawGraph(backing);
    const nextPreview = mode === 'single' ? await workspace.single(workspace.model.context.selectedDisc) : await workspace.battle(workspace.model.context.selection.slice(0,2));
    const second = await workspace.keep(nextPreview), after = await rawGraph(backing);
    for (const fn of ['fn.studio.card', 'fn.studio.canvasScene', 'fn.studio.layeredCompositionScene', 'fn.studio.competitionScene']) {
      assert.equal(materialFunctionCount(after,fn), materialFunctionCount(before,fn), `${mode} repeated Keep cannot add another ${fn} tree`);
    }
    assert.notEqual(first.address,second.address);
    assert.notEqual(captureIdentity(first.capture),captureIdentity(second.capture));
    assert.deepEqual(second.capture.graphic,oldCapture.graphic);
    assert.deepEqual(second.capture.design,oldCapture.design);
    assert.deepEqual(second.capture.specimen ?? second.capture.competition,oldCapture.specimen ?? oldCapture.competition);
    assert.deepEqual(workspace.model.value(first.address),oldCapture);
  }
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(reopened.model.context.graphics.length,4);
});

test('a retained native validation failure cannot replace stored bytes or erase Keep intent', async () => {
  const backing=storage(),lock=locks(); let fail=false;
  const renderGraphic=async input=>{if(fail && input.design.study.startsWith('discstudio:'))throw Error('Synthetic retained geometry failure');return addressedWorkspaceGraphic(input);};
  const workspace=await openWorkspace({storage:backing,locks:lock,fixture,renderGraphic});
  await workspace.change({design:nativeWorkspaceDesign(workspace)});
  await workspace.keep(await workspace.single(workspace.model.context.selectedDisc));
  const preview=await workspace.single(workspace.model.context.selectedDisc),before=backing.getItem(archiveKey),head=workspace.model.contextAddress;
  fail=true;
  await assert.rejects(workspace.keep(preview),/Synthetic retained geometry failure/);
  assert.equal(backing.getItem(archiveKey),before);
  assert.equal(workspace.model.contextAddress,head);
  assert.equal(workspace.model.context.graphics.length,1);
  assert.deepEqual(workspace.draft,{operation:'keep',discAddress:preview.discAddress,materialAddress:undefined,design:preview.design});
});

const archiveMaterial = item => item===null || ['string','boolean','number'].includes(typeof item) ? {scalar:item}
  : Array.isArray(item) ? {array:item.map(archiveMaterial)} : {object:Object.entries(item).map(([key,value])=>[key,archiveMaterial(value)])};

test('ineligible retained Keep falls back to fresh rendering and keeps the SVG rejection guard', async () => {
  const backing=storage(),lock=locks();let renders=0;
  const renderGraphic=async input=>{renders++;return addressedWorkspaceGraphic(input);};
  let workspace=await openWorkspace({storage:backing,locks:lock,fixture,renderGraphic});
  await workspace.change({design:nativeWorkspaceDesign(workspace)});
  const first=await workspace.keep(await workspace.single(workspace.model.context.selectedDisc));
  const invalid=structuredClone(first.capture);invalid.source.disc=workspace.model.experience.shelf()[1].address;
  const graph=await rawGraph(backing),id=new Map(graph.bindings).get(first.address);
  graph.nodes.find(node=>node.id===id).material=archiveMaterial(invalid);
  backing.setItem(archiveKey,await archiveCodec.packArchive(JSON.stringify(graph)));
  workspace=await openWorkspace({storage:backing,locks:lock,fixture,renderGraphic});
  const preview=await workspace.single(workspace.model.context.selectedDisc),beforeRenders=renders;
  const second=await workspace.keep(preview);
  assert.equal(renders,beforeRenders+1,'an ineligible retained capture uses fresh candidate rendering');
  assert.notStrictEqual(workspace.model.pxc.get(second.capture.source.graphic),workspace.model.pxc.get(first.capture.source.graphic));
  assert.ok(!workspace.model.pxc.entries().some(([address])=>address.endsWith('.retainedGraphic')),'an ineligible capture never adds a reuse alias');
  assert.deepEqual(workspace.model.value(first.address),invalid);
  assert.equal(workspace.model.context.graphics.length,2);

  const changed={...await workspace.single(workspace.model.context.selectedDisc)};
  changed.graphic={...changed.graphic,svg:changed.graphic.svg+' '};
  const before=backing.getItem(archiveKey),head=workspace.model.contextAddress;
  await assert.rejects(workspace.keep(changed),{code:'THRO_PREVIEW_CHANGED'});
  assert.equal(backing.getItem(archiveKey),before);
  assert.equal(workspace.model.contextAddress,head);
  assert.deepEqual(workspace.draft,{operation:'keep',discAddress:changed.discAddress,materialAddress:undefined,design:changed.design});
});

test('unbound preview sources fall back without creating a reuse alias', async () => {
  const workspace=await openWorkspace({storage:storage(),locks:locks(),fixture,renderGraphic:addressedWorkspaceGraphic});
  await workspace.change({design:nativeWorkspaceDesign(workspace)});
  const first=await workspace.keep(await workspace.single(workspace.model.context.selectedDisc));
  const preview=await workspace.single(workspace.model.context.selectedDisc);
  const second=await workspace.keep({...preview,resolvedAddress:preview.resolvedAddress+'.missing'});
  assert.notStrictEqual(workspace.model.pxc.get(second.capture.source.graphic),workspace.model.pxc.get(first.capture.source.graphic));
  assert.equal(workspace.model.context.graphics.length,2);
});

test('a stale retained Keep preserves the newer commit and complete pending intent', async () => {
  const backing=storage(),lock=locks();
  const initial=await openWorkspace({storage:backing,locks:lock,fixture,renderGraphic:addressedWorkspaceGraphic});
  await initial.change({design:nativeWorkspaceDesign(initial)});
  await initial.keep(await initial.single(initial.model.context.selectedDisc));
  const stale=await openWorkspace({storage:backing,locks:lock,fixture,renderGraphic:addressedWorkspaceGraphic});
  const newer=await openWorkspace({storage:backing,locks:lock,fixture,renderGraphic:addressedWorkspaceGraphic});
  const preview=await stale.single(stale.model.context.selectedDisc),head=stale.model.contextAddress;
  await newer.change({name:'Newer retained capture owner'});
  const winning=backing.getItem(archiveKey);
  await assert.rejects(stale.keep(preview),{code:'THRO_STORAGE_CONFLICT'});
  assert.equal(backing.getItem(archiveKey),winning);
  assert.equal(stale.model.contextAddress,head);
  assert.equal(stale.model.context.graphics.length,1);
  assert.deepEqual(stale.draft,{operation:'keep',discAddress:preview.discAddress,materialAddress:undefined,design:preview.design});
});
