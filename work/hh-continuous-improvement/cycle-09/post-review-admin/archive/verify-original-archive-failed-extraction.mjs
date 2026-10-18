import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir} from 'node:fs/promises';
import {join, resolve, relative, sep} from 'node:path';

const archive = resolve(process.argv[2] || '');
const restore = resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) throw new Error('usage: verify-original-archive.mjs <archive.tar.zst> <new-restore-directory>');
const manifestExpected = '9cd5ba3824b50ebc064f361d6998c60c2024c562943ea7ab86d22237ae67dc42';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const tarList = execFileSync('tar', ['--zstd', '-tf', archive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
const archiveEntries = tarList.trimEnd().split('\n').filter(Boolean).map(raw => {
  const withoutPrefix = raw.replace(/^\.\//, '');
  return {path: withoutPrefix.replace(/\/$/, ''), directory: withoutPrefix.endsWith('/')};
}).filter(entry => entry.path);
for (const {path: name} of archiveEntries) {
  if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe archive path: ${name}`);
}
const entryKeys = archiveEntries.map(entry => `${entry.directory ? 'd' : 'f'}:${entry.path}`);
if (new Set(entryKeys).size !== entryKeys.length) throw new Error('archive contains duplicate paths');
await mkdir(restore, {recursive: false});
execFileSync('tar', ['--zstd', '-xf', archive, '-C', restore], {stdio: 'inherit'});

const manifestPath = join(restore, 'evidence', 'manifest.json');
const manifestBytes = await readFile(manifestPath);
if (sha256(manifestBytes) !== manifestExpected) throw new Error('restored original manifest hash mismatch');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.manifestSelfHash !== 'omitted') throw new Error('unexpected self-hash field');
const expected = Object.keys(manifest.files).sort();
if (expected.length !== 112 || manifest.fileCountExcludingManifest !== 112) throw new Error('expected original 112 manifest entries');
const actual = [];
async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) await walk(abs);
    else if (entry.isFile()) {
      const path = relative(restore, abs).split(sep).join('/');
      if (path !== 'evidence/manifest.json') actual.push(path);
    } else throw new Error(`unsupported restored filesystem entry: ${abs}`);
  }
}
await walk(restore);
actual.sort();
const archiveRegularFiles = archiveEntries.filter(entry => !entry.directory).map(entry => entry.path).sort();
const expectedArchive = [...expected, 'evidence/manifest.json'].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('restored regular-file path set differs from old manifest');
if (JSON.stringify(archiveRegularFiles) !== JSON.stringify(expectedArchive)) throw new Error('archive path set differs from old manifest plus manifest itself');
const mismatches = [];
for (const path of expected) {
  const actualHash = sha256(await readFile(join(restore, path)));
  if (actualHash !== manifest.files[path]) mismatches.push({path, expected: manifest.files[path], actual: actualHash});
}
if (mismatches.length) throw new Error(`old manifest byte verification failed: ${JSON.stringify(mismatches)}`);
console.log(JSON.stringify({verified: true, archivedRegularFiles: archiveRegularFiles.length, manifestEntries: expected.length,
  manifestSha256: sha256(manifestBytes), mismatches: 0, restoredFromArchive: archive, restoreDirectory: restore}, null, 2));
