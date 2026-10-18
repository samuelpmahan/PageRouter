import {createHash} from 'node:crypto';
import {access, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const packageRoot = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('usage: verify-retained-package-files.mjs <cycle-09-package-root>');
const oldManifestPath = join(packageRoot, 'post-review-admin', 'original-manifest.json');
const oldManifestBytes = await readFile(oldManifestPath);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestSha = sha(oldManifestBytes);
if (manifestSha !== '9cd5ba3824b50ebc064f361d6998c60c2024c562943ea7ab86d22237ae67dc42') throw new Error('old manifest copy hash mismatch');
const manifest = JSON.parse(oldManifestBytes.toString('utf8'));
const oldPath = 'evidence/source-candidate/public-controller.test.mjs';
const newPath = `${oldPath}.txt`;
const entries = Object.entries(manifest.files);
if (entries.length !== 112) throw new Error('expected 112 original manifest entries');
let unchanged = 0;
for (const [path, expected] of entries) {
  if (path === oldPath) continue;
  const bytes = await readFile(join(packageRoot, path));
  const actual = sha(bytes);
  if (actual !== expected) throw new Error(`old package file changed: ${path}`);
  unchanged += 1;
}
if (unchanged !== 111) throw new Error(`expected 111 unchanged old payloads, got ${unchanged}`);
try {
  await access(join(packageRoot, oldPath));
  throw new Error('old executable archive filename still exists');
} catch (error) {
  if (error.message === 'old executable archive filename still exists') throw error;
  if (error.code !== 'ENOENT') throw error;
}
const renamedBytes = await readFile(join(packageRoot, newPath));
const renamedHash = sha(renamedBytes);
if (renamedHash !== manifest.files[oldPath]) throw new Error('renamed archive bytes differ from original manifest');
console.log(JSON.stringify({verified: true, oldManifestSha256: manifestSha, originalManifestEntries: entries.length,
  unchangedOldPayloads: unchanged, renamedMapping: {from: oldPath, to: newPath, sha256: renamedHash,
    bytes: renamedBytes.length}, oldExecutableNameAbsent: true}, null, 2));
