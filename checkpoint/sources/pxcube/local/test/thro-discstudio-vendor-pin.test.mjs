import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../vendor/discstudio-cards');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const native = Object.freeze({
  'mold-runtime-index.js': '4643b370e48d0e97f1b2fe9dbd31f5d259c85276c10bcde6ceef0f9bece2ce95',
  'browser-card-renderer.js': '67df9768ab74f63d27ea41aef17fefc39ab84627aa5175e2231ea45ccc539c35',
  'sticker-raster.mjs': '077b78dc9e031a4eb3d5022fdf4a4bad026d2e91470256e91c0a60aa7ac770b7',
  'card-renderer-core.js': '27f8876f3d387bcfa0e918079464a381256e247426a9d7573424831cec11cdc4',
  'mold-wildcard-trie.js': 'cd1b2ba424a65d0c0d23dbf136a4973a596bb7c563f231065eb259dc5c6aee1d',
  'transform-geometry.mjs': '82818c2b09bc12eb9caadce7b3c8c54fa37b970a8ed085215b3eaee47d00705b',
  'mold-runtime.bin': '03fd92167969f79398119f0917fb52c683908a9bcca25dba1615dabeae25c1fc',
  'export-queue-core.js': '51ffbd7f5bc7baa4f99d9a6e577c665e506aea4a70fc0e1e5a894ab2482fff49',
  'fonts/DEJAVU-LICENSE.txt': '63d3ba759d12804c5b31a9d5940d855c1820d1f5999e6b0872eb1c7ff045fbc9',
  'fonts/DejaVuSans.woff2': 'fc03bf96b7e8723d8cc022c17339b73b763277df3ad7217b1446d610d03dc1b6',
  'fonts/DejaVuSans-Bold.woff2': '31600fc95c6849491dce6edf920e2b9451235e21fdd3a6e89680ded846164a9e',
  'fonts/DejaVuSansCondensed-Bold.woff2': '74c79084c300ea189d2faf6a5b7488074646add2f67a0d368a7d1b6948b0a5e0',
  'mold-runtime-manifest.js': '2734659ddef0549d92c590e41dcff92398857a50fabcb80af3e11ed72479818e',
  'mold-library.js': 'fc37e74e6c70c1134fed11e595b01cef889b5fbe1f4821840c09f789bccea056',
  'frame-seek.mjs': '8cdfa3dc52a0f966262143b96f93f3cebae96eda2df56f67acacb6ae971e4625',
});

test('all fifteen upstream runtime, font and license files retain the verified handoff bytes', () => {
  for (const [relative, expected] of Object.entries(native)) {
    assert.equal(sha256(fs.readFileSync(path.join(root, relative))), expected, relative);
  }
});

test('source pin binds the upstream Git checkpoint, exact handoff and locally changed adapter', () => {
  const file = path.join(root, 'SOURCE-PIN.json');
  assert.ok(fs.existsSync(file), 'the vendored card closure requires a source-pin manifest');
  const pin = JSON.parse(fs.readFileSync(file));
  assert.equal(pin.upstream.commit, '885dca7cf8254d1a9e3f4ad656f459ff89df855d');
  assert.equal(pin.upstream.buildId, '28ac2b39fab85255');
  assert.equal(pin.handoff.sha256, 'f49a2a586732ba37ed689aa087b4e3593b3dd302ea9d55ffd7a471b345743139');
  assert.equal(pin.handoff.proofPage.sha256, 'e72d2c5672d257ba07365ff4c48e49117781d3cb45798c41ddfa350f4efca2c7');
  assert.deepEqual(Object.fromEntries(pin.nativeFiles.map(row => [row.path, row.sha256])), native);
  assert.equal(pin.adapter.upstreamSha256, '4594bf5f0a3f31aa16677e4b899f3bbd4b49ffe3e2c26c1f93b157d5197438be');
  assert.equal(pin.adapter.sha256, sha256(fs.readFileSync(path.join(root, 'thro-adapter.mjs'))));
  assert.notEqual(pin.adapter.sha256, pin.adapter.upstreamSha256);
});
