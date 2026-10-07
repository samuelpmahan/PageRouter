import { compile } from '../facts.mjs';
import { canonical, fileHash, safePath, sha } from '../facts.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { manifestForSource, validateDirectoryTree } from './tidy.mjs';
import { itemFor, state } from './neat.mjs';
import { verifyCandidate } from './candidate.mjs';

// Resolve a selected clean base and its explicit overlay into one compiled graph.
export async function kompoze(root, recipePath, overrides) {
  await validateDirectoryTree(root);
  return compile(root, recipePath, overrides);
}

/** Compose named recipe Stages into one explicit union DAG, without type dispatch. */
export async function kompozeStageSet(root, stages, { producerBindings = {} } = {}) {
  if (!Array.isArray(stages) || !stages.length || new Set(stages.map(stage => stage.name)).size !== stages.length ||
      stages.some(stage => !stage.name || !stage.recipePath)) throw Error('Stage set needs unique named recipe declarations');
  await validateDirectoryTree(root);
  const resolvedStages = [];
  for (const stage of stages) {
    const resolved = await compile(root, stage.recipePath, stage.overrides ?? { runArgs: {}, viewArgs: {} },
      { allowVariants: true, producerBindings, strictBindings: false });
    resolvedStages.push({ name: stage.name, resolved });
  }
  const first = resolvedStages[0].resolved, ordered = [], seen = new Map(), nodeArgs = new Map(), stageTargets = {};
  const usedBindings = new Set();
  for (const { name, resolved } of resolvedStages) {
    if (resolved.source.address !== first.source.address || resolved.source.hash !== first.source.hash ||
        resolved.source.contract.sha256 !== first.source.contract.sha256) throw Error(`Unmatched source contracts in Stage ${name}`);
    stageTargets[name] = resolved.target;
    for (const node of resolved.ordered) {
      const output = node.contract.outputs[0];
      if (producerBindings[output]) usedBindings.add(output);
      const prior = seen.get(node.address);
      const relevantArgs = Object.fromEntries(node.contract.runArgs.map(key => [key, resolved.runArgs[key]]));
      const relevantViewArgs = Object.fromEntries(node.contract.viewArgs.map(key => [key, resolved.viewArgs[key]]));
      if (prior) {
        if (canonical(prior.args) !== canonical(relevantArgs)) throw Error(`Conflicting shared Run Args for ${node.address}`);
        if (canonical(prior.viewArgs) !== canonical(relevantViewArgs)) throw Error(`Conflicting shared View Args for ${node.address}`);
      } else {
        seen.set(node.address, { args: relevantArgs, viewArgs: relevantViewArgs });
        nodeArgs.set(node.address, { runArgs: resolved.runArgs, viewArgs: resolved.viewArgs });
        ordered.push(node);
      }
    }
  }
  for (const address of Object.keys(producerBindings)) if (!usedBindings.has(address)) throw Error(`Unused Stage-set producer binding for ${address}`);
  return { ...first, ordered, nodeArgs, stageTargets, stages: resolvedStages.map(({ name, resolved }) => ({
    name, recipePath: resolved.recipePath, base: resolved.recipe.base, overlay: resolved.recipe.overlay,
    source: resolved.source.address, target: resolved.target })), producerBindings };
}

/** Select approved queued candidates and prove their addressed files occur in one compiled recipe. */
export async function inspectMergeQueue(root, recipePath, workItems, overrides = { runArgs: {}, viewArgs: {} }) {
  if (!Array.isArray(workItems) || !workItems.length || new Set(workItems).size !== workItems.length) throw Error('Select unique queued work items');
  const resolved = await kompoze(root, recipePath, overrides), snapshot = await state(root);
  const selectedParts = new Set([resolved.source.address, resolved.target,
    ...resolved.ordered.flatMap(node => [...node.contract.inputs, ...node.contract.outputs])]);
  const selectedAddresses = new Set([...(await Promise.all([recipePath, resolved.recipe.base, resolved.recipe.overlay]
    .map(async path => (await manifestForSource(root, path)).manifest.address))),
    ...selectedParts, ...resolved.ordered.map(node => node.address)]);
  const entries = [], claimed = new Set();
  for (const workItem of [...workItems].sort()) {
    const item = itemFor(snapshot, workItem), review = item.review, approval = item.approval;
    if (item.state !== 'Merge' || approval?.verdict !== 'APPROVE' || !review ||
        review.target !== recipePath || approval.candidateSha256 !== review.candidateSha256 ||
        approval.target !== recipePath) throw Error(`Work item is not approved and queued for recipe: ${workItem}`);
    const { checkpoint } = await verifyCandidate(root, review.checkpointPath,
      { workItem, target: recipePath, candidateSha256: review.candidateSha256 });
    for (const address of checkpoint.affectedAddresses) {
      if (!selectedAddresses.has(address)) throw Error(`Candidate address is not in selected recipe graph: ${address}`);
      if (claimed.has(address)) throw Error(`Candidate address conflict: ${address}`);
      claimed.add(address);
    }
    entries.push({ workItem, candidateSha256: review.candidateSha256,
      checkpointPath: review.checkpointPath, affectedAddresses: checkpoint.affectedAddresses,
      dependsOn: checkpoint.dependsOn, claims: checkpoint.claims });
  }
  const selected = new Map(entries.map(entry => [entry.workItem, entry]));
  const visiting = new Set(), visited = new Set();
  function visit(path) {
    if (visiting.has(path)) throw Error('Queued candidate dependency cycle');
    if (visited.has(path)) return;
    visiting.add(path);
    for (const dependency of selected.get(path).dependsOn) {
      const included = selected.get(dependency.workItem);
      if (included) {
        if (included.candidateSha256 !== dependency.candidateSha256) throw Error('Queued dependency candidate differs');
        visit(dependency.workItem);
      } else {
        const prior = itemFor(snapshot, dependency.workItem);
        if (prior.state !== 'Merged' || prior.promotion?.candidateSha256 !== dependency.candidateSha256) throw Error('Queued dependency is not included or Merged');
      }
    }
    visiting.delete(path); visited.add(path);
  }
  for (const path of selected.keys()) visit(path);
  const graph = { recipe: recipePath, base: resolved.recipe.base, overlay: resolved.recipe.overlay,
    source: resolved.source.address, target: resolved.target,
    runArgs: resolved.runArgs, viewArgs: resolved.viewArgs,
    calculations: resolved.ordered.map(node => ({ address: node.address, contractHash: node.hash, scriptHash: node.scriptHash })),
    parts: [...selectedParts].sort().map(address => ({ address, hash: resolved.parts.get(address).hash })),
    bindings: await Promise.all([recipePath, resolved.recipe.base, resolved.recipe.overlay].map(async path => ({ path, sha256: await fileHash(safePath(root, path)) }))) };
  const plan = { schema: 'kompoze-merge-plan@1', recipePath, entries, graph, graphId: sha(canonical(graph)) };
  return { resolved, plan, planId: sha(canonical(plan)) };
}

export async function kompozeMergeQueue(root, recipePath, workItems, overrides) {
  const selected = await inspectMergeQueue(root, recipePath, workItems, overrides);
  const path = `work/merge-plans/plan-${randomUUID()}.json`;
  await mkdir(join(root, 'work/merge-plans'), { recursive: true });
  await writeFile(safePath(root, path), JSON.stringify({ ...selected.plan, planId: selected.planId }, null, 2) + '\n');
  return { ...selected, path, sha256: await fileHash(safePath(root, path)) };
}
