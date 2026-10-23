import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildDemo } from '../../local/studio-demo/build.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const runtimeFiles = [
  'index.html',
  'thro-app.mjs',
  'thro.css',
  'workspace.mjs',
  'workspace-package.mjs',
  'transfer-contracts.mjs',
  'archive-inspection.mjs',
  'locked-storage.mjs',
  'archive-codec.mjs',
  'native-cards.mjs',
  'card-editor.mjs',
  'preview-frame.mjs',
  'prepared-fixture.mjs',
  'prepared-fixture.json',
  'lineup-lab.html',
  'battle-lab.html',
  'dtree.mjs',
  'handles.mjs',
  'ways.mjs',
  'timing.mjs',
  'revision-review.html',
  'revision-review.mjs',
  'notebook.html',
  'notebook.mjs',
  'notebook-conservation.html',
  'notebook-conservation.mjs',
  'viewer.mjs',
  'dtree.json',
  'thro-world.mjs',
  'fill-matrix.html',
  'fill-matrix.json',
  'pxc/kernel.mjs',
  'pxc/canonical.mjs',
  'pxc/schema.mjs',
  'pxc/view.mjs',
  'pxc/lab/runtime.mjs',
  'pxc/lab/semiring.mjs',
  'pxc/lab/PIN.json',
];

if (path.resolve(process.cwd()) !== root) {
  throw Error('Run the thro build from its Experience directory.');
}

// Check the authored overlay before the shared builder writes any output.
function regularFile(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    throw Error(`Missing regular thro runtime file: ${relative}`);
  }
  return file;
}
for (const file of runtimeFiles) regularFile(file);

const cardVendor = 'vendor/discstudio-cards';
const cardVendorRoot = path.resolve(root, '../..', cardVendor);
function cardVendorFile(relative) {
  const file = path.join(cardVendorRoot, relative);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    throw Error(`Missing regular DiscStudio card vendor file: ${relative}`);
  }
  return file;
}
const sourcePin = JSON.parse(fs.readFileSync(cardVendorFile('SOURCE-PIN.json'), 'utf8'));
if (sourcePin.schema !== 'thro-discstudio-vendor-pin@1' || sourcePin.nativeFiles?.length !== 15 || sourcePin.adapter?.path !== 'thro-adapter.mjs') {
  throw Error('Invalid DiscStudio card vendor source pin.');
}
// throFiles: Thro-owned card files (card revisions) pinned beside the unchanged native ones.
const pinnedCardFiles = [...sourcePin.nativeFiles, ...(sourcePin.throFiles ?? []), sourcePin.adapter];
const vendorNames = new Set();
for (const item of pinnedCardFiles) {
  if (typeof item.path !== 'string' || item.path.includes('\\') || item.path.startsWith('/') || item.path.split('/').some(part => !part || part === '..') || vendorNames.has(item.path)) {
    throw Error('Invalid or repeated DiscStudio card vendor path.');
  }
  vendorNames.add(item.path);
  const bytes = fs.readFileSync(cardVendorFile(item.path));
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw Error(`DiscStudio card vendor pin mismatch: ${item.path}`);
  }
}
const cardVendorFiles = ['SOURCE-PIN.json', 'README.md', ...vendorNames].sort();
for (const file of cardVendorFiles) cardVendorFile(file);

const discs = path.join(root, 'assets', 'discs');
if (!fs.existsSync(discs) || !fs.lstatSync(discs).isDirectory()) {
  throw Error('Missing thro fixture image directory: assets/discs');
}
const imageFiles = fs.readdirSync(discs).sort();
if (!imageFiles.length) throw Error('The thro fixture shelf needs images in assets/discs.');
for (const name of imageFiles) {
  if (!/\.(avif|gif|jpe?g|png|svg|webp)$/i.test(name)) {
    throw Error(`Unexpected thro fixture image file: assets/discs/${name}`);
  }
  regularFile(path.join('assets', 'discs', name));
}

// Retain the complete existing Studio and renderer closure, then replace only
// the entry surface and add the thro workspace/fixture modules.
await buildDemo();
for (const file of runtimeFiles) {
  fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
for (const file of cardVendorFiles) {
  const target = path.join(output, cardVendor, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(cardVendorFile(file), target);
}
fs.mkdirSync(path.join(output, 'assets', 'discs'), { recursive: true });
for (const name of imageFiles) {
  fs.copyFileSync(path.join(discs, name), path.join(output, 'assets', 'discs', name));
}

const digest = files => {
  const hash = createHash('sha256');
  for (const [name, bytes] of files) hash.update(name).update('\0').update(bytes).update('\0');
  return hash.digest('hex');
};
const authored = [...runtimeFiles, ...cardVendorFiles.map(name => `../../${cardVendor}/${name}`), 'experience.json', 'build.mjs', ...imageFiles.map(name => `assets/discs/${name}`)].sort();
const sourceId = digest(authored.map(name => [name, fs.readFileSync(path.join(root, name))]));
const built = [];
function walk(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    if (!prefix && name === 'BUILD_INFO.json') continue;
    const relative = prefix ? `${prefix}/${name}` : name, file = path.join(directory, name);
    if (fs.lstatSync(file).isDirectory()) walk(file, relative);
    else built.push([relative, fs.readFileSync(file)]);
  }
}
walk(output);
fs.writeFileSync(path.join(output, 'BUILD_INFO.json'), JSON.stringify({
  schema: 'thro-build@1', product: 'thro', version: '0.1.0', localCandidate: !process.env.GITHUB_SHA,
  sourceCommit: process.env.GITHUB_SHA ?? null, sourceBaseCommit: process.env.THRO_SOURCE_BASE_COMMIT ?? null,
  sourceId, artifactId: digest(built), node: process.version, fixtureOnly: true,
  authentication: 'not-configured', humanAcceptance: 'pending',
}, null, 2) + '\n');
