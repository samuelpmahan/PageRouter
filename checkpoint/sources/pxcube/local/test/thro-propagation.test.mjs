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

test('a change is told by features: layouts by name, and what follows from a layout said with it', () => {
  const world = createThroWorld();
  const b01 = screen(world, single({ study: 'discstudio:b01', nativeRevision: 2 }));
  const u04 = screen(world, single({ study: 'discstudio:u04', nativeRevision: 2 }));
  const diff = definitionDiff(recipeDefinition(b01.outputs.recipe), recipeDefinition(u04.outputs.recipe));
  assert.deepEqual(diff, ['layout: Hero rail → Kinetic name (and with it: disc side left, highlight tiles)'], 'layouts by name; what comes with a layout is said with it');
  const chosen = definitionDiff(recipeDefinition(b01.outputs.recipe), recipeDefinition(screen(world, single({ study: 'discstudio:b01', nativeRevision: 2, nativeSide: 'left' })).outputs.recipe));
  assert.deepEqual(chosen, ['disc side: right → left'], 'a side set by hand is a choice of its own');
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

test('the final cause is demonstrated, not asserted: what it is for, the premise, what this card does, thus', () => {
  const world = createThroWorld();
  const fine = guarantees(world, screen(world, single({ study: 'discstudio:b01', nativeRevision: 2 }))).find(g => g.cause === 'final');
  assert.ok(fine.ok);
  assert.match(fine.demonstration.for, /knows at a glance which disc/);
  assert.match(fine.demonstration.does, /disc photo 277 px, the name Servo 69 px, the numbers 6\.5 · 5 · −1 · 2 29 px/);
  assert.match(fine.demonstration.thus, /sees the disc, then Servo, then 6\.5 · 5 · −1 · 2/);
  assert.ok(!/Sam's rule:/.test(fine.what), 'the rule is not the reason');
  const u04 = { photo: { w: 238 }, name: { size: 74 }, numbers: { size: 29 }, other: [{ text: 'MVP', size: 34 }] };
  const loud = guarantees(world, screen(world, single({ study: 'discstudio:u04' }, u04))).find(g => g.cause === 'final');
  assert.equal(loud.ok, false);
  assert.match(loud.demonstration.thus, /"MVP" \(34 px\) is read before the flight numbers \(29 px\)/);
  const tilted = guarantees(world, screen(world, single({ study: 'discstudio:b01' }, { ...upright, photo: { w: 277, angle: 12 } }))).find(g => g.cause === 'final');
  assert.match(tilted.demonstration.thus, /turned 12°, so the face a viewer recognises it by is not upright/);
});
