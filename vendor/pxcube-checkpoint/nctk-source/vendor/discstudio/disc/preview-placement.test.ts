import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPreviewPlacement, rescalePreviewPlacement } from './export-ui.ts';

const frame = { width: 1080, height: 1920 };
const bounds = [190, 260, 890, 1660];

test('checking a Bag disc can render repeatedly from a frozen placement', () => {
  const saved = Object.freeze({ scale: 1, dx: 0, dy: 0 });
  const first = fitPreviewPlacement(saved, frame, bounds, 1.1);
  const again = fitPreviewPlacement(first, frame, bounds, 1.1);
  assert.deepEqual(again, first);
  assert.equal(Object.isFrozen(first), false);
  assert.deepEqual(saved, { scale: 1, dx: 0, dy: 0 });
});

test('size slider changes a previously frozen placement without mutating it', () => {
  const placed = Object.freeze({ scale: 1, dx: .04, dy: -.02 });
  const resized = rescalePreviewPlacement(placed, 1.2, 1.1, frame, bounds);
  assert.equal(resized.scale, 1.1);
  assert.equal(placed.scale, 1);
  assert.equal(Object.isFrozen(resized), false);
  assert.deepEqual(fitPreviewPlacement(resized, frame, bounds, 1.1), resized);
});
