import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, initialDraft, flightFields } from './model.ts';

test('save composes a disc and a shelf, retaining inputs and readback evidence', async () => {
  const app = createExperience(() => {});
  const depiction = await app.selectPainting(() => .5);
  const draft = { ...initialDraft(), nickname: 'Minty', plastic: 'ESP', weight: 177 };
  const address = await app.save(draft, depiction);
  const part = app.pxc.get(address);
  assert.equal(part.composition.calculation, app.pxc.get('oc.create'));
  assert.equal(app.pxc.get(`ds.px.resolved.${part.value.id}`).composition.inputs.base, app.pxc.get(draft.mold));
  assert.equal(part.composition.inputs.depiction.composition.calculation, app.pxc.get('fn.selectPainting'));
  assert.equal(app.shelf()[0].disc.nickname, 'Minty');
  assert.equal(app.shelf()[0].disc.depiction.src, depiction.src);
  assert.deepEqual(flightFields.map(field => app.shelf()[0].seed[field]), [5, 4, -1, 1]);
  assert.equal(app.pxc.get(app.shelfAddress).composition.inputs.disc, part);
  assert.equal(app.events.at(-1)?.event, 'disc.save.completed');
  assert.equal(app.events.at(-1)?.shelfContainsDisc, true);
  draft.nickname = 'Later edit';
  assert.equal(app.shelf()[0].disc.nickname, 'Minty');
});
test('two specimens share a seed without replacing each other or prior shelf', async () => {
  const app = createExperience(() => {}), image = await app.selectPainting(() => 0);
  const a = await app.save(initialDraft(), image), previous = app.shelfAddress;
  const b = await app.save({ ...initialDraft(), Color1: '#ff0000' }, image);
  assert.notEqual(a, b); assert.equal(app.shelf().length, 2);
  assert.deepEqual(app.pxc.get(previous).value, [a]);
  assert.equal(app.shelf()[0].disc.Color1, '#98d4ba');
});
test('invalid inputs do not publish a shelf or a success receipt', async () => {
  const app = createExperience(() => {}), image = await app.selectPainting(() => 0);
  for (const bad of [{ weight: NaN }, { mold: 'missing' }, { Color1: '<script>' }]) {
    await assert.rejects(app.save({ ...initialDraft(), ...bad }, image));
  }
  assert.equal(app.shelf().length, 0);
  assert.equal(app.events.filter(e => e.event === 'disc.save.completed').length, 0);
  assert.equal(app.events.length, 3);
});
test('photo depiction stays with the disc and logs never contain image bytes', async () => {
  const app = createExperience(() => {});
  await app.save(initialDraft(), { kind: 'photo', src: 'data:image/webp;base64,AAAA', name: 'local.webp' });
  assert.equal(app.shelf()[0].disc.depiction.kind, 'photo');
  assert.equal(JSON.stringify(app.events).includes('base64'), false);
});
test('selection is explicit and retained, not randomized by reads', async () => {
  const app = createExperience(() => {}); let calls = 0;
  const painting = await app.selectPainting(() => { calls++; return .99; });
  await app.save(initialDraft(), painting);
  app.shelf(); app.shelf();
  assert.equal(calls, 1); assert.equal(painting.name, 'contour-basin');
});
test('overlapping saves are refused and cannot lose shelf membership', async () => {
  const app = createExperience(() => {}), painting = await app.selectPainting(() => 0);
  const first = app.save(initialDraft(), painting);
  await assert.rejects(app.save(initialDraft(), painting), /in progress/);
  await first; assert.equal(app.shelf().length, 1);
});
