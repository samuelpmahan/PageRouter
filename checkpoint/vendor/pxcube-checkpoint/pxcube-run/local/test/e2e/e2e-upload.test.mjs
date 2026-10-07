// E2E: UploadDiscToShelf, driven in Node against the shipped Studio model.
// No DOM, no browser: createExperience/startSandbox/inspectExperience are
// pure JS (the module's own header guarantees no DOM access on import), and
// they are the actual objects the browser asserts on via pxCubeModel.
// Flows mirror the browser checks: photo-free save produces a real Disc,
// mounted resolution returns the exact Part, sandboxes stay isolated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { siteFile } from './e2e-site.mjs';

const studio = 'experiences/upload-disc-to-shelf/studio/upload-disc-to-shelf';
const { createExperience, initialDraft } = await import(siteFile(studio, 'model.js'));
const { startSandbox, inspectExperience } = await import(siteFile(studio, 'experience-fixtures.js'));

const quiet = () => {};

test('photo-free save produces a real Disc with a painted depiction', async () => {
  const experience = await startSandbox('upload', quiet);
  assert.equal(inspectExperience(experience).discs.length, 0);

  const image = await experience.selectPainting(() => 0);
  await experience.save({ ...initialDraft(), plastic: 'ESP', weight: 174 }, image);

  const snap = inspectExperience(experience);
  assert.equal(snap.discs.length, 1);
  assert.equal(snap.discs[0].own.depiction.kind, 'painted');
  assert.equal(snap.discs[0].own.weight, 174);
});

test('mounted resolution returns the exact Part, hydrated through the mold', async () => {
  const experience = await startSandbox('upload', quiet);
  const image = await experience.selectPainting(() => 0);
  await experience.save({ ...initialDraft(), plastic: 'ESP', weight: 174 }, image);

  const snap = inspectExperience(experience);
  const { address, own, resolved } = snap.discs[0];
  // The store returns the identical Part object on repeat reads (no copies
  // at the seam), and the shelf Part holds the disc's address.
  // (inspectExperience clones for display; the live Part is what resolves.)
  const live = experience.pxc.get(address);
  assert.equal(experience.pxc.get(address), live, 'repeat reads return the identical Part');
  assert.ok(experience.pxc.get(experience.shelfAddress).value.includes(address));
  // Hydration fills mold fields at read time; nothing hydrated is persisted.
  assert.ok(Number.isFinite(resolved.speed), 'resolved disc carries mold flight numbers');
  assert.equal(resolved.plastic, 'ESP');
  assert.equal(own.weight, 174);
});

test('composition receipts record the save', async () => {
  const experience = await startSandbox('upload', quiet);
  const image = await experience.selectPainting(() => 0);
  await experience.save({ ...initialDraft(), plastic: 'ESP', weight: 174 }, image);
  const { receipts } = inspectExperience(experience);
  assert.ok(receipts.length > 0, 'the save composed with receipts');
  for (const receipt of receipts) {
    assert.ok(typeof receipt.into === 'string' && typeof receipt.status === 'string');
  }
});

test('separate sandboxes are isolated: save in one, the other stays empty', async () => {
  const a = await startSandbox('upload', quiet);
  const b = await startSandbox('upload', quiet);
  const image = await a.selectPainting(() => 0);
  await a.save({ ...initialDraft(), plastic: 'ESP', weight: 174 }, image);
  assert.equal(inspectExperience(a).discs.length, 1);
  assert.equal(inspectExperience(b).discs.length, 0);
});

test('the shelf sandbox seeds three discs and the shelf query runs', async () => {
  const experience = await startSandbox('shelf', quiet);
  assert.equal(inspectExperience(experience).discs.length, 3);
  const result = await experience.queryShelf({});
  assert.equal(result.total, 3);
});
