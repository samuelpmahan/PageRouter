// A lineup's recipe lives in the PxC world (thro.lineup.recipe: one thro.card.recipe per disc) and must equal what the lineup
// renderer is asked to draw; its Part hash is the renderer's pixel key.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createThroWorld } from '../../experiences/thro/thro-world.mjs';
import { lineupStudies, nativeLineupPlan, nativeCardRequest, lineupRequestRecipe, recipePartHash } from '../../experiences/thro/native-cards.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../../experiences/thro/prepared-fixture.json', import.meta.url)));
const facts = name => ({ name, manufacturer: 'Sample', speed: 5, glide: 4, turn: -1, fade: 1 });
const entries = (n = 3) => Array.from({ length: n }, (_, i) => { const d = fixture.discs[i % fixture.discs.length];
  return { id: `e${i}`, disc: { id: `${d.id}-${i}`, mold: d.mold, plastic: d.plastic ?? null, weight: null, depiction: { kind: 'photo', src: 'data:image/webp;base64,AAAA' } }, resolved: facts(d.name) }; });
const worldInputs = (plan, photos) => ({ preset: plan.preset, featured: plan.featured,
  cards: plan.cards.map((c, i) => { const { depiction, ...disc } = c.disc; return { disc, facts: c.resolved, design: c.design, photo: photos[i] }; }) });

test('for every lineup layout, featured or not, with per-disc accents, the world\'s lineup recipe is what the renderer draws, and its hash is the pixel key', () => {
  const world = createThroWorld(); let checked = 0;
  for (const study of lineupStudies) for (const highlight of [null, 'e1']) for (const n of [2, 3, 5]) {
    const material = { states: [{ highlight }], styles: { e2: { accent: '#ff4d6d', scale: 1 } } };
    const plan = nativeLineupPlan({ material, design: { study: study.id, accent: '#c8f23d' }, entries: entries(n) });
    const requests = plan.cards.map(card => nativeCardRequest(card)), photos = requests.map((_, i) => `photo-${i}`);
    const expected = lineupRequestRecipe(plan, requests, photos);
    const run = world.run('thro.lineup.recipe', worldInputs(plan, photos));
    assert.deepEqual(run.outputs.recipe, expected, `${study.id} featured ${highlight} n ${n}`);
    assert.equal(run.receipt.outputs.recipe, recipePartHash(expected), 'the lineup recipe Part hash is the renderer\'s pixel key');
    assert.equal(run.trace.calls.filter(c => c.contract === 'thro.card.recipe').length, n, 'one card recipe Part per disc');
    checked++;
  }
  assert.equal(checked, lineupStudies.length * 2 * 3);
});

test('changing one disc in a lineup recomputes only that disc\'s card recipe', () => {
  const world = createThroWorld(), material = { states: [{ highlight: null }], styles: {} };
  const plan = nativeLineupPlan({ material, design: { study: lineupStudies[0].id, accent: '#c8f23d' }, entries: entries(3) });
  const photos = ['p0', 'p1', 'p2'], first = world.run('thro.lineup.recipe', worldInputs(plan, photos));
  const changed = worldInputs(plan, photos); changed.cards[2].design = { ...changed.cards[2].design, accent: '#ff4d6d' };
  const before = world.stats().cacheHits, second = world.run('thro.lineup.recipe', changed);
  assert.equal(world.stats().cacheHits - before, 2, 'two of three card recipes are served from the cache');
  assert.notEqual(second.receipt.outputs.recipe, first.receipt.outputs.recipe);
});

test('the rule runs on every card of a lineup and names the failing one', () => {
  const world = createThroWorld(), ok = { photo: { w: 300 }, name: { size: 60 }, numbers: { size: 30 }, other: [] };
  const bad = { photo: { w: 300 }, name: { size: 60 }, numbers: { size: 30 }, other: [{ text: 'MVP', size: 40 }] };
  assert.equal(world.run('thro.lineup.rule', { layouts: [ok, ok, ok] }).outputs.accepted, true);
  const v = world.run('thro.lineup.rule', { layouts: [ok, bad, ok] }).outputs;
  assert.equal(v.accepted, false); assert.match(v.reason, /^Card 2: "MVP"/);
});
