// E2E: Hello THING. The first light: the packaged experience exists in the
// assembled site, its entry renders the expected title, and the launcher
// cards it with the sandbox flags from its manifest. No browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sitePath } from './e2e-site.mjs';

const read = (...parts) => fs.readFileSync(sitePath(...parts), 'utf8');

test('hello THING ships an entry that renders its title', () => {
  const html = read('experiences', 'hello', 'index.html');
  assert.match(html, /<title>Hello THING/);
  assert.match(html, /Hello THING/);
});

test('launcher cards hello with the manifest sandbox flags', () => {
  const launcher = read('index.html');
  const card = launcher.match(/<button[^>]*data-id="hello"[^>]*>/);
  assert.ok(card, 'launcher has a hello card');
  assert.match(card[0], /data-sandbox="allow-scripts"/);
});

test('hello receipt verifies against its shipped chunks', async () => {
  const { createHash } = await import('node:crypto');
  const receipt = JSON.parse(read('experiences', 'hello', 'pxcube-receipt.json'));
  for (const chunk of receipt.chunks) {
    const bytes = fs.readFileSync(sitePath('experiences', 'hello', chunk.path));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, chunk.sha256, `chunk ${chunk.path} matches its receipt`);
  }
});
