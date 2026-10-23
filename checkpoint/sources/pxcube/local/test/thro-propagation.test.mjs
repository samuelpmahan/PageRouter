// Rung 4: what a change did in the world. A change is told by the card's definition (its named features), never by a hash;
// what it recomputed and reused comes from the run's trace; what is on screen carries the four guarantees (the four causes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThroWorld, screen, propagation, guarantees, recipeDefinition, definitionDiff } from '../../experiences/thro/thro-world.mjs';
import { nativeBuild } from '../../experiences/thro/native-cards.mjs';

const photo = 'b720aca1a38562e5ccba1e1ea5f82d4429d790fde1a983fad2b773b7b0c5ef2e';
const servo = { id: 'sample-servo', mold: 'mvp--servo', plastic: 'Neutron', weight: null };
const facts = { name: 'Servo', manufacturer: 'MVP', speed: 6.5, glide: 5, turn: -1, fade: 2 };
const upright = { photo: { w: 277, angle: 0 }, name: { size: 69 }, numbers: { size: 29 }, other: [{ text: 'Neutron', size: 22 }] };
const single = (design, layout = upright) => ({ disc: servo, facts, design: { rendererBuild: nativeBuild, ...design }, photo, layout });
const read = run => propagation(run.receipt).map(n => `${n.cached ? 'reused' : 'computed'} ${n.contract}${n.slot ? `#${n.slot}` : ''}`);

test('an accent change recomputes only the card recipe; going back to an earlier accent reuses the whole run', () => {
  const world = createThroWorld();
  const first = screen(world, single({ study: 'discstudio:b01', accent: '#c8f23d', nativeRevision: 2 }));
  assert.ok(read(first).every(line => line.startsWith('computed')));
  const red = screen(world, single({ study: 'discstudio:b01', accent: '#e4572e', nativeRevision: 2 }));
  assert.deepEqual(read(red), ['reused thro.site', 'computed thro.card.recipe', 'reused thro.rule']);
  assert.deepEqual(definitionDiff(recipeDefinition(first.outputs.recipe), recipeDefinition(red.outputs.recipe)), ['accent: #c8f23d → #e4572e']);
  const back = screen(world, single({ study: 'discstudio:b01', accent: '#c8f23d', nativeRevision: 2 }));
  const [whole] = propagation(back.receipt);
  assert.equal(whole.whole, true);
  assert.equal(whole.cachedFrom.run, first.receipt.runId);
  assert.equal(back.recipeHash, first.recipeHash);
});

test('a change is told by features, and a layout change names every feature it moved', () => {
  const world = createThroWorld();
  const b01 = screen(world, single({ study: 'discstudio:b01', nativeRevision: 2 }));
  const u04 = screen(world, single({ study: 'discstudio:u04', nativeRevision: 2 }));
  const diff = definitionDiff(recipeDefinition(b01.outputs.recipe), recipeDefinition(u04.outputs.recipe));
  assert.ok(diff.includes('layout: B01 → U04'));
  assert.ok(diff.includes('disc side: right → left'));
  assert.ok(!diff.some(line => /[0-9a-f]{16}/.test(line)), 'no hash in what a change says');
});

test('a lineup: the same change on every card is said once, a disc swap names its card, and only that card recipe recomputes', () => {
  const world = createThroWorld();
  const card = (disc, name) => ({ disc: { ...servo, id: disc }, facts: { ...facts, name }, design: { rendererBuild: nativeBuild, study: 'discstudio:b01', accent: '#c8f23d' }, photo });
  const lineup = (cards, accent) => ({ preset: 'l01', featured: null, layouts: cards.map(() => upright), cards: cards.map(c => ({ ...c, design: { ...c.design, ...(accent ? { accent } : {}) } })) });
  const a = screen(world, lineup([card('a', 'Servo'), card('b', 'Buzzz'), card('c', 'Roc3')]));
  const swapped = screen(world, lineup([card('a', 'Servo'), card('d', 'Wraith'), card('c', 'Roc3')]));
  assert.deepEqual(read(swapped).filter(l => l.includes('card.recipe')), ['reused thro.card.recipe#card0', 'computed thro.card.recipe#card1', 'reused thro.card.recipe#card2']);
  assert.deepEqual(definitionDiff(recipeDefinition(a.outputs.recipe), recipeDefinition(swapped.outputs.recipe)), ['disc (card 2): MVP Buzzz, Neutron → MVP Wraith, Neutron']);
  const red = screen(world, lineup([card('a', 'Servo'), card('d', 'Wraith'), card('c', 'Roc3')], '#e4572e'));
  assert.deepEqual(definitionDiff(recipeDefinition(swapped.outputs.recipe), recipeDefinition(red.outputs.recipe)), ['accent (cards 1, 2, 3): #c8f23d → #e4572e']);
});

test('the four guarantees: a card saved before the fix fails the efficient one, and a lineup says it cannot tell yet', () => {
  const world = createThroWorld();
  const fresh = guarantees(world, screen(world, single({ study: 'discstudio:u04', nativeRevision: 2 })));
  assert.deepEqual(fresh.map(g => g.cause), ['material', 'formal', 'efficient', 'final']);
  assert.ok(fresh.every(g => g.ok === true));
  const saved = guarantees(world, screen(world, single({ study: 'discstudio:u04' }))).find(g => g.cause === 'efficient');
  assert.equal(saved.ok, false);
  assert.match(saved.what, /revision 1; the site now draws revision 2/);
  const card = { disc: servo, facts, design: { rendererBuild: nativeBuild, study: 'discstudio:b01' }, photo };
  const lineup = guarantees(world, screen(world, { preset: 'l01', featured: null, layouts: [upright, upright], cards: [card, { ...card, disc: { ...servo, id: 'b' } }] }));
  assert.equal(lineup.find(g => g.cause === 'efficient').ok, null);
});
