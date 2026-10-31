import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  'idb-storage.mjs', // kept graphics in IndexedDB (third editor cut); missing from that cut's file list, so the page stopped at load
  'archive-codec.mjs',
  'native-cards.mjs',
  'card-editor.mjs',
  'card-parts.mjs',
  // The first Constraint Lab (Wed 21 Oct), unchanged, so thro's handles can be judged against it.
  'constraint-lab/index.html',
  'constraint-lab/assets/DejaVuSans-Bold.woff2',
  'constraint-lab/assets/DejaVuSans.woff2',
  'constraint-lab/assets/DejaVuSansCondensed-Bold.woff2',
  'constraint-lab/assets/disc0.webp',
  'constraint-lab/assets/disc2.webp',
  'constraint-lab/assets/disc4.webp',
  'constraint-lab/assets/scene.svg',
  'preview-frame.mjs',
  'prepared-fixture.mjs',
  'prepared-fixture.json',
  'lineup-lab.html',
  'battle-lab.html',
  'dtree.mjs',
  'handles.mjs',
  'console-map.mjs',
  'post-mode.mjs',
  'kan-crop.mjs',
  'pxc/gondola-client.mjs',
  'ask.html',
  'ask.mjs',
  'paper-card.mjs',
  'photos.html',
  'photos.mjs',
  'mold-feed.mjs',
  'mold-mentions.mjs',
  'photo-bag.mjs',
  'rimfit.mjs',
  'rimfit-worker.mjs',
  'thro-calculations.mjs',
  'editor-dev.mjs',
  'editor-place.mjs',
  'editor-batch.mjs',
  'editor-zip.mjs',
  'thro-bar.mjs',
  'bar.html',
  'bar.mjs',
  'witness-pattern.mjs',
  'assets/photos/photos.json',
  'assets/photos/IMG_6081.jpg',
  'assets/photos/IMG_6161.jpg',
  'assets/photos/IMG_6162.jpg',
  'assets/photos/IMG_6163.jpg',
  'assets/photos/IMG_6164.jpg',
  'assets/photos/IMG_6165.jpg',
  'assets/photos/IMG_6166.jpg',
  'assets/photos/IMG_6167.jpg',
  'assets/photos/IMG_6168.jpg',
  'assets/photos/IMG_6576.jpg',
  'console-map/phone.json',
  'console-map/phone.webp',
  'ways.mjs',
  'gestures.mjs',
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
// Disc catalog swap (Sam, 29 Oct: "Swap now, service later"). The Studio closure brings the full catalog (catalog.js, 724 records
// with sources and observations) while the packed mold catalog (mold-runtime.bin) already loads for the card renderer. Both are
// built from the same catalog source, so the full one is replaced by a module that reads the same records from the packed one.
// The swap refuses to run unless the packed manifest names the exact catalog bytes it replaces.
{
  const studioCatalog = path.join(output, 'studio', 'upload-disc-to-shelf', 'catalog.js');
  const replaced = fs.readFileSync(studioCatalog);
  const manifest = fs.readFileSync(path.join(output, cardVendor, 'mold-runtime-manifest.js'), 'utf8');
  const packedSource = /"sourceCatalogSha256":\s*"([0-9a-f]{64})"/.exec(manifest)?.[1];
  if (createHash('sha256').update(replaced).digest('hex') !== packedSource) {
    throw Error('The packed mold catalog was not built from this disc catalog; rebuild mold-runtime.bin before swapping.');
  }
  // Import the index under the address the card renderer uses, so both share one copy and one fetch of the binary.
  const library = fs.readFileSync(path.join(output, cardVendor, 'mold-library.js'), 'utf8');
  const index = /from '\.\/(mold-runtime-index\.js[^']*)'/.exec(library)?.[1];
  if (!index) throw Error('mold-library.js no longer names mold-runtime-index.js.');
  fs.writeFileSync(studioCatalog, `// Read from the packed mold catalog, which was built from catalog source ${packedSource}.
import { packedMoldIndex } from '../../${cardVendor}/${index}';
export const catalog = packedMoldIndex.stableIds.map(id => { const r = packedMoldIndex.recordForId(id);
  return { manufacturer: r.manufacturer, mold: r.mold, flight: [...r.flight], id: r.id, reviewStatus: 'unreviewed' }; });
`);
}
// Mold search ranking (Sam, 29 Oct: "How in the world do you rank 'inn'?"). Counts how many harvested videos name each mold when
// THRO_MOLD_POSTINGS names a harvest postings folder (.jsonl files, one posting a line); without it every mold counts 0 and search
// ranks by kind of match and name alone. The counts are written into the built site only.
{
  const folder = process.env.THRO_MOLD_POSTINGS;
  let counted = { postings: null, mentions: {}, unmatched: {} };
  if (folder) {
    const { parsePackedMoldRuntime } = await import(pathToFileURL(path.join(output, cardVendor, 'mold-runtime-index.js')).href);
    const { moldMentions } = await import(pathToFileURL(path.join(root, 'mold-mentions.mjs')).href);
    const index = parsePackedMoldRuntime(new Uint8Array(fs.readFileSync(path.join(output, cardVendor, 'mold-runtime.bin'))));
    const files = fs.readdirSync(folder).filter(name => name.endsWith('.jsonl')).sort();
    const hash = createHash('sha256');
    const postings = files.flatMap(name => { const bytes = fs.readFileSync(path.join(folder, name)); hash.update(name).update('\0').update(bytes).update('\0');
      return bytes.toString('utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); });
    // The unresolved candidates count when THRO_MOLD_CANDIDATES (candidates/unresolved.jsonl), THRO_MOLD_VIDEOS (videos.jsonl) and
    // THRO_MOLD_DICTIONARY (the extractor's discs.json) name the same harvest's files; all three or none.
    const extra = ['THRO_MOLD_CANDIDATES', 'THRO_MOLD_VIDEOS', 'THRO_MOLD_DICTIONARY'].map(name => process.env[name]);
    if (extra.some(Boolean) && !extra.every(Boolean)) throw Error('set THRO_MOLD_CANDIDATES, THRO_MOLD_VIDEOS and THRO_MOLD_DICTIONARY together');
    const read = file => { const bytes = fs.readFileSync(file); return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }; };
    const lines = bytes => bytes.toString('utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const [candidates, videos, dictionary] = extra.every(Boolean) ? extra.map(read) : [];
    counted = { postings: { files: files.length, count: postings.length, sha256: hash.digest('hex') },
      ...(candidates ? { candidates: { sha256: candidates.sha256 }, videos: { sha256: videos.sha256 }, dictionary: { sha256: dictionary.sha256 } } : {}),
      ...moldMentions(index, postings, candidates ? { candidates: lines(candidates.bytes), videos: lines(videos.bytes), dictionary: JSON.parse(dictionary.bytes) } : {}) };
  }
  fs.mkdirSync(path.join(output, 'assets', 'molds'), { recursive: true });
  fs.writeFileSync(path.join(output, 'assets', 'molds', 'mold-mentions.json'), JSON.stringify(counted) + '\n');
}
// The photos page names each sample photo's mold before anyone searches. Those few records are written into the built
// photos.json, so the page can wait to load the packed catalog (mold-runtime.bin) until the search box is used (30 Oct).
{
  const { parsePackedMoldRuntime } = await import(pathToFileURL(path.join(output, cardVendor, 'mold-runtime-index.js')).href);
  const index = parsePackedMoldRuntime(new Uint8Array(fs.readFileSync(path.join(output, cardVendor, 'mold-runtime.bin'))));
  const file = path.join(output, 'assets', 'photos', 'photos.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const photo of manifest.photos) {
    if (!photo.mold) continue;
    photo.record = index.recordForId(photo.mold);
    if (!photo.record) throw Error(`photos.json names ${photo.mold}, which the packed mold catalog does not have`);
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 1) + '\n');
}
fs.mkdirSync(path.join(output, 'assets', 'discs'), { recursive: true });
for (const name of imageFiles) {
  fs.copyFileSync(path.join(discs, name), path.join(output, 'assets', 'discs', name));
}

// The tee shot and the sample discs ship re-encoded (Sam, 30 Oct: "good, do"); the originals above stay the source and
// pictures.json says what changes. Python with Pillow does the encoding; the receipt records every hash and encoder version.
execFileSync(process.env.PYTHON ?? 'python3', [path.join(root, 'reencode-pictures.py'), output, path.join(root, 'pictures.json'), path.join(output, 'pictures-receipt.json')], { stdio: 'inherit' });

const digest = files => {
  const hash = createHash('sha256');
  for (const [name, bytes] of files) hash.update(name).update('\0').update(bytes).update('\0');
  return hash.digest('hex');
};
const authored = [...runtimeFiles, ...cardVendorFiles.map(name => `../../${cardVendor}/${name}`), 'experience.json', 'build.mjs', 'mold-mentions.mjs', 'mold-evidence.mjs', 'reencode-pictures.py', 'pictures.json', ...imageFiles.map(name => `assets/discs/${name}`)].sort();
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
