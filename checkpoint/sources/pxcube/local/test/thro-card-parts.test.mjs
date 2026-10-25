// The first Constraint Lab's parts and rules, in the card renderer (thro, 24 Oct 2026): B01 revision 2 draws from pinned parts and
// derives the rest. These check the rules themselves, the design field that carries the pins, and that nothing else changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveB01, B01_PARTS } from '../../vendor/discstudio-cards/thro-card-core-r2.js';
import { nativeDesign, nativeControlDesign, nativeCardRecipe, validParts, partsLayout } from '../../experiences/thro/native-cards.mjs';

const width = px => px * 3.9; // a name about as wide as SERVO in the condensed display face
test('nothing pinned: the starting values are the fixed card (plate 620 × 330, disc 420 on the corner +40/−60, tiles 74)', () => {
  const s = solveB01({}, width);
  assert.deepEqual([s.geometry.plate.w, s.geometry.plate.h, s.geometry.disc.d, s.values.tile], [620, 330, 420, 74]);
  assert.deepEqual([s.geometry.disc.cx - (s.geometry.plate.x + s.geometry.plate.w), Math.round(s.geometry.disc.cy - s.geometry.plate.y)], [40, -60]);
  assert.ok(Object.values(s.state).every(v => v === 'default'));
});
test('a wider plate carries the disc out on its corner; nothing else is pinned', () => {
  const a = solveB01({}, width), b = solveB01({ plateW: 900 }, width);
  assert.equal(b.geometry.disc.cx - a.geometry.disc.cx, 280);
  assert.equal(b.state.plateW, 'pinned'); assert.equal(b.state.discD, 'default');
});
test('bigger numbers make the plate hug them: taller, never clipped', () => {
  const a = solveB01({}, width), b = solveB01({ tile: 100 }, width);
  assert.equal(b.values.tile, 100); assert.equal(b.derived.plateH - a.derived.plateH, 26);
});
test('a name too long for its lane is set smaller, and says so', () => {
  const s = solveB01({ nameMax: 180 }, px => px * 12);
  assert.ok(s.derived.namePx < 180); assert.ok(s.msgs.some(([, m]) => /Name set at/.test(m)));
});
test('pins out of range are held to the part\'s range', () => {
  const s = solveB01({ discD: 5000, plateW: 10 }, width);
  assert.equal(s.values.discD, B01_PARTS.discD.max); assert.equal(s.values.plateW, B01_PARTS.plateW.min);
});
test('the design carries pins for B01 revision 2 only; a new layout or "follow the rules" lets them go', () => {
  const b01 = nativeDesign({ study: 'discstudio:u01', accent: '#c8f23d' }, 'discstudio:b01');
  assert.equal(partsLayout(b01), 'b01');
  const pinned = nativeControlDesign(b01, { study: 'discstudio:b01', parts: { plateW: 800 } });
  assert.deepEqual(pinned.nativeParts, { plateW: 800 });
  assert.deepEqual(nativeControlDesign(pinned, { study: 'discstudio:b01', parts: {} }).nativeParts, undefined);
  assert.equal(nativeDesign(pinned, 'discstudio:b02').nativeParts, undefined);
  assert.equal(nativeControlDesign(pinned, { study: 'discstudio:b01', parts: { plateW: 99999 } }).nativeParts, undefined, 'out of range is refused');
  assert.equal(validParts({ wings: 3 }, 'b01'), false);
  const disc = { id: 'd', mold: 'm', plastic: null, weight: null }, resolved = { name: 'Servo', manufacturer: 'MVP', speed: 6.5, glide: 5, turn: -1, fade: 2 };
  assert.deepEqual(nativeCardRecipe({ disc, resolved, design: pinned }).parts, { plateW: 800 });
  assert.equal('parts' in nativeCardRecipe({ disc, resolved, design: b01 }), false, 'no pins: the recipe is exactly as before');
});
// ---- Wide ranges and one row (Sam, 24 Oct 20:39: "a thin black box with text on the left and disc on the right that's the entire width").
test('one row: a full-width bar with the disc inside its right end, the name then the tiles on one line', () => {
  const s = solveB01({ row: 1, plateW: 1824, discD: 120, discOX: -0.6, discOY: 0.5, nameMax: 80, tile: 56 }, width), g = s.geometry;
  assert.equal(g.plate.w, 1824); assert.ok(g.plate.h < 120, `thin: ${g.plate.h}px`);
  assert.equal(g.plastic, undefined, 'one row leaves the plastic line out');
  assert.ok(g.tiles.x > g.name.x && Math.abs((g.tiles.y + g.tiles.size / 2) - (g.plate.y + g.plate.h / 2)) <= 1, 'tiles after the name, centred on the bar');
  assert.ok(g.disc.cx + g.disc.d / 2 <= g.plate.x + g.plate.w + 1, 'disc inside the bar');
  assert.ok(g.scrim.x + g.scrim.w <= 1920 - 48, 'the panel stops at the frame margin');
});
test('stacked is still the 6.6.1 card when nothing is pinned, and row 0 is the same as no row', () => {
  assert.deepEqual(solveB01({ row: 0 }, width).geometry, solveB01({}, width).geometry);
});
test('the design accepts the wide ranges and a whole-number row only', () => {
  assert.equal(validParts({ plateW: 1824, row: 1, discOX: -1.5 }, 'b01'), true);
  assert.equal(validParts({ row: 0.5 }, 'b01'), false);
});
