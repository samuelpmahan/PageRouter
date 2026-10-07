import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileHash } from '../facts.mjs';
import { captureCandidate } from '../policies/candidate.mjs';
import { beginMerge, completeMergeBatch, decideReview, itemFor, openReview, state } from '../policies/neat.mjs';
import { inspectMergeQueue } from '../policies/kompoze.mjs';
import { runMergeQueue } from '../capabilities/merge_release.mjs';
import { stageFrozenMergeInputs } from '../capabilities/smartsync.mjs';

const RECIPE = 'recipes/fixture.json';
const manifest = (address, children, kind, source = null, refs = [], neat = { mode: 'none' }) => ({
  schema: 'nctk-directory@1', address, children, kind, source,
  policies: { neat, crisp: { mode: 'none' }, tidy: { mode: 'local' },
    kompoze: { mode: source ? 'local' : 'none', references: refs } },
});
async function write(root, path, value) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof value === 'string' ? value : JSON.stringify(value));
}
async function fixture(failAt = 0) {
  const root = await mkdtemp(join(tmpdir(), 'merge-real-'));
  await write(root, 'version.json', { x: 5, y: 0, z: 0, changeKind: 'meaning', taskId: 'merge-real' });
  await write(root, 'fixtures/source.txt', 'start');
  await write(root, 'nctk.json', manifest('.', ['bases', 'calculations', 'overlays', 'parts', 'recipes'], 'group', null, [],
    { mode: 'local', role: 'batch-journal', state: 'Compare', mergedBatches: [] }));
  await write(root, 'bases/nctk.json', manifest('bases', ['bases/fixture'], 'group'));
  await write(root, 'calculations/nctk.json', manifest('calculations', [1, 2, 3, 4].map(n => `calculations/step${n}`), 'group'));
  await write(root, 'overlays/nctk.json', manifest('overlays', ['overlays/fixture'], 'group'));
  await write(root, 'parts/nctk.json', manifest('parts', ['parts/source', ...[1, 2, 3, 4].map(n => `parts/step${n}`)], 'group'));
  await write(root, 'parts/source/nctk.json', manifest('parts/source', ['parts/source/fixture'], 'group'));
  await write(root, 'recipes/nctk.json', manifest('recipes', ['recipes/fixture'], 'group'));
  await write(root, RECIPE, { kind: 'recipe', base: 'bases/fixture.json', overlay: 'overlays/fixture.json' });
  await write(root, 'recipes/fixture/nctk.json', manifest('recipes/fixture', [], 'recipe', RECIPE,
    ['bases/fixture.json', 'overlays/fixture.json'], { mode: 'local', state: 'Combine', phase: 'Combine', substates: {} }));
  await write(root, 'bases/fixture.json', { kind: 'base', source: 'parts/source/fixture', target: 'parts/step4', runArgs: {}, viewArgs: {} });
  await write(root, 'bases/fixture/nctk.json', manifest('bases/fixture', [], 'base', 'bases/fixture.json',
    ['parts/source/fixture', 'parts/step4']));
  await write(root, 'overlays/fixture.json', { kind: 'overlay', base: 'bases/fixture.json', runArgs: {}, viewArgs: {} });
  await write(root, 'overlays/fixture/nctk.json', manifest('overlays/fixture', [], 'overlay', 'overlays/fixture.json',
    ['bases/fixture.json']));
  await write(root, 'parts/source/fixture/part.json', { kind: 'source', materializer: 'fixture-file', path: 'fixtures/source.txt',
    sha256: await fileHash(join(root, 'fixtures/source.txt')) });
  await write(root, 'parts/source/fixture/nctk.json', manifest('parts/source/fixture', [], 'part', 'parts/source/fixture/part.json'));
  for (let n = 1; n <= 4; n++) {
    const input = n === 1 ? 'parts/source/fixture' : `parts/step${n - 1}`;
    const output = `parts/step${n}`;
    await write(root, `${output}/part.json`, { kind: 'derived' });
    await write(root, `${output}/nctk.json`, manifest(output, [], 'part', `${output}/part.json`));
    await write(root, `calculations/step${n}/calculation.json`, {
      inputs: [input], outputs: [output], script: 'calculate.mjs', runArgs: [], viewArgs: [], runtime: 'test-runtime',
    });
    await write(root, `calculations/step${n}/nctk.json`, manifest(`calculations/step${n}`, [], 'calculation',
      `calculations/step${n}/calculation.json`, [input, output]));
    const code = failAt === n ? `export async function calculate(){ throw Error('intentional failure ${n}'); }` :
      `import {readFile,writeFile} from 'node:fs/promises';\nimport {join} from 'node:path';\n` +
      `export async function calculate({inputs,outputDir}){const input=await readFile(inputs[${JSON.stringify(input)}].files[0],'utf8');` +
      `const path=join(outputDir,'result.txt');await writeFile(path,input+'>${n}');return {files:[path]};}`;
    await write(root, `calculations/step${n}/calculate.mjs`, code);
  }
  const items = [];
  for (let n = 1; n <= 4; n++) {
    const workItem = `work/items/child${n}.json`;
    await write(root, workItem, { child: n });
    const dependsOn = n === 1 ? [] : [{ workItem: items[n - 2].workItem, candidateSha256: items[n - 2].candidateSha256 }];
    const captured = await captureCandidate(root, `work/candidates/child${n}.json`, {
      workItem, target: RECIPE, affectedAddresses: [`calculations/step${n}`], dependsOn });
    await openReview(root, workItem, { candidateSha256: captured.candidateSha256,
      checkpointPath: captured.checkpointPath, target: RECIPE, affectedAddresses: [`calculations/step${n}`], dependsOn,
      evidence: [{ path: captured.checkpointPath, sha256: captured.candidateSha256 }] });
    await decideReview(root, workItem, { candidateSha256: captured.candidateSha256, target: RECIPE,
      verdict: 'APPROVE', actor: 'fixture reviewer' });
    await beginMerge(root, workItem, { candidateSha256: captured.candidateSha256, target: RECIPE });
    items.push({ workItem, ...captured });
  }
  return { root, items, source: { path: join(root, 'fixtures/source.txt'), sha256: await fileHash(join(root, 'fixtures/source.txt')) },
    runtime: { identities: { 'test-runtime': 'test-v1' } } };
}

