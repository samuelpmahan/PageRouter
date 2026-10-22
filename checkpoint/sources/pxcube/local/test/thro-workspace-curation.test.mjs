import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const runtime = process.env.THRO_PACKAGE_RUNTIME ? pathToFileURL(process.env.THRO_PACKAGE_RUNTIME.replaceAll('\\', '/') + '/') : new URL('../../experiences/thro/dist/', import.meta.url);
const { openWorkspace, archiveKey } = await import(new URL('workspace.mjs', runtime));
const manifest = JSON.parse(fs.readFileSync(new URL('prepared-fixture.json', runtime)));
const fixture = manifest.discs.map(disc => ({ ...disc, depiction: { kind: 'photo', name: disc.name, src: `data:image/webp;base64,${fs.readFileSync(new URL(disc.file, runtime)).toString('base64')}` } }));
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }; };
const locks = () => ({ request: async (_name, _options, action) => action() });
function draft(workspace) { const source = workspace.model.experience.shelf()[0].disc; return Object.fromEntries(['mold', 'nickname', 'weight', 'plastic', 'Color1', 'Color2', 'paintMode', 'colorPainting'].map(key => [key, source[key]])); }

test('curation saves a new physical copy through durable promotion and reopens exact bag versions', async () => {
  const backing = storage(), lock = locks(), workspace = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(typeof workspace.saveDisc, 'function', 'owning workspace must expose transactional saveDisc');
  const previous = workspace.model;
  const address = await workspace.saveDisc({ ...draft(workspace), nickname: 'Sam prepared copy' }, fixture[0].depiction);
  assert.notEqual(workspace.model, previous);
  const rows = workspace.model.experience.shelf();
  assert.equal(rows.length, 4);
  assert.notEqual(rows[0].disc.id, rows.at(-1).disc.id, 'two copies of the same mold retain different physical identities');
  assert.equal(rows.at(-1).address, address);
  const bag = await workspace.createBag('Prepared for player', [address, rows[0].address]);
  const reopened = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(reopened.model.experience.shelf().length, 4);
  assert.equal(reopened.model.value(address).depiction.src, fixture[0].depiction.src);
  assert.deepEqual(reopened.model.value(bag).versions.map(item => item.address), [address, rows[0].address]);
});

test('curation snapshots caller input before the queued save begins', async () => {
  const workspace = await openWorkspace({ storage: storage(), locks: locks(), fixture });
  assert.equal(typeof workspace.saveDisc, 'function');
  const material = { ...draft(workspace), nickname: 'Original intent' }, depiction = { ...fixture[0].depiction }, sources = { photo: { ...fixture[0].depiction } };
  const saved = workspace.saveDisc(material, depiction, sources);
  material.nickname = 'Later mutation'; depiction.src = 'bad'; sources.photo.src = 'bad';
  const address = await saved;
  assert.equal(workspace.model.value(address).nickname, 'Original intent');
  assert.equal(workspace.model.value(address).depiction.src, fixture[0].depiction.src);
});

test('stale curator save preserves committed owner, stored bytes and exact attempted photo', async () => {
  const backing = storage(), lock = locks();
  const first = await openWorkspace({ storage: backing, locks: lock, fixture });
  const stale = await openWorkspace({ storage: backing, locks: lock, fixture });
  assert.equal(typeof stale.saveDisc, 'function');
  await first.change({ name: 'Newer tab' });
  const bytes = backing.getItem(archiveKey), owner = stale.model;
  await assert.rejects(stale.saveDisc({ ...draft(stale), nickname: 'Pending photo' }, fixture[0].depiction), { code: 'THRO_STORAGE_CONFLICT' });
  assert.equal(stale.model, owner);
  assert.equal(backing.getItem(archiveKey), bytes);
  assert.equal(stale.draft.operation, 'save-disc');
  assert.equal(stale.draft.depiction.src, fixture[0].depiction.src);
  assert.equal(stale.draft.draft.nickname, 'Pending photo');
});

test('quota failure cannot promote a curated copy and readback uncertainty never rolls back', async () => {
  const backing = storage(), workspace = await openWorkspace({ storage: backing, locks: locks(), fixture });
  const bytes = backing.getItem(archiveKey), owner = workspace.model, write = backing.setItem;
  backing.setItem = () => { throw new DOMException('Synthetic quota', 'QuotaExceededError'); };
  await assert.rejects(workspace.saveDisc(draft(workspace), fixture[0].depiction), { code: 'THRO_STORAGE_UNAVAILABLE' });
  assert.equal(workspace.model, owner); assert.equal(backing.getItem(archiveKey), bytes); assert.equal(workspace.draft.depiction.src, fixture[0].depiction.src);
  backing.setItem = write;
  const uncertain = await openWorkspace({ storage: backing, locks: locks(), fixture });
  backing.setItem = (key, _value) => write(key, 'Synthetic concurrent bytes');
  await assert.rejects(uncertain.saveDisc(draft(uncertain), fixture[0].depiction), { code: 'THRO_STORAGE_UNCERTAIN' });
  assert.equal(backing.getItem(archiveKey), 'Synthetic concurrent bytes'); assert.equal(uncertain.model.experience.shelf().length, 3);
});
