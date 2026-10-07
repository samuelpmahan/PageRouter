#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kompoze } from './policies/kompoze.mjs';
import { crisp } from './policies/crisp.mjs';
import { itemFor, recordRun, state, setPhase } from './policies/neat.mjs';
import { recordBuild, validateBuild } from './policies/tidy.mjs';
import { recipeFiles, stageForRootSync } from './capabilities/smartsync.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const [command, ...argv] = process.argv.slice(2);
const option = (flag, fallback) => { const index = argv.indexOf(flag); return index < 0 ? fallback : argv[index + 1]; };
const requiredNumber = flag => {
  const value = option(flag, undefined);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw Error(`Invalid number for ${flag}`);
  return number;
};
const overrides = { runArgs: {}, viewArgs: {} };
for (const [flag, key] of [['--start', 'start'], ['--duration', 'duration'], ['--scale', 'scale'], ['--dx', 'dx'], ['--dy', 'dy']]) {
  const value = requiredNumber(flag);
  if (value !== undefined) overrides.runArgs[key] = value;
}
for (const [flag, key] of [['--x', 'dx'], ['--y', 'dy']]) {
  const value = requiredNumber(flag);
  if (value !== undefined) overrides.runArgs[key] = value;
}
if (option('--title', undefined) !== undefined) overrides.viewArgs.title = option('--title');
for (const key of ['orientation', 'preset']) if (option(`--${key}`, undefined) !== undefined) overrides.viewArgs[key] = option(`--${key}`);
const recipePath = option('--recipe', 'recipes/house-cut.json');
const isDiscStudio = () => recipePath === 'recipes/discstudio-photo-card.json';
const print = value => console.log(JSON.stringify(value, null, 2));
const hashStream = path => new Promise((yes, no) => {
  const h = createHash('sha256'), stream = createReadStream(path);
  stream.on('data', block => h.update(block)).on('error', no).on('end', () => yes(h.digest('hex')));
});
async function runtime() {
  if (isDiscStudio()) {
    const canvasPackage = process.env.NCTK_CANVAS_PACKAGE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas/package.json';
    const localCanvas = join(root, 'vendor/discstudio/disc/node_modules/@napi-rs/canvas');
    const localPackage = join(localCanvas, 'package.json');
    const hostIdentity = await hashStream(canvasPackage);
    const localIdentity = await hashStream(localPackage).catch(() => null);
    if (!localIdentity) { await mkdir(dirname(localCanvas), { recursive: true }); await symlink(dirname(canvasPackage), localCanvas, 'dir'); }
    const identity = await hashStream(localPackage);
    if (identity !== hostIdentity) throw Error('Local DiscStudio canvas binding differs from NCTK_CANVAS_PACKAGE.');
    return { identities: { 'node-canvas': identity }, node: process.execPath, canvasPackage };
  }
  const binding = JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8'));
  const selected = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const path = process.env[`NCTK_${name.toUpperCase()}`] || binding[name].desktopPath;
    if (await hashStream(path) !== binding[name].sha256) throw Error(`${name} does not match pinned runtime bytes: ${path}`);
    selected[name] = path;
  }
  return { ...selected, identities: {
    ffprobe: binding.ffprobe.sha256,
    ffmpeg: createHash('sha256').update(binding.ffmpeg.sha256 + binding.ffprobe.sha256).digest('hex')
  } };
}
async function source(resolved, fresh) {
  if (resolved.source.contract.materializer === 'fixture-file') { const path = join(root, resolved.source.contract.path); if (await hashStream(path) !== resolved.source.contract.sha256) throw Error(`Fixture source does not match declared bytes: ${resolved.source.contract.path}`); return { path, sha256: resolved.source.contract.sha256, classification: 'declared-fixture' }; }
  const output = join(root, 'work/inputs', `source-${resolved.source.contract.sha256}.mp4`);
  const args = ['transport/remote_input.py', '--manifest', resolved.source.path, '--out', output,
    '--queue', join(root, 'work/remote-input-queue')];
  if (fresh) args.push('--fresh');
  await new Promise((yes, no) => {
    const process = spawn('python3', args, { cwd: root, stdio: 'inherit' });
    process.on('error', no).on('exit', code => code === 0 ? yes() : no(Error(`Original input materialization failed: exit ${code}`)));
  });
  return { path: output, sha256: resolved.source.contract.sha256 };
}
async function run() {
  const resolved = await kompoze(root, recipePath, overrides);
  const build = await validateBuild(root, await recipeFiles(root, resolved));
  const bound = await runtime();
  const input = await source(resolved, argv.includes('--fresh'));
  const fixture = input.classification === 'declared-fixture';
  const result = await crisp(root, resolved, input, bound);
  await recordBuild(root, build);
  const work = await state(root), version = build.version;
  const report = { schema: 'nctk-clip-run@1', at: new Date().toISOString(),
    identity: `${version.x}.${version.y}.${version.z}-${version.taskId}_${itemFor(work, recipePath).phase}`,
    recipe: recipePath, source: { sha256: input.sha256, binding: resolved.source.address, freshRemote: fixture ? false : argv.includes('--fresh'), classification: fixture ? 'declared-derived-fixture' : 'preserved-remote-source' },
    args: resolved.runArgs, viewArgs: resolved.viewArgs, actions: result.actions,
    clip: result.actions.find(action => action.part === 'parts/cut/house')?.outputs[0]?.path,
    review: result.actions.find(action => action.part === 'parts/review/house')?.outputs.find(output => output.path.endsWith('review.html'))?.path,
    rawCard: result.actions.find(action => action.part === 'parts/card/discstudio')?.outputs.find(output => output.path.endsWith('card.png'))?.path,
    card: result.actions.find(action => action.part === 'parts/positioned/discstudio')?.outputs.find(output => output.path.endsWith('positioned-card.png'))?.path,
    editorialAcceptance: 'UNKNOWN' };
  const runDir = join(root, 'work/runs');
  await mkdir(runDir, { recursive: true });
  const name = `run-${new Date().toISOString().replaceAll(/[:.]/g, '')}-${randomUUID().slice(0, 8)}.json`;
  report.report = `work/runs/${name}`;
  await writeFile(join(runDir, name), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(root, 'work/latest.json'), JSON.stringify({ report: `work/runs/${name}` }, null, 2) + '\n');
  await recordRun(root, report, build.contentId);
  print(report);
}
async function project(command) {
  const latest = JSON.parse(await readFile(join(root, 'work/latest.json'), 'utf8'));
  const report = JSON.parse(await readFile(join(root, latest.report), 'utf8'));
  const positioned = report.actions.find(action => action.part === 'parts/positioned/discstudio');
  if (!positioned) throw Error('Run the DiscStudio photo-card recipe first to create a positioned transparent card.');
  const cardPath = join(root, positioned.outputs.find(output => output.path.endsWith('positioned-card.png')).path);
  const backgroundPath = resolve(option('--background', join(root, 'fixtures/discstudio-sample-background.svg')));
  const workDir = join(root, 'work', command === 'preview' ? 'previews' : 'composites', `projection-${new Date().toISOString().replaceAll(/[:.]/g, '')}-${randomUUID().slice(0, 8)}`);
  await mkdir(workDir, { recursive: true });
  const address = command === 'preview' ? 'preview-discstudio' : 'composite-discstudio';
  const outputPart = command === 'preview' ? 'parts/preview/discstudio' : 'parts/composite/discstudio';
  const implementation = await import(pathToFileURL(join(root, 'calculations', address, 'calculate.mjs')).href);
  const result = await implementation.calculate({
    inputs: {
      'parts/positioned/discstudio': { files: [cardPath] },
      'parts/source/discstudio-background': { files: [backgroundPath] }
    },
    outputDir: workDir,
    runtime: { backgroundPath }
  });
  const image = result.files.find(path => path.endsWith('.png'));
  const receipt = result.files.find(path => path.endsWith('.json'));
  const requestedOutput = option('--out', undefined);
  if (requestedOutput) {
    const outputPath = resolve(requestedOutput);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(image, outputPath);
    await copyFile(receipt, `${outputPath}.json`);
    return print({ command, part: outputPart, image: outputPath, receipt: `${outputPath}.json`, observation: result.observation });
  }
  return print({ command, part: outputPart, image, receipt, observation: result.observation });
}
async function seekFrame() {
  if (!isDiscStudio()) throw Error('seek requires --recipe recipes/discstudio-photo-card.json.');
  const bound = await runtime();
  const storyboardPath = resolve(option('--storyboard', join(root, 'examples/salamander-one-frame.json')));
  const storyboard = JSON.parse(await readFile(storyboardPath, 'utf8'));
  let cardPath = option('--card', 'latest');
  if (cardPath === 'latest') {
    const latest = JSON.parse(await readFile(join(root, 'work/latest.json'), 'utf8'));
    const report = JSON.parse(await readFile(join(root, latest.report), 'utf8'));
    if (report.recipe !== recipePath || !report.rawCard) throw Error('Latest run has no native DiscStudio Card.');
    cardPath = join(root, report.rawCard);
  } else cardPath = resolve(cardPath);
  const backgroundPath = resolve(option('--background', join(root, 'fixtures/seek/frame.jpeg')));
  const t = requiredNumber('--at') ?? 0;
  const outputPath = resolve(option('--out', join(root, 'work/seek/frame.png')));
  const { createCardSeek } = await import('./projections/discstudio-seek.mjs');
  const seek = await createCardSeek({ cardBytes: await readFile(cardPath), backgroundBytes: await readFile(backgroundPath), storyboard });
  const { png, receipt } = seek(t);
  const record = { ...receipt, storyboardSha256: await hashStream(storyboardPath),
    projectionCodeSha256: await hashStream(join(root, 'projections/discstudio-seek.mjs')),
    placementCodeSha256: await hashStream(join(root, 'projections/seek-plan.mjs')),
    canvasPackageSha256: bound.identities['node-canvas'],
    annotationSource: storyboard.annotationSource ?? null, humanAcceptance: 'UNKNOWN' };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, png);
  await writeFile(`${outputPath}.json`, JSON.stringify(record, null, 2) + '\n');
  return print({ command: 'seek', image: outputPath, receipt: `${outputPath}.json`, shot: record.shot, frameSha256: record.frameSha256, humanAcceptance: record.humanAcceptance });
}
async function main() {
  if (command === 'phase') {
    const version = JSON.parse(await readFile(join(root, 'version.json'), 'utf8'));
    const relations = [];
    if (option('--refines', undefined)) relations.push({ kind: 'refines', path: option('--refines') });
    if (option('--parallel-with', undefined)) relations.push({ kind: 'parallelWith', path: option('--parallel-with') });
    return print(await setPhase(root, option('--to', ''), version, option('--work-path', recipePath), relations));
  }
  if (command === 'preview' || command === 'composite') return project(command);
  if (command === 'seek') return seekFrame();
  const resolved = await kompoze(root, recipePath, overrides);
  if (command === 'compile') return print({ recipe: recipePath, base: resolved.recipe.base, overlay: resolved.recipe.overlay,
    runArgs: resolved.runArgs, viewArgs: resolved.viewArgs,
    graph: resolved.ordered.map(node => ({ calculation: node.address, inputs: node.contract.inputs, outputs: node.contract.outputs })) });
  if (command === 'package') {
    await validateBuild(root, await recipeFiles(root, resolved));
    const destination = resolve(option('--out', join(root, '../work', `nctk-stage-${randomUUID().slice(0, 12)}`)));
    const staged = await stageForRootSync(root, resolved, destination);
    return print({ directory: staged.directory, manifest: join(destination, 'SYNC-MANIFEST.json'), fileCount: staged.fileCount,
      included: staged.manifest.included.map(item => ({ path: item.path, classification: item.classification })),
      generatedPayloadIncluded: false });
  }
  if (command === 'run') return run();
  throw Error('Use compile, run, preview, composite, seek, package, or phase');
}
main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
