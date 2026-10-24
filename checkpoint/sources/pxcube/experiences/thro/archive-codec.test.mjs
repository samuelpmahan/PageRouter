import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createArchiveCodec, MAX_ARCHIVE_BYTES } from './archive-codec.mjs';

const prefix = 'thro-interned@1:';
const identity = async value => value;
const plain = () => createArchiveCodec({ pack: identity, unpack: identity });
const invalid = error => error.code === 'THRO_ARCHIVE_INVALID';
const envelope = value => prefix + JSON.stringify(value);
async function gzipPack(raw) {
  const bytes = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return 'native-gzip@1:' + Buffer.from(bytes).toString('base64');
}
async function gzipUnpack(packed) {
  if (!packed.startsWith('native-gzip@1:')) return packed;
  const bytes = Buffer.from(packed.slice('native-gzip@1:'.length), 'base64');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

test('preserves exact whitespace, Unicode, quoted escapes and repeated long tokens', async () => {
  const token = JSON.stringify(('Snowman ☃ / rocket 🚀 / \n / quote " / slash \\ / literal \\u0061 / tab\t').repeat(30));
  const raw = ` \r\n{ "first" : ${token},\t"second":${token}, "escaped":"\\u0061\\n\\t\\\\\\\"" }\n\t`;
  const codec = plain(), packed = await codec.packArchive(raw);
  assert.equal(await codec.unpackArchive(packed), raw);
  assert.deepEqual(Buffer.from(await codec.unpackArchive(packed)), Buffer.from(raw));
  const contents = JSON.parse(packed.slice(prefix.length));
  assert.deepEqual(contents.dictionary, [token]);
  assert.equal(contents.segments.filter(value => value === 0).length, 2);
});

test('does not reinterpret raw dictionary, segment or prototype-looking object fields', async () => {
  const token = JSON.stringify('thro-interned@1: dictionary segments __proto__ '.repeat(30));
  const raw = `{"dictionary":[0,"literal"],"segments":{"ref":0},"__proto__":{"x":1},"a":${token},"b":${token}}`;
  const codec = plain();
  assert.equal(await codec.unpackArchive(await codec.packArchive(raw)), raw);
  assert.equal({}.x, undefined);
});

test('leaves unique long tokens and short repeated strings in literal segments', async () => {
  const token = JSON.stringify('unique'.repeat(200)), raw = `{"a":${token},"b":"short","c":"short"}`;
  const codec = plain(), packed = await codec.packArchive(raw), contents = JSON.parse(packed.slice(prefix.length));
  assert.deepEqual(contents.dictionary, []);
  assert.equal(await codec.unpackArchive(packed), raw);
});

test('legacy gzip and plain archives use the injected unpack unchanged', async () => {
  const raw = ' \n{"photo":"old archive","unicode":"🐉"}\t';
  const codec = createArchiveCodec({ pack: gzipPack, unpack: gzipUnpack });
  assert.equal(await codec.unpackArchive(await gzipPack(raw)), raw);
  assert.equal(await codec.unpackArchive(raw), raw);
  assert.equal(await codec.unpackArchive(null), null);
});

test('rejects malformed container shapes and unsafe references before reconstruction', async () => {
  const codec = plain();
  for (const value of [
    null, [], { version: 2, dictionary: [], segments: [''] },
    { version: 1, dictionary: 'wrong', segments: [''] },
    { version: 1, dictionary: [42], segments: [''] },
    { version: 1, dictionary: ['not a quoted token'], segments: [''] },
    { version: 1, dictionary: ['"ok"trailing'], segments: [''] },
    { version: 1, dictionary: [], segments: [0] },
    { version: 1, dictionary: ['"ok"'], segments: [-1] },
    { version: 1, dictionary: ['"ok"'], segments: [0.5] },
    { version: 1, dictionary: ['"ok"'], segments: [1] },
    { version: 1, dictionary: [], segments: [null] },
    { version: 1, dictionary: [], segments: [{}] },
    { version: 1, dictionary: [], segments: 'wrong' },
  ]) await assert.rejects(codec.unpackArchive(envelope(value)), invalid);
  await assert.rejects(codec.unpackArchive(prefix + '{broken'), invalid);
});

test('input over 64MiB rejects before calling the gzip packer', async () => {
  let calls = 0;
  const codec = createArchiveCodec({ pack: async raw => { calls++; return raw; }, unpack: identity });
  await assert.rejects(codec.packArchive('x'.repeat(MAX_ARCHIVE_BYTES + 1)), error => error.code === 'THRO_ARCHIVE_TOO_LARGE');
  assert.equal(calls, 0);
});

test('reference expansion over 64MiB rejects before joining the archive', async () => {
  const codec = plain(), token = JSON.stringify('x'.repeat(1022));
  const segments = Array(Math.floor(MAX_ARCHIVE_BYTES / token.length) + 1).fill(0);
  await assert.rejects(codec.unpackArchive(envelope({ version: 1, dictionary: [token], segments })), error => error.code === 'THRO_ARCHIVE_TOO_LARGE');
});

test('native gzip compresses repeated actual prepared photo tokens without dropping bytes', async () => {
  const bytes = fs.readFileSync(new URL('./assets/discs/sample-servo.webp', import.meta.url));
  const photo = `data:image/webp;base64,${bytes.toString('base64')}`;
  const quoted = JSON.stringify(photo);
  const raw = '{\n' + Array.from({ length: 24 }, (_, i) => `  "photo-${i}":${quoted}`).join(',\n') + '\n}\n';
  const codec = createArchiveCodec({ pack: gzipPack, unpack: gzipUnpack });
  const legacy = await gzipPack(raw), packed = await codec.packArchive(raw);
  assert.equal(await codec.unpackArchive(packed), raw);
  assert.ok(packed.length < legacy.length / 4, 'interning must materially reduce the repeated real-photo fixture');
  console.log(JSON.stringify({ fixture: 'sample-servo.webp repeated 24 times', rawCharacters: raw.length,
    legacyGzipCharacters: legacy.length, internedGzipCharacters: packed.length, ratio: packed.length / legacy.length }));
});

// 24 Oct 2026: packArchive scans the raw text once instead of twice. The gauge for that re-implementation: the same input packs to
// exactly the bytes the two-scan version produced (its SHA-256 below was computed with it), and still round-trips.
test('one-scan packArchive packs byte-identically to the two-scan version it replaced', async () => {
  const { createHash } = await import('node:crypto');
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const word = n => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789+/'[Math.floor(rnd() * 44)]).join('');
  const pool = Array.from({ length: 9 }, (_, i) => word(300 + i * 211) + (i % 3 ? '' : '\\"esc\\\\aped'));
  const raw = JSON.stringify({ parts: Array.from({ length: 240 }, (_, i) => ({ i, v: pool[Math.floor(rnd() * pool.length)], w: i % 7 ? null : word(40) })) }, null, 1);
  assert.equal(raw.length, 291668);
  const packed = await plain().packArchive(raw);
  assert.equal(createHash('sha256').update(packed).digest('hex'), 'c85400fbcaeaca88b87fc5a07f8104eb0adb4fd6b346e0846520ee7e45fdc48f');
  assert.equal(await plain().unpackArchive(packed), raw);
});
