import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCardSeek } from '../projections/discstudio-seek.mjs';
import { planCardPlacement, selectShot } from '../projections/seek-plan.mjs';

const card = new URL('../fixtures/seek/card.png', import.meta.url);
const background = new URL('../fixtures/seek/frame.jpeg', import.meta.url);
const storyboardFile = new URL('../examples/salamander-one-frame.json', import.meta.url);

test('one real Card and frame seek reproducibly without obscuring marked screen regions', async () => {
  const storyboard = JSON.parse(await readFile(storyboardFile, 'utf8'));
  const seek = await createCardSeek({ cardBytes: await readFile(card), backgroundBytes: await readFile(background), storyboard });
  const first = seek(0), later = seek(1.5);
  assert.equal(first.receipt.shot, 'salamander-right-of-thrower');
  assert.equal(first.receipt.frameSha256, later.receipt.frameSha256);
  assert.deepEqual(first.png, later.png);
  assert.deepEqual(first.receipt.protectedRegionsChecked, ['top-caption', 'thrower-and-discs', 'bottom-caption']);
  await assert.throws(() => seek(2), /No storyboard shot/);
});

test('explicit screen annotations reject subject and caption occlusion', () => {
  const shot = { placement: { anchor: [0.5, 0.5], scale: 1 }, protected: [{ id: 'teacher-face', box: [0.4, 0.4, 0.2, 0.2] }] };
  assert.throws(() => planCardPlacement({ width: 1080, height: 1920, alphaBounds: [300, 600, 780, 1250], shot }), /teacher-face/);
  assert.throws(() => planCardPlacement({ width: 1080, height: 1920, alphaBounds: [300, 600, 780, 1250], shot: { ...shot, placement: { anchor: [0.95, 0.5], scale: 1 } } }), /leave the frame/);
});

test('time selects authored storyboard states without accumulating playback state', () => {
  const storyboard = { schema: 'discstudio-seek-storyboard@1', shots: [
    { id: 'first', start: 0, end: 2 }, { id: 'second', start: 2, end: 4 }
  ] };
  assert.equal(selectShot(storyboard, 3).id, 'second');
  assert.equal(selectShot(storyboard, 0).id, 'first');
  assert.equal(selectShot(storyboard, 2).id, 'second');
});
