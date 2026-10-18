import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const archive = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: verify-original-archive-stream.mjs <archive.tar.zst>');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tarList = execFileSync('tar', ['--zstd', '-tf', archive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
const members = tarList.trimEnd().split('\n').filter(Boolean).map(raw => {
  const withoutPrefix = raw.replace(/^\.\//, '');
  return {raw, path: withoutPrefix.replace(/\/$/, ''), directory: withoutPrefix.endsWith('/')};
}).filter(entry => entry.path);
for (const {path} of members) {
  if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe archive path: ${path}`);
}
const memberKeys = members.map(entry => `${entry.directory ? 'd' : 'f'}:${entry.path}`);
if (new Set(memberKeys).size !== memberKeys.length) throw new Error('archive contains duplicate members');
const files = members.filter(entry => !entry.directory);
const manifestMember = files.find(entry => entry.path === 'evidence/manifest.json');
if (!manifestMember) throw new Error('archive has no original manifest');
const manifestBytes = execFileSync('tar', ['--zstd', '-xOf', archive, manifestMember.raw], {maxBuffer: 4 * 1024 * 1024});
const manifestSha256 = sha256(manifestBytes);
if (manifestSha256 !== '9cd5ba3824b50ebc064f361d6998c60c2024c562943ea7ab86d22237ae67dc42') throw new Error('original manifest hash mismatch');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const expected = Object.keys(manifest.files).sort();
if (expected.length !== 112 || manifest.fileCountExcludingManifest !== 112) throw new Error('expected original 112 manifest entries');
const expectedArchiveFiles = [...expected, 'evidence/manifest.json'].sort();
const actualArchiveFiles = files.map(entry => entry.path).sort();
if (JSON.stringify(actualArchiveFiles) !== JSON.stringify(expectedArchiveFiles)) throw new Error('archive regular-file set differs from the exact old manifest plus itself');
const mismatches = [];
let verifiedBytes = manifestBytes.length;
for (const path of expected) {
  const entry = files.find(candidate => candidate.path === path);
  const bytes = execFileSync('tar', ['--zstd', '-xOf', archive, entry.raw], {maxBuffer: 20 * 1024 * 1024});
  verifiedBytes += bytes.length;
  const actual = sha256(bytes);
  if (actual !== manifest.files[path]) mismatches.push({path, expected: manifest.files[path], actual, bytes: bytes.length});
}
if (mismatches.length) throw new Error(`old manifest archive-byte verification failed: ${JSON.stringify(mismatches)}`);
console.log(JSON.stringify({verified: true, method: 'tar member bytes streamed to memory; no extraction or permission changes',
  archivedRegularFiles: actualArchiveFiles.length, manifestEntries: expected.length, verifiedBytes,
  manifestSha256, mismatches: 0, archive}, null, 2));
