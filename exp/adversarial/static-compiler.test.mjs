import test from 'node:test';
import assert from 'node:assert/strict';
import { staticSpec } from '../../src/static-compiler.mjs';
import { buildSnapshot } from '../../src/compiled-patch.mjs';

test('static source compiler uses explicit relative asset graph and copies source bytes literally', async () => {
  const sources = {
    'index.html': '<!doctype html><link rel="stylesheet" href="css/site.css"><script type="module" src="app.mjs"></script>',
    'app.mjs': "import './lib/view.mjs'; console.log('static app');",
    'lib/view.mjs': 'export const view = 1;',
    'css/site.css': 'body { color: black }',
    'external.html': '<script>globalThis.__attack = true</script>',
  };
  const spec = staticSpec('fixture-site', sources);
  const app = spec.targets.find(t=>t.id==='file:app.mjs');
  const html = spec.targets.find(t=>t.id==='file:index.html');
  assert.deepEqual(app.dependencies, ['file:lib/view.mjs']);
  assert.deepEqual(html.dependencies, ['file:app.mjs', 'file:css/site.css']);
  const snap=await buildSnapshot(spec);
  assert.equal(Buffer.from(snap.files['external.html'].data,'base64').toString(),sources['external.html']);
  assert.equal(Buffer.from(snap.files['app.mjs'].data,'base64').toString(),sources['app.mjs']);
  assert.ok(!Object.values(snap.files).some(f=>Buffer.from(f.data,'base64').toString().includes('globalThis.__attack')) === false);
});

test('relative link traversal is not mistaken for an in-project dependency', () => {
  const spec = staticSpec('fixture', {
    'index.html': '<a href="../outside.html">external</a><script src="%2e%2e/evil.mjs"></script><img src="/root.png">',
  });
  assert.deepEqual(spec.targets[0].dependencies, []);
});
