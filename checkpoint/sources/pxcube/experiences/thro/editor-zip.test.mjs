import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipStore, unzipStore } from './editor-zip.mjs';

const text = s => new TextEncoder().encode(s);

test('crc32 matches the standard check value', () => assert.equal(crc32(text('123456789')), 0xcbf43926));

test('a zip round-trips its entries byte for byte, including empty files and non-ASCII names', () => {
  const entries = [{ name: 'a.png', data: Uint8Array.from([137, 80, 78, 71, 0, 255]) }, { name: 'sub/é.txt', data: text('héllo') }, { name: 'empty', data: new Uint8Array(0) }];
  const back = unzipStore(zipStore(entries));
  assert.deepEqual(back.map(e => e.name), entries.map(e => e.name));
  back.forEach((e, i) => assert.deepEqual([...e.data], [...entries[i].data]));
});

test('unsafe or repeated names are refused', () => {
  for (const name of ['/abs', '../up', 'a/../b', 'back\\slash', '']) assert.throws(() => zipStore([{ name, data: new Uint8Array(1) }]), /Unsafe/);
  assert.throws(() => zipStore([{ name: 'x', data: new Uint8Array(1) }, { name: 'x', data: new Uint8Array(1) }]), /named x/);
});

test('the system unzip accepts the archive and agrees on the contents', t => {
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { return t.skip('unzip is not installed'); }
  const dir = mkdtempSync(join(tmpdir(), 'editor-zip-')), file = join(dir, 'a.zip');
  writeFileSync(file, zipStore([{ name: 'one.bin', data: Uint8Array.from({ length: 5000 }, (_, i) => i % 251) }, { name: 'two.txt', data: text('two') }]));
  assert.match(execFileSync('unzip', ['-t', file]).toString(), /No errors detected/);
  assert.equal(execFileSync('unzip', ['-p', file, 'two.txt']).toString(), 'two');
});
