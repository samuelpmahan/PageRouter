#!/usr/bin/env node
// Apply only the six reviewed source paths. Full snapshot hashes remain in the private bundle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const argv = process.argv.slice(2);
if (argv.length !== 4 || argv[0] !== '--source' || argv[2] !== '--bundle')
  throw new Error('Usage: node apply-source-update.mjs --source D:/t-t-1 --bundle <extracted corrected bundle>');
const source = path.resolve(argv[1]), bundle = path.resolve(argv[3]);
const metadata = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'source-manifest.json'), 'utf8'));
const manifestBytes = fs.readFileSync(path.join(bundle, 'APPLY-MANIFEST.json'));
if (sha(manifestBytes) !== metadata.privateApplyManifestSha256) throw new Error('Private apply manifest hash mismatch');
const manifest = JSON.parse(manifestBytes);
if (manifest.schema !== 'policybench-source-apply@1') throw new Error('Unsupported private apply manifest');
function safeFile(root, relative) {
  if (!relative || relative.includes('\\') || relative.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(relative))
    throw new Error('Unsafe manifest path');
  let file = root;
  for (const segment of relative.split('/')) {
    file = path.join(file, segment);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Symbolic link refused: ${relative}`);
  }
  return file;
}
function matches(root, entries) {
  return Object.entries(entries).every(([relative, record]) => {
    const file = safeFile(root, relative);
    return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size === record.size && sha(fs.readFileSync(file)) === record.sha256;
  });
}
const payload = path.join(bundle, 't-t-1');
if (!matches(payload, manifest.after)) throw new Error('Corrected source bundle content hash mismatch');
if (matches(source, manifest.after)) {
  console.log('Already applied: all 50 source files match the corrected snapshot.');
  process.exit(0);
}
if (!matches(source, manifest.before)) throw new Error('Source differs from the incoming handoff; no files written.');
for (const relative of Object.keys(manifest.after).filter(p => !(p in manifest.before))) {
  if (fs.existsSync(safeFile(source, relative))) throw new Error(`New source file already exists: ${relative}; no files written.`);
}
if (JSON.stringify(manifest.changes) !== JSON.stringify(metadata.changes.map(x => x.path))) throw new Error('Changed path set mismatch');
// Preflight has validated every incoming source file, all payloads, and new-file absence.
// Write temporary siblings first, then replace the six bounded paths. No other source files are touched.
const staged = [];
try {
  for (const relative of manifest.changes) {
    const file = safeFile(source, relative), temp = `${file}.policybench-update-${process.pid}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, fs.readFileSync(safeFile(payload, relative)), { flag: 'wx' });
    staged.push({ file, temp });
  }
  for (const { file, temp } of staged) fs.renameSync(temp, file);
} finally {
  for (const { temp } of staged) fs.rmSync(temp, { force: true });
}
if (!matches(source, manifest.after)) throw new Error('Post-apply hash verification failed');
console.log(`Applied ${manifest.changes.length} reviewed files; all 50 source files match the corrected snapshot.`);
