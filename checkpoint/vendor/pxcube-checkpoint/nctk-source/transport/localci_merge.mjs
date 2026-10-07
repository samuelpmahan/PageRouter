import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonical, fileHash, safePath, sha } from '../facts.mjs';
import { inspectMergeQueue } from '../policies/kompoze.mjs';
import { actionIdentity } from '../policies/crisp.mjs';
import { authoredAddressFiles, managedManifestFiles, managedSourceFiles, validateBuild } from '../policies/tidy.mjs';

const readBound = async (root, binding) => {
  if (!binding?.path || !binding.sha256 || await fileHash(safePath(root, binding.path)) !== binding.sha256) throw Error('Merge evidence file hash differs');
  return JSON.parse(await readFile(safePath(root, binding.path), 'utf8'));
};

/** Recheck Kompoze selection, Crisp action receipts and bytes, and full Tidy recipe identity. */
export async function verifyMergeEvidence(root, { plan: planBinding, crisp: crispBinding, tidy: tidyBinding }) {
  const plan = await readBound(root, planBinding);
  if (plan.schema !== 'kompoze-merge-plan@1' || !Array.isArray(plan.entries) || !plan.entries.length) throw Error('Invalid Kompoze merge plan');
  const selected = await inspectMergeQueue(root, plan.recipePath, plan.entries.map(entry => entry.workItem),
    { runArgs: plan.graph.runArgs, viewArgs: plan.graph.viewArgs });
  if (canonical(plan) !== canonical({ ...selected.plan, planId: selected.planId })) throw Error('Kompoze plan no longer matches queued candidates or graph');
  const crisp = await readBound(root, crispBinding);
  if (crisp.schema !== 'crisp-merge-run@1' || crisp.planId !== selected.planId ||
      crisp.planSha256 !== planBinding.sha256 || crisp.graphId !== plan.graphId ||
      crisp.recipePath !== plan.recipePath || crisp.planPath !== planBinding.path ||
      canonical(crisp.entries) !== canonical(plan.entries.map(({ workItem, candidateSha256 }) => ({ workItem, candidateSha256 })))) throw Error('Crisp run is not bound to Kompoze plan');
  if (await fileHash(safePath(root, crisp.source.path)) !== crisp.source.sha256) throw Error('Crisp source bytes changed');
  if (selected.resolved.source.contract.sha256 && selected.resolved.source.contract.sha256 !== crisp.source.sha256) throw Error('Crisp source differs from selected Part declaration');
  if (crisp.actions?.length !== selected.resolved.ordered.length) throw Error('Crisp action count differs from graph');
  const available = new Map([[selected.resolved.source.address, {
    contentId: sha(canonical({ contract: selected.resolved.source.hash, media: crisp.source.sha256 })) }]]);
  for (const [index, action] of crisp.actions.entries()) {
    const node = selected.resolved.ordered[index];
    if (action.calculation !== node.address || action.part !== node.contract.outputs[0] ||
        !['RUN', 'REUSE'].includes(action.decision)) throw Error('Crisp action is not in selected graph');
    const record = await readBound(root, { path: action.receiptPath, sha256: action.receiptSha256 });
    const inputs = Object.fromEntries(node.contract.inputs.map(address => [address, available.get(address)]));
    if (Object.values(inputs).some(value => !value)) throw Error('Crisp upstream Part is missing');
    const identity = await actionIdentity(root, selected.resolved, node, inputs, crisp.runtimeIdentities ?? {});
    if (record.execution !== 'PASS' || record.calculation !== action.calculation ||
        record.fingerprint !== identity.fingerprint || action.fingerprint !== identity.fingerprint ||
        canonical(record.inputs) !== canonical(identity.inputIds) ||
        canonical(record.args) !== canonical(identity.args) || canonical(record.viewArgs) !== canonical(identity.viewArgs) ||
        record.runtime !== identity.runtimeIdentity || record.output !== action.part ||
        canonical(record.outputs) !== canonical(action.outputs)) throw Error('Crisp action receipt differs');
    for (const output of action.outputs) if (await fileHash(safePath(root, output.path)) !== output.sha256) throw Error('Crisp output bytes changed');
    available.set(action.part, { contentId: sha(canonical(action.outputs.map(output => [output.path, output.sha256]))) });
  }
  const last = crisp.actions.at(-1);
  if (crisp.target?.address !== selected.resolved.target ||
      canonical(crisp.target.outputs) !== canonical(last.outputs.map(({ path, sha256 }) => ({ path, sha256 })))) throw Error('Crisp target differs from final action');
  const ledger = await readBound(root, tidyBinding);
  const required = new Set(await integrationFiles(root, selected.resolved));
  if (![...required].every(path => Object.hasOwn(ledger.identities ?? {}, path))) throw Error('Tidy ledger omits managed recipe closure');
  const current = await validateBuild(root, Object.keys(ledger.identities));
  if (current.contentId !== ledger.contentId || canonical(current.identities) !== canonical(ledger.identities)) throw Error('Tidy full recipe identity differs');
  return { target: plan.recipePath, entries: plan.entries.map(({ workItem, candidateSha256, affectedAddresses, dependsOn }) =>
    ({ workItem, candidateSha256, affectedAddresses, dependsOn })),
    planId: selected.planId, crispSha256: crispBinding.sha256, targetContentId: current.contentId,
    targetOutputs: crisp.target.outputs, actions: crisp.actions.map(({ calculation, decision, receiptSha256 }) =>
      ({ calculation, decision, receiptSha256 })) };
}

export async function integrationFiles(root, resolved) {
  const addresses = new Set([resolved.source.address, resolved.target,
    ...resolved.ordered.flatMap(node => [node.address, ...node.contract.inputs, ...node.contract.outputs])]);
  const paths = new Set(['version.json', ...await managedManifestFiles(root), ...await managedSourceFiles(root),
    resolved.recipePath, resolved.recipe.base, resolved.recipe.overlay,
    ...(await Promise.all([...addresses].map(address => authoredAddressFiles(root, address)))).flat()]);
  for (const path of ['README.md', 'facts.mjs', 'toolkit.mjs', 'policies/tidy.mjs', 'policies/neat.mjs',
    'policies/kompoze.mjs', 'policies/crisp.mjs', 'policies/candidate.mjs',
    'transport/localci_merge.mjs', 'capabilities/merge_release.mjs']) {
    if (await stat(safePath(root, path)).then(value => value.isFile()).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) paths.add(path);
  }
  return [...paths].sort();
}

export async function validateMergeRelease(root, bindings) {
  const verified = await verifyMergeEvidence(root, bindings);
  const receipt = { schema: 'localci-merge@1', verdict: 'PASS', bindings, ...verified };
  const path = `work/merge-runs/localci-${randomUUID()}.json`;
  await mkdir(join(root, 'work/merge-runs'), { recursive: true });
  await writeFile(safePath(root, path), JSON.stringify(receipt, null, 2) + '\n');
  return { receipt, path, sha256: await fileHash(safePath(root, path)) };
}
