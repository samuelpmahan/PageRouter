// Kept graphics: no cap, and each one can be deleted (Sam, 30 Oct: "A cap is unnecessary", "Add a delete on each kept graphic").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const runtime = process.env.THRO_PACKAGE_RUNTIME ? pathToFileURL(process.env.THRO_PACKAGE_RUNTIME.replaceAll('\\', '/') + '/') : new URL('../../experiences/thro/dist/', import.meta.url);
const { openWorkspace } = await import(new URL('workspace.mjs', runtime));
const manifest = JSON.parse(fs.readFileSync(new URL('prepared-fixture.json', runtime)));
const fixture = manifest.discs.map(disc => ({ ...disc, depiction: { kind: 'photo', name: disc.name, src: `data:image/webp;base64,${fs.readFileSync(new URL(disc.file, runtime)).toString('base64')}` } }));
const locks = { request: async (_name, _options, action) => action() };
// Answers with promises, as IndexedDB does: the archive must await every read and write.
const asyncStorage = () => { const values = new Map(); return { values, getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } }; };

test('forty kept graphics on a storage that answers with promises: none refused, and all reopen', async () => {
  const storage = asyncStorage();
  const workspace = await openWorkspace({ storage, locks, fixture });
  const rows = workspace.model.experience.shelf();
  for (let i = 0; i < 40; i++) await workspace.keep(await workspace.single(rows[i % rows.length].address));
  assert.equal(workspace.model.context.graphics.length, 40);
  const reopened = await openWorkspace({ storage, locks });
  assert.equal(reopened.model.context.graphics.length, 40);
});

test('deleting a kept graphic removes only that one, and the deletion is saved', async () => {
  const storage = asyncStorage();
  const workspace = await openWorkspace({ storage, locks, fixture });
  const rows = workspace.model.experience.shelf();
  const kept = [];
  for (let i = 0; i < 3; i++) kept.push(await workspace.keep(await workspace.single(rows[i].address)));
  await workspace.forget(kept[1].address);
  assert.deepEqual(workspace.model.context.graphics, [kept[0].address, kept[2].address]);
  const reopened = await openWorkspace({ storage, locks });
  assert.deepEqual(reopened.model.context.graphics, [kept[0].address, kept[2].address]);
});
