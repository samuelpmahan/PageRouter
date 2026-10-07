import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileHash } from '../facts.mjs';
import { kompoze, kompozeStageSet } from '../policies/kompoze.mjs';
import { crisp, crispStageSet } from '../policies/crisp.mjs';

const stage = name => ({ name, recipePath: `recipes/${name.toLowerCase()}.json` });
const manifest = (address, children, kind, source = null, refs = []) => ({ schema: 'nctk-directory@1',
  address, children, kind, source, policies: { neat: { mode: 'none' }, crisp: { mode: 'none' },
    tidy: { mode: 'local' }, kompoze: { mode: source ? 'local' : 'none', references: refs } } });
async function write(root, path, value) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof value === 'string' ? value : JSON.stringify(value));
}
async function fixture({ differentSource = false, conflictingArgs = false, unstarted = false, irrelevantArgs = false, variantProducers = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'stage-set-'));
  await write(root, 'fixtures/shared.txt', 'seed');
  await write(root, 'fixtures/other.txt', 'other');
  await write(root, 'nctk.json', manifest('.', ['bases', 'calculations', 'overlays', 'parts', 'recipes'], 'group'));
  for (const [parent, children] of Object.entries({
    bases: ['bases/a', 'bases/b'], overlays: ['overlays/a', 'overlays/b'], recipes: ['recipes/a', 'recipes/b'],
    calculations: ['calculations/shared-a', ...(variantProducers ? ['calculations/shared-b'] : []), 'calculations/target-a', 'calculations/target-b'],
    parts: [...(unstarted ? ['parts/open'] : []), 'parts/shared', 'parts/source', 'parts/target'],
    'parts/source': ['parts/source/other', 'parts/source/shared'],
    'parts/target': ['parts/target/a', 'parts/target/b'],
  })) await write(root, `${parent}/nctk.json`, manifest(parent, children, 'group'));
  if (unstarted) {
    await write(root, 'parts/open/part.json', { kind: 'derived' });
    await write(root, 'parts/open/nctk.json', manifest('parts/open', [], 'part', 'parts/open/part.json'));
  }
  for (const kind of ['a', 'b']) {
    await write(root, `recipes/${kind}.json`, { kind: 'recipe', base: `bases/${kind}.json`, overlay: `overlays/${kind}.json` });
    await write(root, `recipes/${kind}/nctk.json`, manifest(`recipes/${kind}`, [], 'recipe', `recipes/${kind}.json`,
      [`bases/${kind}.json`, `overlays/${kind}.json`]));
    const source = kind === 'b' && differentSource ? 'parts/source/other' : 'parts/source/shared';
    await write(root, `bases/${kind}.json`, { kind: 'base', source, target: `parts/target/${kind}`,
      runArgs: { factor: 1, ...(irrelevantArgs ? { extra: kind } : {}) }, viewArgs: {} });
    await write(root, `bases/${kind}/nctk.json`, manifest(`bases/${kind}`, [], 'base', `bases/${kind}.json`, [source, `parts/target/${kind}`]));
    await write(root, `overlays/${kind}.json`, { kind: 'overlay', base: `bases/${kind}.json`,
      runArgs: kind === 'b' && conflictingArgs ? { factor: 2 } : {}, viewArgs: {} });
    await write(root, `overlays/${kind}/nctk.json`, manifest(`overlays/${kind}`, [], 'overlay', `overlays/${kind}.json`, [`bases/${kind}.json`]));
    await write(root, `parts/target/${kind}/part.json`, { kind: 'derived' });
    await write(root, `parts/target/${kind}/nctk.json`, manifest(`parts/target/${kind}`, [], 'part', `parts/target/${kind}/part.json`));
  }
  for (const name of ['shared', 'other']) {
    const address = `parts/source/${name}`, path = `fixtures/${name}.txt`;
    await write(root, `${address}/part.json`, { kind: 'source', materializer: 'fixture-file', path,
      sha256: await fileHash(join(root, path)) });
    await write(root, `${address}/nctk.json`, manifest(address, [], 'part', `${address}/part.json`));
  }
  await write(root, 'parts/shared/part.json', { kind: 'derived' });
  await write(root, 'parts/shared/nctk.json', manifest('parts/shared', [], 'part', 'parts/shared/part.json'));
  const calculations = [
    ['shared-a', 'parts/source/shared', 'parts/shared', 'SA', ['factor']],
    ...(variantProducers ? [['shared-b', 'parts/source/shared', 'parts/shared', 'SB', ['factor']]] : []),
    ['target-a', 'parts/shared', 'parts/target/a', 'A', []],
    ['target-b', differentSource ? 'parts/source/other' : 'parts/shared', 'parts/target/b', 'B', []],
  ];
  for (const [name, input, output, marker, runArgs] of calculations) {
    const address = `calculations/${name}`;
    await write(root, `${address}/calculation.json`, { inputs: [input], outputs: [output], script: 'calculate.mjs',
      runArgs, viewArgs: [], runtime: 'test-runtime' });
    await write(root, `${address}/nctk.json`, manifest(address, [], 'calculation', `${address}/calculation.json`, [input, output]));
    await write(root, `${address}/calculate.mjs`, `import {readFile,writeFile} from 'node:fs/promises';\n` +
      `import {join} from 'node:path';\nexport async function calculate({inputs,outputDir,args}){` +
      (name.startsWith('shared') && irrelevantArgs ? `if(Object.keys(args).sort().join(',')!=='factor')throw Error('undeclared argument leaked');` : '') +
      `const input=await readFile(inputs[${JSON.stringify(input)}].files[0],'utf8');` +
      `const path=join(outputDir,'result.txt');await writeFile(path,input+'>${marker}'+${runArgs.length ? 'args.factor' : "''"});return {files:[path]};}`);
  }
  return { root, source: { path: join(root, 'fixtures/shared.txt'), sha256: await fileHash(join(root, 'fixtures/shared.txt')) },
    runtime: { identities: { 'test-runtime': 'test-v1' } }, stages: [stage('A'), stage('B')] };
}