test('four queued children execute real Calculations; one batch marks them Merged and leaves parent Combine', async () => {
  const { root, items, source, runtime } = await fixture();
  const result = await runMergeQueue(root, RECIPE, items.map(item => item.workItem), source, runtime);
  assert.equal((await readFile(join(root, result.targetOutputs[0].path), 'utf8')), 'start>1>2>3>4');
  const crisp = JSON.parse(await readFile(join(root, result.crisp)));
  assert.deepEqual(crisp.actions.map(action => action.decision), ['RUN', 'RUN', 'RUN', 'RUN']);
  const snapshot = await state(root);
  for (const item of items) assert.equal(itemFor(snapshot, item.workItem).state, 'Merged');
  assert.equal(itemFor(snapshot, RECIPE).state, 'Combine');
  const journal = JSON.parse(await readFile(join(root, 'nctk.json'))).policies.neat.mergedBatches;
  assert.equal(journal.length, 1);
  assert.equal(journal[0].entries.length, 4);
});

test('fresh SmartSync copy carries only frozen queued JSON and can run all four Calculations', async () => {
  const { root, items, runtime } = await fixture();
  const destination = await mkdtemp(join(tmpdir(), 'merge-fresh-'));
  await cp(root, destination, { recursive: true, force: true,
    filter: path => path === root || !path.startsWith(join(root, 'work')) });
  await mkdir(join(destination, 'state'));
  await writeFile(join(destination, 'state/lifecycle.json'), JSON.stringify(await state(root)));
  const staged = await stageFrozenMergeInputs(root, destination, RECIPE);
  assert.equal(staged.length, 8, 'four work-item files and four candidate checkpoints');
  assert(staged.every(entry => entry.classification === 'frozen-merge-input' && entry.path.endsWith('.json')));
  const source = { path: join(destination, 'fixtures/source.txt'), sha256: await fileHash(join(destination, 'fixtures/source.txt')) };
  const result = await runMergeQueue(destination, RECIPE, items.map(item => item.workItem), source, runtime);
  assert.equal(await readFile(join(destination, result.targetOutputs[0].path), 'utf8'), 'start>1>2>3>4');
  for (const item of items) assert.equal(itemFor(await state(destination), item.workItem).state, 'Merged');
});

test('SmartSync rejects a symlinked parent of a frozen checkpoint', async () => {
  const { root } = await fixture();
  await rename(join(root, 'work/candidates'), join(root, 'work/candidates-real'));
  await symlink('candidates-real', join(root, 'work/candidates'), 'dir');
  const destination = await mkdtemp(join(tmpdir(), 'merge-symlink-'));
  await assert.rejects(stageFrozenMergeInputs(root, destination, RECIPE), /Symlink or non-directory parent/);
});

