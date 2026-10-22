import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openDemo } from '../../experiences/thro/dist/model.mjs';
import { createExperience, initialDraft } from '../../experiences/thro/dist/studio/upload-disc-to-shelf/model.js';
import { archive } from '../../experiences/thro/dist/studio/upload-disc-to-shelf/persistence.js';

// Real prepared fixture bytes seed the owning archive. The native graphic below
// is a synthetic opaque carrier; these tests make no visual-quality claim.
const fixtureBase = new URL('../../experiences/thro/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('prepared-fixture.json', fixtureBase)));
const fixtures = manifest.discs.map(disc => {
  const bytes = fs.readFileSync(new URL(disc.file, fixtureBase));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), disc.sha256);
  return { ...disc, depiction: { kind: 'photo', name: disc.name, src: `data:image/webp;base64,${bytes.toString('base64')}` } };
});
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dAAAAABJRU5ErkJggg==';
const nativeGraphic = Object.freeze({
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image href="${png}" width="1920" height="1080"/></svg>`,
  width: 1920,
  height: 1080,
  provenance: { schema: 'synthetic-native-dispatch-fixture@1', rendererBuild: '28ac2b39fab85255', style: 'b01', fixtureOnly: true },
});

function memory(raw) {
  return { getItem: () => raw, setItem: (_key, next) => { raw = next; }, async flush() {}, get raw() { return raw; } };
}
let seedArchive;
async function preparedStorage({ duplicateServo = false } = {}) {
  const makeArchive = async items => {
    let retained;
    const experience = createExperience(() => {}, { persist(state) { retained = state; } });
    for (const fixture of items) {
      const mold = experience.seedOptions().find(row => row.seed.id === fixture.mold);
      assert.ok(mold, `Prepared fixture mold exists: ${fixture.mold}`);
      await experience.save({ ...initialDraft(), mold: mold.address, plastic: fixture.plastic, weight: fixture.weight }, fixture.depiction);
    }
    return archive(retained);
  };
  if (duplicateServo) return memory(await makeArchive([...fixtures, { ...fixtures[0], weight: 174 }]));
  seedArchive ??= makeArchive(fixtures);
  return memory(await seedArchive);
}
const nativeDesign = model => ({ ...model.context.design, study: 'discstudio:b01', rendererBuild: '28ac2b39fab85255', orientation: 'landscape' });
async function renderNative(model, discAddress, design = nativeDesign(model)) {
  let result;
  // The existing model reaches legacy study validation and rejects this ID.
  // Assert acceptance so the initial RED is an assertion about missing dispatch,
  // rather than an unhandled rejection or an import failure.
  await assert.doesNotReject(async () => { result = await model.render(discAddress, design); }, 'a handled native study must bypass the legacy card-study validator');
  return result;
}

test('native dispatch registers the graphic with real owning-model source bindings', async () => {
  const backing = await preparedStorage();
  let received;
  const model = await openDemo(backing, { async renderGraphic(input) { received = input; return structuredClone(nativeGraphic); } });
  const row = model.experience.shelf()[0], design = nativeDesign(model);
  const result = await renderNative(model, row.address, design);

  assert.equal(received.discAddress, row.address);
  assert.deepEqual(received.disc, model.value(row.address));
  assert.deepEqual(received.design, design);
  assert.deepEqual(model.value(received.designAddress), design);
  assert.deepEqual(model.value(received.resolvedAddress), received.resolved);
  assert.equal(received.resolved.name, row.seed.name);
  assert.equal(result.discAddress, row.address);
  assert.equal(result.designAddress, received.designAddress);
  assert.equal(result.resolvedAddress, received.resolvedAddress);
  assert.equal(typeof result.address, 'string');
  assert.deepEqual(model.value(result.address), nativeGraphic);
  assert.deepEqual(result.graphic, nativeGraphic);
});

test('native captures retain plain provenance and distinct physical origins after archive reopen', async () => {
  const backing = await preparedStorage({ duplicateServo: true });
  const hook = { async renderGraphic() { return structuredClone(nativeGraphic); } };
  const model = await openDemo(backing, hook), rows = model.experience.shelf();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].seed.name, 'Servo');
  assert.equal(rows[3].seed.name, rows[0].seed.name);
  assert.notEqual(rows[0].disc.id, rows[3].disc.id, 'the same mold still has two physical identities');
  assert.notEqual(rows[0].address, rows[3].address, 'each physical copy has its own version address');
  assert.notEqual(rows[0].disc.weight, rows[3].disc.weight);
  const design = nativeDesign(model), kept = [];
  for (const row of [rows[0], rows[3]]) {
    const result = await renderNative(model, row.address, design);
    const held = await model.capture(result, 'thro.native-dispatch-fixture');
    assert.equal(held.capture.source.graphic, result.address);
    assert.equal(held.capture.source.disc, row.address);
    assert.equal(held.capture.source.design, result.designAddress);
    assert.equal(held.capture.hash, createHash('sha256').update(nativeGraphic.svg).digest('hex'));
    kept.push(held);
  }
  assert.notEqual(kept[0].address, kept[1].address);
  assert.notEqual(kept[0].capture.source.disc, kept[1].capture.source.disc);
  assert.equal(kept[0].capture.hash, kept[1].capture.hash, 'identical bytes do not erase distinct physical origins');

  const reopened = await openDemo(backing, hook);
  assert.equal(reopened.context.graphics.length, 2);
  for (const held of kept) {
    const capture = reopened.value(held.address);
    assert.deepEqual(capture, held.capture);
    assert.deepEqual(capture.graphic.provenance, nativeGraphic.provenance);
    assert.deepEqual(reopened.value(capture.source.graphic), nativeGraphic);
    assert.equal(reopened.value(capture.source.disc).id, capture.specimen.disc.id);
  }
  assert.deepEqual(reopened.experience.shelf().slice(0, 3).map(row => row.disc.depiction.src), fixtures.map(fixture => fixture.depiction.src));
  assert.equal(reopened.experience.shelf()[3].disc.depiction.src, fixtures[0].depiction.src);
});

test('a null native hook preserves the existing legacy default graphic', async () => {
  const backing = await preparedStorage(), baselineBacking = memory(backing.raw);
  const baseline = await openDemo(baselineBacking);
  const baselineResult = await baseline.render(baseline.experience.shelf()[0].address, baseline.context.design);
  let received;
  const model = await openDemo(backing, { async renderGraphic(input) { received = input; return null; } });
  const result = await model.render(model.experience.shelf()[0].address, model.context.design);

  assert.ok(received, 'legacy dispatch offers the hook its request before falling back');
  assert.equal(received.design.study, baseline.context.design.study);
  assert.equal(result.graphic.svg, baselineResult.graphic.svg);
  assert.equal(result.graphic.width, baselineResult.graphic.width);
  assert.equal(result.graphic.height, baselineResult.graphic.height);
  assert.deepEqual(model.value(result.designAddress), baseline.value(baselineResult.designAddress));
});
