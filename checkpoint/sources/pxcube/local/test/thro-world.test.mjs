// thro as a PxC world: the site is one run of 'thro.site' under a fill; each decision is a contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThroWorld, decide, SITE_FILL, OPEN, hierarchyVerdict } from '../../experiences/thro/thro-world.mjs';

test('the site runs under its fill and says what each mode offers', () => {
  const { site, choices, receipt } = decide(createThroWorld());
  assert.deepEqual(site, { single: 'cards', bag: 'lineups', battle: 'layouts', revision: 2 });
  assert.equal(choices['thro.single.layouts'].rung, 'contract fill', 'a decided choice comes from the fill');
  assert.equal(choices['thro.card.revision'].rung, 'contract fill', 'two card revisions: the fill decides');
  assert.deepEqual(Object.keys(receipt.fillReach).sort(), Object.keys(SITE_FILL).sort());
});

test('with no fill, a decision with two alternatives is AMBIGUOUS: open, in the kernel\'s own words', () => {
  assert.throws(() => createThroWorld().run('thro.site', {}, {}), e => e.code === 'AMBIGUOUS');
});

test('switching an alternative changes only that decision', () => {
  const { site } = decide(createThroWorld(), { ...SITE_FILL, 'thro.battle.engine': 'thro.battle.engine/formats' });
  assert.deepEqual(site, { single: 'cards', bag: 'lineups', battle: 'formats', revision: 2 });
});

test("Sam's rule is a check contract proven by real measurements", () => {
  const world = createThroWorld(), proofs = world.prove('thro.rule');
  assert.ok(proofs.length === 7 && proofs.every(p => p.ok), proofs.map(p => p.detail).join('; '));
  assert.match(hierarchyVerdict({ photo: { w: 277, angle: 12 }, name: { size: 69 }, numbers: { size: 29 }, other: [] }).reason, /rotated 12°/);
  assert.match(hierarchyVerdict({ photo: { w: 238 }, name: { size: 57 }, numbers: { size: 22 }, other: [{ text: 'MVP', size: 25 }] }).reason, /"MVP".*bigger than the flight numbers/);
});

test('every open decision names who it waits on, and every subsumed alternative names what subsumed it', () => {
  const world = createThroWorld();
  for (const [id, who] of Object.entries(OPEN)) { assert.ok(world.contracts().some(c => c.id === id), id); assert.ok(who.length > 10); }
  for (const impl of world.implementations()) if (impl.origin?.subsumedBy) assert.ok(world.implementations().some(i => i.id === impl.origin.subsumedBy), impl.id);
});
