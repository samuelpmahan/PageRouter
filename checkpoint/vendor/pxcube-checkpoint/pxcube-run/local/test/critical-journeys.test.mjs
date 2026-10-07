import assert from 'node:assert/strict';
import test from 'node:test';
import { root } from '../run.mjs';
import { criticalJourneyPlans, requiredViewports } from '../critical-journeys.mjs';

test('every declared critical journey has executable desktop and mobile release steps', () => {
  const plans = criticalJourneyPlans(root);
  assert.ok(plans.length > 0, 'the release gate needs at least one declared journey');
  for (const { journey } of plans) {
    assert.deepEqual(journey.viewports.slice().sort(), Object.keys(requiredViewports).sort());
  }
});
