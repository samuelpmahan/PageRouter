import test from 'node:test';
import assert from 'node:assert/strict';
import * as adapter from '../../vendor/discstudio-cards/thro-adapter.mjs';
import { anchoredDefaultPlacement, transformedBounds } from '../../vendor/discstudio-cards/transform-geometry.mjs';

const disc = Object.freeze({ id: 'physical-servo-1', mold: 'mvp--servo', name: 'Servo', manufacturer: 'MVP', file: './servo.webp' });
const footprint = Object.freeze({ width: 1920, height: 1080, alphaBounds: Object.freeze([50, 650, 700, 1030]) });

test('the mapper adds the catalog address once for an unprefixed mold', () => {
  assert.equal(adapter.cardFromThroDisc(disc).mold, 'ds.px.seed.mvp--servo');
});

test('the mapper preserves an already addressed mold without adding another prefix', () => {
  const card = adapter.cardFromThroDisc({ ...disc, mold: 'ds.px.seed.mvp--servo' });
  assert.equal(card.mold, 'ds.px.seed.mvp--servo');
  assert.equal(card.id, disc.id);
});

test('explicit unknown flights remain null while numeric strings and zero retain their values', () => {
  const flights = Object.freeze(['5', 5, null, 0]);
  const card = adapter.cardFromThroDisc(disc, { flights });
  assert.deepEqual(card.renderer.flights, [5, 5, null, 0]);
  assert.deepEqual(flights, ['5', 5, null, 0]);
});

test('undefined and blank flight values remain unknown without inventing zero', () => {
  for (const unknown of [null, undefined, '', '   ', '\t']) {
    const card = adapter.cardFromThroDisc(disc, { flights: [unknown, 0, '0', ' 5.5 '] });
    assert.deepEqual(card.renderer.flights, [null, 0, 0, 5.5]);
  }
});

test('nonfinite and invalid known flight values are rejected explicitly', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 'Infinity', 'unknown', false, {}]) {
    assert.throws(() => adapter.cardFromThroDisc(disc, { flights: [5, 5, invalid, 2] }), /flight/i);
  }
});

function resolve(placement, scale) {
  assert.equal(typeof adapter.resolveCardPlacement, 'function', 'the adapter exposes its actual placement resolver');
  return adapter.resolveCardPlacement(placement, footprint, scale);
}

test('omitting panel scale retains the exact native default transform', () => {
  assert.deepEqual(resolve('panel-default'), anchoredDefaultPlacement({ ...footprint, scale: 0.66 }));
});

test('a requested panel scale retains the existing native corner anchor', () => {
  const placement = resolve('panel-default', 0.9);
  assert.deepEqual(placement, anchoredDefaultPlacement({ ...footprint, scale: 0.9 }));
  const bounds = transformedBounds({ ...footprint, ...placement });
  assert.ok(Math.abs(bounds.left - footprint.alphaBounds[0]) < 1e-9);
  assert.ok(Math.abs(bounds.bottom - footprint.alphaBounds[3]) < 1e-9);
});

test('explicit placement and native placement keep their existing scale semantics', () => {
  const explicit = Object.freeze({ scale: 0.75, dx: -0.1, dy: 0.1 });
  assert.strictEqual(resolve(explicit, 1.4), explicit);
  assert.deepEqual(resolve('native', 1.4), { scale: 1, dx: 0, dy: 0 });
});

test('panel scale rejects nonfinite, nonnumeric and out-of-range values', () => {
  for (const scale of [NaN, Infinity, -Infinity, null, '0.9', 0.49, 1.51]) {
    assert.throws(() => resolve('panel-default', scale), /scale/i, `scale ${String(scale)} must be rejected`);
  }
  assert.equal(resolve('panel-default', 0.5).scale, 0.5);
  assert.equal(resolve('panel-default', 1.5).scale, 1.5);
});

test('invalid panel scale is rejected before browser image or Canvas work starts', async () => {
  await assert.rejects(adapter.renderDiscStudioCard({ disc, flights: [5, 5, null, 2], scale: 0.49 }), /scale/i);
});
