import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, scenarioUrl, scenarioMatrix } from '../../launcher/scenario-loader.mjs';
test('scenario conveyor has required representative states', () => {
  assert.deepEqual(SCENARIOS.map(s => s.id), ['empty', 'minimal', 'typical', 'dense', 'mobile', 'resumed']);
});
test('scenario URL is opt-in and test-run scoped', () => {
  assert.equal(scenarioUrl('./index.html', null, 'http://x/a'), '/index.html');
  assert.equal(scenarioUrl('./index.html', 'typical', 'http://x/a'), '/index.html?scenario=typical&testRun=1');
  assert.equal(scenarioUrl('./index.html', 'bogus', 'http://x/a'), '/index.html');
});
test('matrix gives every Experience the same conveyor stages', () => {
  const rows = scenarioMatrix(['hello', 'your-shelf']);
  assert.equal(rows.length, 12);
  assert.ok(rows.every(row => row.stages.join(',') === 'load,implementation,browser-test,human-test'));
});
