import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openWorkspace, archiveKey } from './dist/workspace.mjs';

const manifest = JSON.parse(fs.readFileSync(new URL('./prepared-fixture.json', import.meta.url)));
const fixture = manifest.discs.map(disc => {
  const bytes = fs.readFileSync(new URL(disc.file, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), disc.sha256);
  return { ...disc, depiction: { kind: 'photo', src: `data:image/webp;base64,${bytes.toString('base64')}`, name: disc.name } };
});
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
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.disc.depiction.kind), ['photo', 'photo', 'photo']);
  assert.deepEqual(rows.map(row => row.seed.name), ['Servo', 'Buzzz SS', 'Anchor']);
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
});
