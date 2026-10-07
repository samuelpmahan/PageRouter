import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createExperience } from '../../vendor/studio/upload-disc-to-shelf/model.ts';
import { Part } from '../../vendor/studio/part-first-kernel/src/pxc.mjs';
import { defaultPresets, composeCard, composeOverlay, materializeOverlay } from '../../vendor/studio-renderer/src/presentation.js';
import { createPartFirstHandler, createSceneHost } from '../scene-host.mjs';
import { discStudioPhotoCardScene, installDiscStudioSceneCalculations } from '../scenes/discstudio-photo-card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const photoPath = path.join(root, 'local/studio-demo/assets/tee-shot-original.jpg');
const photoSource = Object.freeze({
  path: 'local/studio-demo/assets/tee-shot-original.jpg',
  license: 'CC BY 2.0, as identified in local/studio-demo/assets/README.md',
  role: 'photo input for the DiscStudio renderer; not represented as a disc-photo recognition result',
});

test('DiscStudio photo → Card → placement runs in separate, inspectable PxC worlds', async () => {
  const photoBytes = await readFile(photoPath);
  const photo = `data:image/jpeg;base64,${photoBytes.toString('base64')}`;
  const instances = new Map(), stores = new Map(), disposed = [];
  const handler = createPartFirstHandler({
    id: 'discstudio-part-first',
    storeFor({ id }) {
      const experience = createExperience(() => {});
      installDiscStudioSceneCalculations(experience, { Part, composeCard, composeOverlay, materializeOverlay });
      const world = { id, experience, pxc: experience.pxc };
      instances.set(id, world);
      return world;
    },
    storeOf: world => { stores.set(world.id, world.experience.pxc); return world.pxc; },
    serviceFor: (world, name) => name === 'discstudio.experience' ? { save: world.experience.save.bind(world.experience) } : undefined,
    makePart: value => new Part(value),
    isPart: value => value instanceof Part,
    dispose: world => { disposed.push(world.id); instances.delete(world.id); },
  });
  const host = createSceneHost({ handler });
  const scene = discStudioPhotoCardScene();
  const inputs = placement => [
    { address: 'ds.px.scene.photo-card-placement.photo-input', value: photo },
    { address: 'ds.px.scene.photo-card-placement.design', value: { orientation: 'portrait', placement, scale: 1 } },
    { address: 'ds.px.scene.photo-card-placement.preset', value: defaultPresets().spotlight },
    { address: 'ds.px.scene.photo-card-placement.frame', value: null },
  ];

  const baseline = await host.composeWorld({ id: 'baseline', inputs: inputs('bottom-left'), scenes: [scene] });
  const candidate = await host.composeWorld({ id: 'candidate', inputs: inputs('bottom-right'), scenes: [scene] });
  assert.notEqual(instances.get('baseline').experience, instances.get('candidate').experience);
  assert.notEqual(instances.get('baseline').pxc, instances.get('candidate').pxc);
  assert.equal(stores.get('baseline'), instances.get('baseline').experience.pxc, 'provider service and hosted store use the same Part-first PxC');
  assert.equal(stores.get('candidate'), instances.get('candidate').experience.pxc, 'candidate service is mounted in its own Part-first PxC');

  for (const world of [baseline, candidate]) {
    const report = world.scene('photo-card-placement');
    assert.equal(report.status, 'PASS');
    assert.deepEqual(report.result.dimensions, [1080, 1920]);
    assert.ok(report.receipts.some(receipt => receipt.into === 'ds.px.art.save-1' && receipt.calculation === 'fn.renderDepiction'),
      'photo depiction was produced by DiscStudio’s existing Calculation');
    assert.ok(report.receipts.some(receipt => receipt.into === 'ds.px.scene.photo-card-placement.card' && receipt.calculation === 'fn.studio.card'));
    assert.ok(report.receipts.some(receipt => receipt.into === 'ds.px.scene.photo-card-placement.placement' && receipt.calculation === 'fn.pxcube.scenePlacement'));
    assert.ok(report.receipts.some(receipt => receipt.into === 'ds.px.scene.photo-card-placement.graphic' && receipt.calculation === 'fn.studio.graphic'));
    assert.ok(world.inspect().addresses.includes('ds.px.scene.photo-card-placement.graphic'));
    const placementReceipt = report.receipts.find(receipt => receipt.into === 'ds.px.scene.photo-card-placement.placement');
    assert.deepEqual(placementReceipt.inputs, {
      card: 'ds.px.scene.photo-card-placement.card',
      frame: 'ds.px.scene.photo-card-placement.frame',
      design: 'ds.px.scene.photo-card-placement.design',
    }, 'the Calculation binds its declared Parts by address, not copied inline values');
  }

  const photoA = await baseline.read('ds.px.photo.save-1'), photoB = await candidate.read('ds.px.photo.save-1');
  assert.notEqual(photoA, photoB, 'snapshot values are separately cloned from separate PxC stores');
  assert.equal(photoA.src, photoB.src);
  assert.equal(photoA.src, photo, `source fixture: ${photoSource.path}`);
  const cardA = await baseline.read('ds.px.scene.photo-card-placement.card'), cardB = await candidate.read('ds.px.scene.photo-card-placement.card');
  assert.notEqual(cardA, cardB);
  assert.equal(cardA.presetId, cardB.presetId);
  const placementA = await baseline.read('ds.px.scene.photo-card-placement.placement');
  const placementB = await candidate.read('ds.px.scene.photo-card-placement.placement');
  assert.notEqual(placementA.placements[0].x, placementB.placements[0].x, 'candidate placement changes only the view geometry');
  const graphicA = await baseline.read('ds.px.scene.photo-card-placement.graphic');
  const graphicB = await candidate.read('ds.px.scene.photo-card-placement.graphic');
  assert.notEqual(graphicA.svg, graphicB.svg);

  const oldGraphic = graphicA;
  await baseline.close();
  const reopened = await host.composeWorld({ id: 'baseline', inputs: inputs('bottom-left'), scenes: [scene] });
  assert.notEqual(await reopened.read('ds.px.scene.photo-card-placement.graphic'), oldGraphic);
  assert.deepEqual(disposed, ['baseline']);
  await reopened.close(); await candidate.close();
  assert.deepEqual(disposed, ['baseline', 'baseline', 'candidate']);
});
