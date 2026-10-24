// The first Constraint Lab's parts and rules, in the card renderer (thro, 24 Oct 2026): B01 revision 2 draws from pinned parts and
// derives the rest. These check the rules themselves, the design field that carries the pins, and that nothing else changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveB01, B01_PARTS, solveB04, solveB05, CARD_RECIPES } from '../../vendor/discstudio-cards/thro-card-core-r2.js';
import { nativeDesign, nativeControlDesign, nativeCardRecipe, validParts, partsLayout, cardParts } from '../../experiences/thro/native-cards.mjs';

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
test('the design carries pins for B01 revision 2; a new layout or "follow the rules" lets them go', () => {
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

// ---- B04 and B05 (24 Oct): the first lab's rules for them. Starting values reproduce the fixed cards' own numbers.
test('B04, nothing pinned: plate 620 × 380, peak at 55% and 90 below the top, disc 280 seated 18 below the peak, tiles 62 at +194, name at +336', () => {
  const s = solveB04({}, width), g = s.geometry, y = g.plate.y;
  assert.deepEqual([g.plate.w, g.plate.h, g.arc.peakX - g.plate.x, g.arc.peakY - y, g.arc.tailY - y, g.disc.d, g.disc.cy + g.disc.d / 2 - g.arc.peakY, g.tiles.size, g.tiles.y - y, g.name.y - y],
    [620, 380, 341, 90, 175, 280, 18, 62, 194, 336]);
  assert.deepEqual([Math.round(g.arc.c0.x - g.plate.x), g.arc.c0.y - y, Math.round(g.arc.c1.x - g.plate.x), g.arc.c1.y - y], [186, 185, 484, 120]);
});
test('B04: moving the peak carries the disc with it; raising the arc makes the plate hug it', () => {
  const a = solveB04({}, width), b = solveB04({ peakAt: 0.3, arcRise: 160 }, width);
  assert.equal(b.geometry.disc.cx, b.geometry.plate.x + 0.3 * 620); assert.equal(b.derived.plateH - a.derived.plateH, 75);
  assert.equal(b.geometry.disc.cy + b.geometry.disc.d / 2 - b.geometry.arc.peakY, 18, 'still seated on the peak');
  assert.ok(b.geometry.arc.c0.x < b.geometry.arc.peakX && b.geometry.arc.c1.x > b.geometry.arc.peakX, 'the bends stay either side of the peak');
});
test('B04: the largest tile fits the starting plate; a narrow pinned plate holds the tile instead', () => {
  assert.equal(solveB04({ tile: 120 }, width).values.plateW, 620);
  const held = solveB04({ tile: 120, plateW: 400 }, width); assert.ok(held.values.tile < 120); assert.equal(held.state.tile, 'derived');
});
test('B05, nothing pinned: plate 600 × 380, disc 340 at +40/+130, tiles 58 at +36, zoom circle 120 at +388/+92, plastic at +252, name 96 at +336', () => {
  const s = solveB05({}, width), g = s.geometry, x = g.plate.x, y = g.plate.y;
  assert.deepEqual([g.plate.w, g.plate.h, g.disc.d, g.disc.cx - (x + g.plate.w), g.disc.cy - y, g.tiles.size, g.tiles.y - y, g.coin.d, g.coin.cx - x, g.coin.cy - y, g.plastic.y - y, g.name.y - y, g.name.lane, g.plastic.lane],
    [600, 380, 340, 40, 130, 58, 36, 120, 388, 92, 252, 336, 484, 380]);
  assert.deepEqual(s.msgs, []);
});
test('B05: a bigger disc crowds the row, so the zoom circle gives way first, then the tiles', () => {
  const s = solveB05({ discD: 440 }, width);
  assert.ok(s.values.coinD < 120 && s.state.coinD === 'derived'); assert.ok(s.msgs.some(([, m]) => /Zoom circle shrank/.test(m)));
  const pinnedCoin = solveB05({ discD: 440, coinD: 120 }, width);
  assert.equal(pinnedCoin.values.coinD, 120); assert.ok(pinnedCoin.values.plateW > 600, 'a pinned circle widens the plate instead');
});
test('the ranges the design checks are the renderer\'s own, for every layout drawn from parts', () => {
  for (const [layout, { parts }] of Object.entries(CARD_RECIPES))
    assert.deepEqual(cardParts[layout], Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, [p.min, p.max]])), layout);
});
test('B04 and B05 designs carry their own parts; another layout\'s part is refused', () => {
  const b04 = nativeDesign({ study: 'discstudio:u01', accent: '#c8f23d' }, 'discstudio:b04');
  assert.equal(partsLayout(b04), 'b04');
  assert.deepEqual(nativeControlDesign(b04, { study: 'discstudio:b04', parts: { peakAt: 0.4 } }).nativeParts, { peakAt: 0.4 });
  assert.equal(nativeControlDesign(b04, { study: 'discstudio:b04', parts: { coinD: 100 } }).nativeParts, undefined);
  const b05 = nativeDesign(b04, 'discstudio:b05');
  assert.deepEqual(nativeControlDesign(b05, { study: 'discstudio:b05', parts: { coinD: 100 } }).nativeParts, { coinD: 100 });
});