test('candidate tamper, omitted dependency, and overlapping address claims fail before integration', async () => {
  const { root, items } = await fixture();
  await assert.rejects(inspectMergeQueue(root, RECIPE, items.filter((_, n) => n !== 2).map(item => item.workItem)), /dependency is not included/);
  const extra = 'work/items/conflict.json';
  await write(root, extra, {});
  const conflict = await captureCandidate(root, 'work/candidates/conflict.json', {
    workItem: extra, target: RECIPE, affectedAddresses: ['calculations/step1'] });
  await openReview(root, extra, { candidateSha256: conflict.candidateSha256, checkpointPath: conflict.checkpointPath,
    target: RECIPE, affectedAddresses: ['calculations/step1'], evidence: [{ path: conflict.checkpointPath, sha256: conflict.candidateSha256 }] });
  await decideReview(root, extra, { candidateSha256: conflict.candidateSha256, target: RECIPE,
    verdict: 'APPROVE', actor: 'fixture reviewer' });
  await beginMerge(root, extra, { candidateSha256: conflict.candidateSha256, target: RECIPE });
  await assert.rejects(inspectMergeQueue(root, RECIPE, [...items.map(item => item.workItem), extra]), /address conflict/);
  await write(root, 'calculations/step2/calculate.mjs', 'tampered');
  await assert.rejects(inspectMergeQueue(root, RECIPE, items.map(item => item.workItem)), /authored bytes changed/);
});

test('a failing Calculation leaves all children queued without a Merged journal', async () => {
  const { root, items, source, runtime } = await fixture(3);
  await assert.rejects(runMergeQueue(root, RECIPE, items.map(item => item.workItem), source, runtime), /intentional failure 3/);
  for (const item of items) assert.equal(itemFor(await state(root), item.workItem).state, 'Merge');
  assert.equal(JSON.parse(await readFile(join(root, 'nctk.json'))).policies.neat.mergedBatches.length, 0);
});

test('verified REUSE names prior action receipts; source declaration mismatch fails before Crisp', async () => {
  const { root, items, source, runtime } = await fixture();
  const workItems = items.map(item => item.workItem);
  const first = await runMergeQueue(root, RECIPE, workItems, source, runtime,
    { runArgs: {}, viewArgs: {} }, { promote: false });
  const second = await runMergeQueue(root, RECIPE, workItems, source, runtime,
    { runArgs: {}, viewArgs: {} }, { promote: false });
  const firstRun = JSON.parse(await readFile(join(root, first.crisp)));
  const reused = JSON.parse(await readFile(join(root, second.crisp)));
  assert.deepEqual(reused.actions.map(action => action.decision), ['REUSE', 'REUSE', 'REUSE', 'REUSE']);
  assert.deepEqual(reused.actions.map(action => action.receiptSha256), firstRun.actions.map(action => action.receiptSha256));
  await completeMergeBatch(root, { receiptPath: second.receiptPath, receiptSha256: second.receiptSha256 });
  assert.equal(itemFor(await state(root), workItems[0]).state, 'Merged');
  const mismatch = await fixture();
  await write(mismatch.root, 'fixtures/source.txt', 'unapproved source');
  await assert.rejects(runMergeQueue(mismatch.root, RECIPE, mismatch.items.map(item => item.workItem),
    { path: mismatch.source.path, sha256: await fileHash(mismatch.source.path) }, mismatch.runtime), /source differs/);
});

test('a forged Crisp input chain and fingerprint cannot promote despite PASS JSON', async () => {
  const { root, items, source, runtime } = await fixture();
  const built = await runMergeQueue(root, RECIPE, items.map(item => item.workItem), source, runtime,
    { runArgs: {}, viewArgs: {} }, { promote: false });
  const receiptPath = join(root, built.receiptPath), receipt = JSON.parse(await readFile(receiptPath));
  const crispPath = join(root, built.crisp), crisp = JSON.parse(await readFile(crispPath));
  const actionPath = join(root, crisp.actions[1].receiptPath), action = JSON.parse(await readFile(actionPath));
  action.inputs['parts/step1'] = '0'.repeat(64);
  action.fingerprint = '1'.repeat(64);
  await writeFile(actionPath, JSON.stringify(action));
  crisp.actions[1].fingerprint = action.fingerprint;
  crisp.actions[1].receiptSha256 = await fileHash(actionPath);
  await writeFile(crispPath, JSON.stringify(crisp));
  receipt.validation.crisp.sha256 = await fileHash(crispPath);
  const localciPath = join(root, receipt.validation.localci.path), localci = JSON.parse(await readFile(localciPath));
  localci.bindings.crisp.sha256 = receipt.validation.crisp.sha256;
  localci.crispSha256 = receipt.validation.crisp.sha256;
  await writeFile(localciPath, JSON.stringify(localci));
  receipt.validation.localci.sha256 = await fileHash(localciPath);
  await writeFile(receiptPath, JSON.stringify(receipt));
  await assert.rejects(completeMergeBatch(root, { receiptPath: built.receiptPath, receiptSha256: await fileHash(receiptPath) }),
    /Crisp action receipt differs/);
  for (const item of items) assert.equal(itemFor(await state(root), item.workItem).state, 'Merge');
});
