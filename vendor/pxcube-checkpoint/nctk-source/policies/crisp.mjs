import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, fileHash, safePath, sha } from '../facts.mjs';
import { eligibility } from './tidy.mjs';

const stamp = () => `${new Date().toISOString().replaceAll(/[:.]/g, '')}-${randomUUID().slice(0, 8)}`;
const relativeImports = text => [...text.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g), ...text.matchAll(/import\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(match => match[1]);
async function sourceClosure(root, paths) {
  const seen = new Set();
  async function visit(path) {
    if (seen.has(path)) return;
    const full = safePath(root, path), text = await readFile(full, 'utf8');
    seen.add(path);
    for (const specifier of relativeImports(text)) {
      const child = relative(root, resolve(dirname(full), specifier)).replaceAll('\\', '/');
      await visit(child);
    }
  }
  for (const path of paths) await visit(path);
  return Object.fromEntries(await Promise.all([...seen].sort().map(async path => [path, await fileHash(safePath(root, path))])));
}
export async function actionIdentity(root, resolved, node, inputs, runtimeIdentities) {
  const nodeConfig = resolved.nodeArgs?.get(node.address) ?? resolved;
  const args = Object.fromEntries(node.contract.runArgs.map(key => [key, nodeConfig.runArgs[key]]));
  const viewArgs = Object.fromEntries(node.contract.viewArgs.map(key => [key, nodeConfig.viewArgs[key]]));
  const outputAddress = node.contract.outputs[0];
  const inputIds = Object.fromEntries(Object.entries(inputs).map(([address, part]) => [address, part.contentId]));
  const runtimeIdentity = runtimeIdentities[node.contract.runtime];
  if (!runtimeIdentity) throw Error(`Missing runtime identity: ${node.contract.runtime}`);
  const fingerprint = sha(canonical({ calculation: node.address, contract: node.hash, code: node.scriptHash,
    outputContract: resolved.parts.get(outputAddress).hash, inputs: inputIds,
    sourceClosure: await sourceClosure(root, [node.script, ...(node.contract.sourceFiles ?? [])]),
    args, viewArgs, runtime: runtimeIdentity }));
  return { fingerprint, inputIds, args, viewArgs, runtimeIdentity };
}
export async function crisp(root, resolved, source, runtime) {
  if (resolved.stageTargets && (await fileHash(source.path) !== source.sha256 ||
      resolved.source.contract.sha256 && resolved.source.contract.sha256 !== source.sha256)) throw Error('Stage-set source differs from declared Part');
  const available = new Map([[resolved.source.address, {
    files: [source.path], contentId: sha(canonical({ contract: resolved.source.hash, media: source.sha256 }))
  }]]);
  const actions = [];
  for (const node of resolved.ordered) {
    const inputs = Object.fromEntries(node.contract.inputs.map(address => [address, available.get(address)]));
    const outputAddress = node.contract.outputs[0];
    const { fingerprint, inputIds, args, viewArgs, runtimeIdentity } = await actionIdentity(root, resolved, node, inputs, runtime.identities);
    const decision = await eligibility(root, node, fingerprint);
    let receipt = decision.receipt, receiptPath = decision.receiptPath, receiptSha256 = decision.receiptSha256;
    if (decision.decision === 'RUN') {
      const attempt = stamp();
      const outputDir = join(root, 'work/attempts', attempt, outputAddress);
      await mkdir(outputDir, { recursive: true });
      const record = { schema: 'nctk-part-attempt@1', calculation: node.address, output: outputAddress,
        fingerprint, inputs: inputIds,
        args, viewArgs, runtime: runtimeIdentity, execution: 'FAIL', outputs: [] };
      try {
        const implementation = await import(pathToFileURL(join(root, node.script)).href);
        const result = await implementation.calculate({ inputs, outputDir,
          args, viewArgs, runtime });
        for (const file of result.files) {
          const path = relative(root, file).replaceAll('\\', '/');
          record.outputs.push({ path, sha256: await fileHash(file), size: (await readFile(file)).length });
        }
        record.observation = result.observation;
        record.execution = 'PASS';
      } catch (error) { record.error = String(error.stack ?? error); }
      const receiptDir = join(root, 'work/receipts', node.address.replaceAll('/', '__'));
      await mkdir(receiptDir, { recursive: true });
      receiptPath = `work/receipts/${node.address.replaceAll('/', '__')}/${attempt}.json`;
      await writeFile(safePath(root, receiptPath), JSON.stringify(record, null, 2) + '\n');
      if (record.execution !== 'PASS') throw Error(`${node.address} failed: ${record.error}`);
      receipt = record;
      receiptSha256 = await fileHash(safePath(root, receiptPath));
    }
    const contentId = sha(canonical(receipt.outputs.map(output => [output.path, output.sha256])));
    available.set(outputAddress, { files: receipt.outputs.map(output => join(root, output.path)), contentId });
    actions.push({ calculation: node.address, part: outputAddress, decision: decision.decision,
      reason: decision.reason, fingerprint, receiptPath, receiptSha256,
      outputs: receipt.outputs, observation: receipt.observation ?? null });
  }
  const targets = resolved.stageTargets ? Object.fromEntries(Object.entries(resolved.stageTargets).map(([name, address]) => [name, {
    address, ...available.get(address) }])) : undefined;
  return { actions, target: available.get(resolved.target), targets, source: available.get(resolved.source.address) };
}

export async function crispStageSet(root, stageSet, source, runtime) {
  if (!stageSet.stageTargets) throw Error('Crisp Stage-set needs a Kompoze Stage-set plan');
  return crisp(root, stageSet, source, runtime);
}

/** Execute the selected Kompoze graph and bind Crisp's real action receipts to its queue plan. */
export async function crispMergeQueue(root, selected, source, runtime) {
  const result = await crisp(root, selected.resolved, source, runtime);
  if (!result.target?.files?.length || result.actions.length !== selected.resolved.ordered.length) throw Error('Crisp did not materialize selected target');
  const path = `work/merge-runs/crisp-${randomUUID()}.json`;
  await mkdir(join(root, 'work/merge-runs'), { recursive: true });
  const testimony = { schema: 'crisp-merge-run@1', recipePath: selected.plan.recipePath,
    planId: selected.planId, planPath: selected.path, planSha256: selected.sha256,
    graphId: selected.plan.graphId, entries: selected.plan.entries.map(({ workItem, candidateSha256 }) => ({ workItem, candidateSha256 })),
    runtimeIdentities: runtime.identities,
    source: { path: relative(root, source.path).replaceAll('\\', '/'), sha256: source.sha256 },
    actions: result.actions,
    target: { address: selected.resolved.target, outputs: await Promise.all(result.target.files.map(async path => ({
      path: relative(root, path).replaceAll('\\', '/'), sha256: await fileHash(path) }))) } };
  await writeFile(safePath(root, path), JSON.stringify(testimony, null, 2) + '\n');
  return { result, testimony, path, sha256: await fileHash(safePath(root, path)) };
}
