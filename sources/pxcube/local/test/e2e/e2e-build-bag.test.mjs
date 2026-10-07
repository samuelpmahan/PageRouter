// The shipped BuildBag now uses the Studio consumer. Exercise its actual
// packaged model, as the Upload/Shelf model tests do; scaffold behavior remains
// covered by scaffold.test.mjs and scaffold-browser.mjs on a generated fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { siteFile } from './e2e-site.mjs';
const { openDemo } = await import(siteFile('experiences/build-bag', 'model.mjs'));
const memory = () => {
  let raw = null;
  return { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
};

test('the shipped BuildBag creates an ordered bag of exact physical copies', async () => {
  const storage = memory(), model = await openDemo(storage);
  const rows = model.experience.shelf();
  assert.equal(rows.length, 8);
  const selected = [rows[2].address, rows[0].address, rows[1].address];
  await model.patch({ name: 'Fieldwork', selection: selected });
  const reordered = await model.reorder(2, 0);
  assert.deepEqual(reordered, [selected[2], selected[0], selected[1]]);
  await model.patch({ selection: reordered });
  const address = await model.createBag(), bag = model.value(address);
  assert.equal(bag.name, 'Fieldwork');
  assert.deepEqual(bag.versions.map(item => item.address), reordered);
  assert.deepEqual(bag.discIds, reordered.map(item => model.value(item).id));
  assert.equal(model.pxc.get(address).composition.calculation, model.pxc.get('fn.createBag'));
  const restored = await openDemo(storage);
  assert.deepEqual(restored.experience.bags()[0].bag, bag);
});

test('the shipped BuildBag retains its draft and keeps another sandbox isolated', async () => {
  const storage = memory(), model = await openDemo(storage);
  const selection = [model.experience.shelf()[0].address];
  await model.patch({ name: 'My draft', selection });
  const restored = await openDemo(storage);
  assert.equal(restored.context.name, 'My draft');
  assert.deepEqual(restored.context.selection, selection);
  assert.equal(restored.experience.bags().length, 0);
  const other = await openDemo(memory());
  assert.equal(other.context.name, '');
  assert.deepEqual(other.context.selection, []);
  assert.equal(other.experience.bags().length, 0);
});

test('the shipped BuildBag rejects stale or repeated physical copies', async () => {
  const model = await openDemo(memory());
  const address = model.experience.shelf()[0].address;
  await assert.rejects(model.experience.createBag('Duplicate', [address, address]), /more than once/);
  await assert.rejects(model.experience.createBag('Missing', ['ds.px.disc.missing']), /stale or absent/);
  assert.equal(model.experience.bags().length, 0);
});
