import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('experiences/your-shelf/experience.json', 'utf8'));
const host = fs.readFileSync('local/studio-sandbox/host.mjs', 'utf8');

test('Your Shelf selects its composed Studio journey mode', () => {
  assert.equal(manifest.id, 'your-shelf');
  assert.equal(manifest.studio.mode, 'your-shelf');
  assert.match(host, /config\.mode === 'your-shelf'/);
  assert.match(host, /Your collection · browse and bag/);
  assert.match(host, /Add \/ import disc · live Parts/);
  assert.match(host, /Inspect Parts · live/);
});
