// The card's recipe lives in the PxC world (thro.card.recipe) and must equal what the renderer is asked to draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createThroWorld } from '../../experiences/thro/thro-world.mjs';
import { nativeStudies, nativeDesign, nativeCardRequest, cardRevisions, nativeBuild } from '../../experiences/thro/native-cards.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../../experiences/thro/prepared-fixture.json', import.meta.url)));
const facts = { name: 'Servo', manufacturer: 'MVP', speed: 6.5, glide: 5, turn: -1, fade: 2 };
const variants = [{}, { nativePlate: 'solid' }, { nativeNudge: { x: 120, y: -40 } }, { nativeScale: 1.2, accent: '#ff4d6d' }, { nativeSide: 'left', nativeHighlight: 'tiles' }];

test('for every disc, layout, revision and design variant, the world\'s recipe is exactly the renderer\'s request minus the photo bytes', () => {
  const world = createThroWorld(); let checked = 0;
  for (const d of fixture.discs) for (const study of nativeStudies) {
    const revisions = [undefined, cardRevisions[study.preset]].filter((r, i, all) => i === 0 || (r !== undefined && r !== all[0]));
    for (const revision of revisions) for (const variant of variants) {
      const design = { ...nativeDesign({ study: study.id, accent: study.accent }, study.id), ...variant, rendererBuild: nativeBuild };
      if (revision === undefined) delete design.nativeRevision; else design.nativeRevision = revision;
      const disc = { id: d.id, mold: d.mold, plastic: d.plastic ?? null, weight: d.weight ?? null };
      const request = nativeCardRequest({ disc: { ...disc, depiction: { kind: 'photo', src: 'data:image/webp;base64,AAAA' } }, resolved: facts, design });
      const { recipe } = world.run('thro.card.recipe', { disc, facts, design, photo: d.sha256 }).outputs;
      const { depiction, ...requestFacts } = request.disc; const { photoSrc, disc: _, ...requestRest } = request;
      assert.deepEqual(recipe, { disc: requestFacts, ...requestRest, photo: d.sha256 }, `${d.id} ${study.id} revision ${revision} ${JSON.stringify(variant)}`);
      checked++;
    }
  }
  assert.equal(checked, fixture.discs.length * nativeStudies.length * 2 * variants.length, 'every combination was checked (every layout has revision 3)');
});

test('the same card is the same Part: one hash, and a second run is served from the cache', () => {
  const world = createThroWorld(), d = fixture.discs[0];
  const input = { disc: { id: d.id, mold: d.mold, plastic: d.plastic ?? null, weight: null }, facts, design: { study: 'discstudio:b01', rendererBuild: nativeBuild, nativeRevision: 3 }, photo: d.sha256 };
  const a = world.run('thro.card.recipe', input), b = world.run('thro.card.recipe', input);
  assert.equal(a.receipt.outputs.recipe, b.receipt.outputs.recipe, 'same recipe hash');
  assert.ok(b.trace.cachedFrom, 'the second run is a cache hit');
  const c = world.run('thro.card.recipe', { ...input, design: { ...input.design, accent: '#ff4d6d' } });
  assert.notEqual(c.receipt.outputs.recipe, a.receipt.outputs.recipe, 'a different accent is a different recipe');
});

test('the recipe contract is proven by its examples', () => {
  const proofs = createThroWorld().prove('thro.card.recipe');
  assert.ok(proofs.length === 2 && proofs.every(p => p.ok), proofs.map(p => p.detail).join('; '));
});