test('two Stages share one upstream Calculation; separate Stage reuses its exact receipt', async () => {
  const { root, source, runtime, stages } = await fixture();
  await assert.rejects(kompoze(root, 'recipes/a.json', { runArgs: {}, viewArgs: {} }), /Ambiguous producer/);
  await assert.rejects(kompozeStageSet(root, stages), /Explicit producer binding required/);
  const selected = await kompozeStageSet(root, stages, { producerBindings: { 'parts/shared': 'calculations/shared-a' } });
  assert.deepEqual(selected.ordered.map(node => node.address),
    ['calculations/shared-a', 'calculations/target-a', 'calculations/target-b']);
  const first = await crispStageSet(root, selected, source, runtime);
  assert.deepEqual(first.actions.map(action => action.decision), ['RUN', 'RUN', 'RUN']);
  assert.equal(await readFile(first.targets.A.files[0], 'utf8'), 'seed>SA1>A');
  assert.equal(await readFile(first.targets.B.files[0], 'utf8'), 'seed>SA1>B');
  const solo = await kompozeStageSet(root, [stages[0]], { producerBindings: { 'parts/shared': 'calculations/shared-a' } });
  const second = await crispStageSet(root, solo, source, runtime);
  assert.deepEqual(second.actions.map(action => action.decision), ['REUSE', 'REUSE']);
  assert.equal(second.actions[0].receiptSha256, first.actions[0].receiptSha256);
  assert.equal(second.actions[1].receiptSha256, first.actions[1].receiptSha256);
});

test('changed source invalidates shared and both downstream; alternate producer invalidates dependent results', async () => {
  const { root, source, runtime, stages } = await fixture();
  const bindingsA = { producerBindings: { 'parts/shared': 'calculations/shared-a' } };
  await crispStageSet(root, await kompozeStageSet(root, stages, bindingsA), source, runtime);
  await write(root, 'fixtures/shared.txt', 'changed');
  const currentSha = await fileHash(join(root, 'fixtures/shared.txt'));
  const contract = JSON.parse(await readFile(join(root, 'parts/source/shared/part.json')));
  contract.sha256 = currentSha;
  await write(root, 'parts/source/shared/part.json', contract);
  const changedSource = { path: source.path, sha256: currentSha };
  const changed = await crispStageSet(root, await kompozeStageSet(root, stages, bindingsA), changedSource, runtime);
  assert.deepEqual(changed.actions.map(action => action.decision), ['RUN', 'RUN', 'RUN']);
  const alternate = await crispStageSet(root, await kompozeStageSet(root, stages,
    { producerBindings: { 'parts/shared': 'calculations/shared-b' } }), changedSource, runtime);
  assert.deepEqual(alternate.actions.map(action => action.decision), ['RUN', 'RUN', 'RUN']);
  assert.equal(await readFile(alternate.targets.A.files[0], 'utf8'), 'changed>SB1>A');
  assert.equal(await readFile(alternate.targets.B.files[0], 'utf8'), 'changed>SB1>B');
});

