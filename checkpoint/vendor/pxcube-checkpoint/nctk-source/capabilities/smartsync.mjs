import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileHash, safePath } from '../facts.mjs';
import { state } from '../policies/neat.mjs';
import { managedManifestFiles, managedSourceFiles } from '../policies/tidy.mjs';

const policy = ['kompoze', 'tidy', 'crisp', 'neat', 'candidate'].map(name => `policies/${name}.mjs`);
const transport = ['root_sync.py', 'localci.py', 'root_sync_legacy.py', 'remote_input.py'].map(name => `transport/${name}`);
async function sourceClosure(root, relative) { const files=[]; for (const entry of await readdir(join(root,relative),{withFileTypes:true})) { const child=`${relative}/${entry.name}`; if (entry.isDirectory()) { if (!['node_modules','dist','evidence','renders','renders-real','mvp-output'].includes(entry.name)) files.push(...await sourceClosure(root,child)); } else if (entry.isFile()) files.push(child); } return files; }
export async function recipeFiles(root, resolved) {
  const selectedPartAddresses = new Set([resolved.source.address, resolved.target,
    ...resolved.ordered.flatMap(node => [...node.contract.inputs, ...node.contract.outputs])]);
  return [...new Set([
    'README.md', 'toolkit.mjs', 'facts.mjs', 'runtime.json', 'version.json', 'capabilities/smartsync.mjs',
    'capabilities/merge_release.mjs', 'transport/localci_merge.mjs', 'tests/merge-queue.test.mjs', 'tests/stage-set.test.mjs',
    ...await managedManifestFiles(root), ...await managedSourceFiles(root),
    ...policy, ...transport, resolved.recipePath, resolved.recipe.base, resolved.recipe.overlay,
    ...[...selectedPartAddresses].map(address => resolved.parts.get(address).path),
    ...resolved.ordered.flatMap(node => [node.path, node.script]),
    ...(resolved.source.contract.materializer === 'fixture-file' ? [resolved.source.contract.path] : []),
    ...(resolved.recipePath === 'recipes/discstudio-photo-card.json' ? [
      'calculations/preview-discstudio/calculation.json', 'calculations/preview-discstudio/calculate.mjs',
      'calculations/composite-discstudio/calculation.json', 'calculations/composite-discstudio/calculate.mjs',
      'parts/source/discstudio-background/part.json', 'parts/preview/discstudio/part.json', 'parts/composite/discstudio/part.json',
      'fixtures/discstudio-sample-background.svg', 'tests/discstudio-transform.test.mjs', 'tests/neat-work-state.test.mjs', 'tests/tidy-directory.test.mjs',
      'transport/discstudio_release.py', 'transport/record_localci_observation.mjs', 'transport/validate_directory_tree.mjs', 'transport/test_discstudio_release.py',
      'projections/discstudio-seek.mjs', 'projections/seek-plan.mjs', 'examples/salamander-one-frame.json',
      'fixtures/seek/card.png', 'fixtures/seek/frame.jpeg', 'tests/discstudio-seek.test.mjs'
    ] : []),
    ...(resolved.recipePath === 'recipes/discstudio-photo-card.json' ? await sourceClosure(root, 'vendor/discstudio/disc') : []),
    ...(resolved.recipePath === 'recipes/discstudio-photo-card.json' ? await sourceClosure(root, 'vendor/discstudio/part-first-kernel') : [])
  ])].sort();
}
/** Only small, explicit frozen queue inputs cross SmartSync; generated work remains local. */
export async function stageFrozenMergeInputs(root, destination, recipePath, existing = new Set()) {
  const snapshot = await state(root), paths = new Set();
  for (const [workItem, item] of Object.entries(snapshot.items)) {
    if (!['Review', 'Merge'].includes(item.state) || item.review?.target !== recipePath) continue;
    for (const path of [workItem, item.review.checkpointPath,
      ...(item.review.evidence ?? []).map(entry => entry.path), ...(item.approval?.evidence ?? []).map(entry => entry.path)]) {
      if (!path || existing.has(path)) continue;
      if (!path.startsWith('work/') || !path.endsWith('.json')) throw Error(`Frozen queue input must be a small JSON file in work/: ${path}`);
      paths.add(path);
    }
  }
  if (paths.size > 64) throw Error('Too many frozen queue input files for SmartSync');
  const included = [];
  let total = 0;
  for (const path of [...paths].sort()) {
    const components = path.split('/');
    for (let depth = 1; depth < components.length; depth++) {
      const parent = join(root, ...components.slice(0, depth));
      const metadata = await lstat(parent);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw Error(`Symlink or non-directory parent in frozen queue input: ${path}`);
    }
    const source = safePath(root, path), metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw Error(`Unsafe or oversized frozen queue input: ${path}`);
    total += metadata.size;
    if (total > 2 * 1024 * 1024) throw Error('Frozen queue inputs exceed SmartSync size limit');
    JSON.parse(await readFile(source, 'utf8'));
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { errorOnExist: true });
    const sha256 = await fileHash(source);
    if (await fileHash(target) !== sha256) throw Error(`Frozen queue input changed while staging: ${path}`);
    included.push({ path, sha256, classification: 'frozen-merge-input' });
  }
  return included;
}
export async function stageForRootSync(root, resolved, destination) {
  const rel = relative(resolve(root), resolve(destination));
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')) throw Error('Stage must be outside the nctk source subtree');
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination, { recursive: false });
  const included = [];
  for (const path of await recipeFiles(root, resolved)) {
    const source = safePath(root, path), target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { errorOnExist: true });
    const sha256 = await fileHash(source);
    if (await fileHash(target) !== sha256) throw Error(`Stage copy differs: ${path}`);
    const classification = path === 'fixtures/derived-contact-sheet-input.png' ? 'declared-derived-fixture' : path.startsWith('vendor/discstudio/') ? 'discstudio-source-closure' : path.startsWith('parts/source/') ? 'original-input-binding' :
      path.startsWith('policies/') || path === 'version.json' ? 'policy' :
      path.startsWith('transport/') || path === 'runtime.json' ? 'runtime-transport-binding' :
      path.startsWith('calculations/') || path === 'facts.mjs' || path === 'toolkit.mjs' || path.startsWith('capabilities/') ? 'executable-source' : 'composition-contract';
    included.push({ path, sha256, classification });
  }
  included.push(...await stageFrozenMergeInputs(root, destination, resolved.recipePath,
    new Set(included.map(item => item.path))));
  const lifecycle = await state(root);
  await mkdir(join(destination, 'state'), { recursive: true });
  await writeFile(join(destination, 'state/lifecycle.json'), JSON.stringify(lifecycle, null, 2) + '\n');
  included.push({ path: 'state/lifecycle.json', sha256: await fileHash(join(destination, 'state/lifecycle.json')), classification: 'small-work-state' });
  const manifest = { schema: 'smartsync-recipe@1', included,
    excluded: [
      { path: 'work/** except explicitly listed frozen-merge-input JSON', classification: 'generated-results-and-receipts' },
      { path: '**/node_modules/**, **/dist/**, **/evidence/**, **/mvp-output/**', classification: 'local-runtime-and-render-evidence' },
      { path: '../work/dispatch-20260926/**', classification: 'historical-work-and-original-media-local-copy' },
      { path: '../.bootstrap/**', classification: 'local-runtime-install-and-source-inspection' }
    ],
    originalInputAcquisition: resolved.source.contract.materializer === 'fixture-file' ? [{ path: resolved.source.contract.path, sha256: resolved.source.contract.sha256, bytes: resolved.source.contract.bytes, classification: 'declared-derived-fixture' }] : resolved.source.contract.parts.map(part => ({ driveId: part.driveId, sha256: part.sha256, bytes: part.bytes })),
    generatedPayloadIncluded: false };
  await writeFile(join(destination, 'SYNC-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory: destination, manifest, fileCount: included.length + 1 };
}