test('Stage-set rejects bad bindings, conflicting shared Run Args, cycles, and unmatched sources', async () => {
  const normal = await fixture();
  await assert.rejects(kompozeStageSet(normal.root, normal.stages,
    { producerBindings: { 'parts/shared': 'calculations/missing' } }), /does not produce/);
  const conflict = await fixture({ conflictingArgs: true });
  await assert.rejects(kompozeStageSet(conflict.root, conflict.stages,
    { producerBindings: { 'parts/shared': 'calculations/shared-a' } }), /Conflicting shared Run Args/);
  const sources = await fixture({ differentSource: true });
  await assert.rejects(kompozeStageSet(sources.root, sources.stages,
    { producerBindings: { 'parts/shared': 'calculations/shared-a' } }), /Unmatched source contracts/);
  const cycle = await fixture();
  const calcPath = 'calculations/shared-a/calculation.json';
  const contract = JSON.parse(await readFile(join(cycle.root, calcPath)));
  contract.inputs = ['parts/target/a'];
  await write(cycle.root, calcPath, contract);
  const policyPath = 'calculations/shared-a/nctk.json', policy = JSON.parse(await readFile(join(cycle.root, policyPath)));
  policy.policies.kompoze.references = ['parts/target/a', 'parts/shared'];
  await write(cycle.root, policyPath, policy);
  await assert.rejects(kompozeStageSet(cycle.root, cycle.stages,
    { producerBindings: { 'parts/shared': 'calculations/shared-a' } }), /Dependency cycle/);
});

test('unstarted unrelated Part does not block Stage A/B, but a selected open target fails', async () => {
  const { root, stages, source, runtime } = await fixture({ unstarted: true });
  const bindings = { producerBindings: { 'parts/shared': 'calculations/shared-a' } };
  const plan = await kompozeStageSet(root, stages, bindings);
  const result = await crispStageSet(root, plan, source, runtime);
  assert.equal(await readFile(result.targets.B.files[0], 'utf8'), 'seed>SA1>B');
  const basePath = 'bases/a.json', base = JSON.parse(await readFile(join(root, basePath)));
  base.target = 'parts/open';
  await write(root, basePath, base);
  const manifestPath = 'bases/a/nctk.json', policy = JSON.parse(await readFile(join(root, manifestPath)));
  policy.policies.kompoze.references = ['parts/source/shared', 'parts/open'];
  await write(root, manifestPath, policy);
  await assert.rejects(kompozeStageSet(root, stages, bindings), /Open Part without producer/);
});

test('Stage-specific irrelevant Run Args do not leak into shared Calculation execution', async () => {
  const { root, stages, source, runtime } = await fixture({ irrelevantArgs: true });
  const selected = await kompozeStageSet(root, stages,
    { producerBindings: { 'parts/shared': 'calculations/shared-a' } });
  const result = await crispStageSet(root, selected, source, runtime);
  assert.equal(await readFile(result.targets.A.files[0], 'utf8'), 'seed>SA1>A');
  assert.equal(await readFile(result.targets.B.files[0], 'utf8'), 'seed>SA1>B');
});

test('ordinary Crisp passes only fingerprinted Run/View Args and reuses when undeclared args change', async () => {
  const { root, source, runtime } = await fixture({ irrelevantArgs: true, variantProducers: false });
  const firstPlan = await kompoze(root, 'recipes/a.json', { runArgs: {}, viewArgs: {} });
  const first = await crisp(root, firstPlan, source, runtime);
  assert.deepEqual(first.actions.map(action => action.decision), ['RUN', 'RUN']);
  assert.equal(await readFile(first.target.files[0], 'utf8'), 'seed>SA1>A');

  const basePath = 'bases/a.json', base = JSON.parse(await readFile(join(root, basePath)));
  base.runArgs.extra = 'changed-but-undeclared-by-this-Calculation';
  await write(root, basePath, base);
  const secondPlan = await kompoze(root, 'recipes/a.json', { runArgs: {}, viewArgs: {} });
  const second = await crisp(root, secondPlan, source, runtime);
  assert.deepEqual(second.actions.map(action => action.decision), ['REUSE', 'REUSE']);
  assert.deepEqual(second.actions.map(action => action.fingerprint), first.actions.map(action => action.fingerprint));
  assert.equal(await readFile(second.target.files[0], 'utf8'), 'seed>SA1>A');
});
