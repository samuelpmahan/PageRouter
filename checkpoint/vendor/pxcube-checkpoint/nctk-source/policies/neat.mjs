import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileHash, safePath } from '../facts.mjs';
import { validateDirectoryTree } from './tidy.mjs';
import { verifyCandidate } from './candidate.mjs';

export const WORK_STATES = Object.freeze(['Compare', 'Combine', 'Validate', 'Review', 'Merge', 'Merged', 'Park', 'Reject']);
const GUARDED = new Set(['Review', 'Merge', 'Merged']);
const HASH = /^[a-f0-9]{64}$/;
const DEFAULT_ITEM = 'recipes/house-cut.json';
const LEGACY_PHASE = /^[A-Z][A-Z0-9_]*$/;
const NAMESPACE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*@\d+$/;
const now = () => new Date().toISOString();
const stateFor = phase => WORK_STATES.find(value => value.toLowerCase() === String(phase).toLowerCase());
const initialItem = (path, phase = 'Compare') => ({ path, state: stateFor(phase) ?? 'Compare', phase, relations: [], substates: {}, events: [] });
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
async function authoredItems(root) {
  try { await readFile(join(root, 'nctk.json')); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const tree = await validateDirectoryTree(root), result = new Map();
  for (const [address, { path, manifest }] of tree.manifests) {
    if (manifest.source && manifest.policies.neat.mode === 'local') result.set(manifest.source, { address, path, manifest });
  }
  return result;
}

function normalize(raw) {
  const path = raw.workPath ?? raw.activeItem ?? DEFAULT_ITEM;
  const items = { ...(raw.items ?? {}) };
  if (!own(items, path)) items[path] = initialItem(path, raw.phase ?? 'EXPERIMENT');
  for (const [key, value] of Object.entries(items)) {
    const item = value ?? {};
    items[key] = { ...initialItem(key, item.phase ?? 'EXPERIMENT'), ...item,
      path: key, state: stateFor(item.state) ?? stateFor(item.phase) ?? 'Compare',
      substates: { ...(item.substates ?? {}) }, events: [...(item.events ?? [])] };
  }
  for (const event of raw.events ?? []) {
    if (!event.workPath || !own(items, event.workPath)) continue;
    if (!items[event.workPath].events.some(value => value.at === event.at && value.phase === event.phase)) items[event.workPath].events.push(event);
  }
  if (raw.lastRun?.recipe) {
    const key = raw.lastRun.recipe;
    if (!own(items, key)) items[key] = initialItem(key);
    if (!items[key].lastRun) items[key].lastRun = raw.lastRun;
  }
  return { ...raw, schema: 'neat-work-state@2', activeItem: path, workPath: path,
    phase: raw.phase ?? items[path].phase, items, events: [...(raw.events ?? [])] };
}

async function writeState(root, value) {
  await mkdir(join(root, 'work'), { recursive: true });
  const temporary = join(root, 'work', `lifecycle-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
    await rename(temporary, join(root, 'work/lifecycle.json'));
  } finally { await rm(temporary, { force: true }); }
  return value;
}
async function commitBatch(root, batch) {
  const path = join(root, 'nctk.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.policies?.neat?.mode !== 'local' || manifest.policies.neat.role !== 'batch-journal') throw Error('Root Neat batch journal is not configured');
  const prior = manifest.policies.neat.mergedBatches ?? [];
  if (prior.some(entry => entry.receiptSha256 === batch.receiptSha256)) throw Error('Promotion batch already committed');
  const next = { ...manifest, policies: { ...manifest.policies,
    neat: { ...manifest.policies.neat, mergedBatches: [...prior, batch] } } };
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(next, null, 2) + '\n'); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
async function persistAuthoredItems(root, before, after) {
  for (const [source, { path, manifest }] of await authoredItems(root)) {
    const current = before.items[source], item = after.items[source];
    if (!item || !current || JSON.stringify(item) === JSON.stringify(current)) continue;
    const neat = { ...manifest.policies.neat, state: item.state, phase: item.phase,
      relations: item.relations ?? [], substates: item.substates, suggestions: item.suggestions ?? [] };
    for (const key of ['review', 'approval', 'promotion']) {
      if (item[key]) neat[key] = item[key];
      else delete neat[key];
    }
    if (item.lastRun?.report) {
      const sha256 = await fileHash(safePath(root, item.lastRun.report)).catch(() => null);
      if (sha256) neat.latestEvidence = { report: item.lastRun.report, sha256, at: item.lastRun.at };
    }
    const next = { ...manifest, policies: { ...manifest.policies, neat } };
    const temporary = join(root, `${path}.${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(next, null, 2) + '\n'); await rename(temporary, join(root, path)); }
    finally { await rm(temporary, { force: true }); }
  }
}
async function updateState(root, change) {
  const work = join(root, 'work'), lock = join(work, 'lifecycle.lock');
  await mkdir(work, { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  if (!acquired) throw Error('Neat lifecycle is busy; no state change was written');
  try {
    const before = await state(root), after = await change(before);
    if (after.pendingBatch) await commitBatch(root, after.pendingBatch);
    await persistAuthoredItems(root, before, after);
    const { pendingBatch, ...persisted } = after;
    return await writeState(root, persisted);
  }
  finally { await rm(lock, { recursive: true, force: true }); }
}
export async function state(root) {
  let snapshot;
  for (const path of ['work/lifecycle.json', 'state/lifecycle.json']) {
    try { snapshot = normalize(JSON.parse(await readFile(join(root, path), 'utf8'))); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  snapshot ??= normalize({ workPath: DEFAULT_ITEM, phase: 'EXPERIMENT', events: [] });
  const items = { ...snapshot.items };
  for (const [source, { manifest }] of await authoredItems(root)) {
    const neat = manifest.policies.neat, item = items[source] ?? initialItem(source);
    items[source] = { ...item, state: neat.state, phase: neat.phase ?? neat.state,
      relations: neat.relations ?? item.relations,
      substates: neat.substates ?? {}, suggestions: neat.suggestions ?? [],
      review: neat.review, approval: neat.approval, promotion: neat.promotion,
      ...(neat.latestEvidence ? { latestEvidence: neat.latestEvidence } : {}) };
  }
  const rootManifest = await readFile(join(root, 'nctk.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  for (const batch of rootManifest?.policies?.neat?.mergedBatches ?? []) {
    for (const entry of batch.entries) {
      const item = items[entry.workItem] ?? initialItem(entry.workItem);
      items[entry.workItem] = { ...item, state: 'Merged', phase: 'Merged',
        promotion: { receiptPath: batch.receiptPath, receiptSha256: batch.receiptSha256,
          candidateSha256: entry.candidateSha256, target: batch.target, targetContentId: batch.targetContentId, at: batch.at } };
    }
  }
  return { ...snapshot, items };
}
export function itemFor(snapshot, path) { return snapshot.items[path] ?? initialItem(path); }

export async function setPhase(root, phase, version, workPath, relations = []) {
  if (!stateFor(phase) && !LEGACY_PHASE.test(phase)) throw Error('Invalid phase label');
  if (GUARDED.has(stateFor(phase))) throw Error(`${phase} requires the explicit Neat review/promotion API`);
  await stat(safePath(root, workPath));
  for (const relation of relations) {
    if (!['refines', 'parallelWith'].includes(relation.kind)) throw Error('Invalid lifecycle relation');
    await stat(safePath(root, relation.path));
  }
  return updateState(root, previous => {
    const item = itemFor(previous, workPath), at = now();
    if (GUARDED.has(item.state)) throw Error(`Reopen ${item.state} explicitly before changing phase`);
    const event = { workPath, phase, state: stateFor(phase) ?? item.state, relations, at };
    const nextItem = { ...item, state: event.state, phase, relations, events: [...item.events, event], updatedAt: at };
    return { ...previous, activeItem: workPath, workPath, phase,
      items: { ...previous.items, [workPath]: nextItem }, events: [...previous.events, event],
      identity: `${version.x}.${version.y}.${version.z}-${version.taskId}_${phase}` };
  });
}
export async function recordRun(root, report, codeContentId) {
  const path = report.recipe;
  const lastRun = { at: report.at, recipe: path, codeContentId,
    sourceSha256: report.source.sha256, report: report.report,
    outputs: report.actions.flatMap(action => action.outputs.map(output => ({
      part: action.part, path: output.path, sha256: output.sha256
    }))), editorialAcceptance: report.editorialAcceptance };
  return updateState(root, previous => {
    const item = itemFor(previous, path);
    if (GUARDED.has(item.state)) throw Error(`Run would change a frozen ${item.state} candidate; reopen it first`);
    const nextItem = { ...item, lastRun, updatedAt: report.at };
    return { ...previous, items: { ...previous.items, [path]: nextItem }, lastRun };
  });
}
/** Freeze a specific candidate and intended composition target for human review. */
export async function openReview(root, workPath, { candidateSha256, checkpointPath, target, affectedAddresses = [], dependsOn = [], evidence = [] }) {
  if (!HASH.test(candidateSha256) || !target || !Array.isArray(evidence) || !evidence.length || !Array.isArray(affectedAddresses) ||
      !affectedAddresses.length || !Array.isArray(dependsOn)) throw Error('Review needs an exact candidate hash, target, affected addresses, and evidence');
  if (!checkpointPath) throw Error('Review needs a managed candidate checkpoint');
  const { checkpoint } = await verifyCandidate(root, checkpointPath, { workItem: workPath, target, candidateSha256 });
  if (JSON.stringify(checkpoint.affectedAddresses) !== JSON.stringify([...affectedAddresses].sort()) ||
      JSON.stringify(checkpoint.dependsOn) !== JSON.stringify(dependsOn)) throw Error('Review claims differ from managed candidate checkpoint');
  await stat(safePath(root, workPath));
  await stat(safePath(root, target));
  for (const address of affectedAddresses) safePath(root, address);
  if (new Set(affectedAddresses).size !== affectedAddresses.length) throw Error('Duplicate affected address in review');
  for (const dependency of dependsOn) if (!dependency.workItem || !HASH.test(dependency.candidateSha256)) throw Error('Invalid exact review dependency');
  for (const entry of evidence) if (!HASH.test(entry.sha256) || await fileHash(safePath(root, entry.path)) !== entry.sha256) throw Error('Review evidence bytes differ');
  return updateState(root, previous => {
    const item = itemFor(previous, workPath);
    if (GUARDED.has(item.state)) throw Error('Reopen the current review before replacing its candidate');
    const at = now(), review = { candidateSha256, checkpointPath, target, affectedAddresses, dependsOn, evidence, at };
    const event = { workPath, state: 'Review', phase: 'Review', candidateSha256, target, at };
    const nextItem = { ...item, state: 'Review', phase: 'Review', review, approval: undefined, promotion: undefined,
      events: [...item.events, event], updatedAt: at };
    return { ...previous, items: { ...previous.items, [workPath]: nextItem }, events: [...previous.events, event],
      activeItem: workPath, workPath, phase: 'Review' };
  });
}
/** Explicitly discard the frozen candidate when returning to editable work. */
export async function reopenReview(root, workPath, to = 'Compare') {
  if (!['Compare', 'Combine', 'Validate', 'Park', 'Reject'].includes(to)) throw Error('Invalid reopen state');
  return updateState(root, previous => {
    const item = itemFor(previous, workPath);
    if (!['Review', 'Merge'].includes(item.state)) throw Error('Only Review or queued Merge can reopen; Merged is historical');
    const at = now(), event = { workPath, state: to, phase: to, invalidatedCandidate: item.review?.candidateSha256, at };
    const nextItem = { ...item, state: to, phase: to, review: undefined, approval: undefined, promotion: undefined,
      events: [...item.events, event], updatedAt: at };
    return { ...previous, items: { ...previous.items, [workPath]: nextItem }, events: [...previous.events, event],
      activeItem: workPath, workPath, phase: to };
  });
}
async function verifyReviewBytes(root, review) {
  await verifyCandidate(root, review.checkpointPath, { target: review.target, candidateSha256: review.candidateSha256 });
  for (const entry of review.evidence) if (await fileHash(safePath(root, entry.path)) !== entry.sha256) throw Error('Frozen review evidence changed');
}
/** A named human decision is bound to the exact frozen candidate and target. */
export async function decideReview(root, workPath, { candidateSha256, target, verdict, actor, evidence = [] }) {
  if (!['APPROVE', 'REJECT'].includes(verdict) || !actor?.trim() || !Array.isArray(evidence)) throw Error('Review decision needs a human actor, verdict, and evidence');
  return updateState(root, async previous => {
    const item = itemFor(previous, workPath), review = item.review;
    if (item.state !== 'Review' || !review || review.candidateSha256 !== candidateSha256 || review.target !== target) throw Error('Decision does not match frozen review candidate and target');
    await verifyReviewBytes(root, review);
    const approval = { candidateSha256, target, verdict, actor: actor.trim(), evidence, at: now() };
    if (verdict === 'REJECT') {
      const event = { workPath, state: 'Reject', phase: 'Reject', candidateSha256, target, at: approval.at };
      return { ...previous, items: { ...previous.items, [workPath]: { ...item, state: 'Reject', phase: 'Reject', approval,
        events: [...item.events, event], updatedAt: approval.at } }, events: [...previous.events, event],
        activeItem: workPath, workPath, phase: 'Reject' };
    }
    return { ...previous, items: { ...previous.items, [workPath]: { ...item, approval, updatedAt: approval.at } } };
  });
}
/** Queue an approved exact candidate; integration happens in a separate batch. */
export async function beginMerge(root, workPath, { candidateSha256, target }) {
  return updateState(root, async previous => {
    const item = itemFor(previous, workPath), review = item.review, approval = item.approval;
    if (item.state !== 'Review' || review?.candidateSha256 !== candidateSha256 || review?.target !== target ||
        approval?.verdict !== 'APPROVE' || approval.candidateSha256 !== candidateSha256 || approval.target !== target) throw Error('Merge requires approval of this exact review candidate and target');
    await verifyReviewBytes(root, review);
    const at = now(), event = { workPath, state: 'Merge', phase: 'Merge', candidateSha256, target, at };
    return { ...previous, items: { ...previous.items, [workPath]: { ...item, state: 'Merge', phase: 'Merge', events: [...item.events, event], updatedAt: at } },
      events: [...previous.events, event], activeItem: workPath, workPath, phase: 'Merge' };
  });
}
/** Recheck a Kompoze→Crisp→Tidy→LocalCI batch before one logical Merged commit. */
export async function completeMergeBatch(root, { receiptPath, receiptSha256 }) {
  if (!HASH.test(receiptSha256) || await fileHash(safePath(root, receiptPath)) !== receiptSha256) throw Error('Promotion batch receipt hash differs');
  const receipt = JSON.parse(await readFile(safePath(root, receiptPath), 'utf8'));
  if (receipt.schema !== 'neat-promotion-batch@2' || receipt.status !== 'PROMOTED' ||
      !Array.isArray(receipt.entries) || !receipt.entries.length || !receipt.target || !HASH.test(receipt.targetContentId)) throw Error('Promotion requires verifiable @2 Kompoze/Crisp receipt; legacy @1 is untrusted');
  return updateState(root, async previous => {
    if (await fileHash(safePath(root, receiptPath)) !== receiptSha256) throw Error('Promotion batch receipt changed during verification');
    const bindings = receipt.validation;
    if (!bindings?.plan?.path || !bindings?.crisp?.path || !bindings?.tidy?.path || !bindings?.localci?.path ||
        ![bindings.plan.sha256, bindings.crisp.sha256, bindings.tidy.sha256, bindings.localci.sha256].every(value => HASH.test(value))) throw Error('Promotion lacks bound Kompoze, Crisp, Tidy, or LocalCI evidence');
    const { verifyMergeEvidence } = await import('../transport/localci_merge.mjs');
    const verified = await verifyMergeEvidence(root, bindings);
    const localci = JSON.parse(await readFile(safePath(root, bindings.localci.path), 'utf8'));
    if (await fileHash(safePath(root, bindings.localci.path)) !== bindings.localci.sha256 ||
        localci.schema !== 'localci-merge@1' || localci.verdict !== 'PASS' ||
        JSON.stringify(localci.bindings) !== JSON.stringify({ plan: bindings.plan, crisp: bindings.crisp, tidy: bindings.tidy }) ||
        JSON.stringify({ target: localci.target, entries: localci.entries, planId: localci.planId,
          crispSha256: localci.crispSha256, targetContentId: localci.targetContentId,
          targetOutputs: localci.targetOutputs, actions: localci.actions }) !== JSON.stringify(verified)) throw Error('LocalCI evidence does not match independently verified graph and outputs');
    if (receipt.target !== verified.target || receipt.targetContentId !== verified.targetContentId ||
        JSON.stringify(receipt.entries) !== JSON.stringify(verified.entries)) throw Error('Promotion receipt does not match Kompoze/Crisp integration');
    const at = now(), batch = { receiptPath, receiptSha256, target: receipt.target,
      targetContentId: receipt.targetContentId, entries: receipt.entries,
      planSha256: bindings.plan.sha256, crispSha256: bindings.crisp.sha256,
      tidySha256: bindings.tidy.sha256, localciSha256: bindings.localci.sha256, at };
    const items = { ...previous.items }, events = [...previous.events];
    for (const entry of receipt.entries) {
      const item = itemFor(previous, entry.workItem);
      if (item.state !== 'Merge' || item.review?.candidateSha256 !== entry.candidateSha256 ||
          item.approval?.verdict !== 'APPROVE') throw Error('Integrated item is no longer approved in Merge');
      const promotion = { receiptPath, receiptSha256, candidateSha256: entry.candidateSha256,
        target: receipt.target, targetContentId: receipt.targetContentId, at };
      const event = { workPath: entry.workItem, state: 'Merged', phase: 'Merged',
        candidateSha256: entry.candidateSha256, target: receipt.target, targetContentId: receipt.targetContentId, at };
      items[entry.workItem] = { ...item, state: 'Merged', phase: 'Merged', promotion, events: [...item.events, event], updatedAt: at };
      events.push(event);
    }
    return { ...previous, items, events, pendingBatch: batch };
  });
}
/** Record observed facts without changing the item's human-controlled state. */
export async function recordObservation(root, workPath, namespace, facts, evidence) {
  if (!NAMESPACE.test(namespace)) throw Error('Invalid versioned substate namespace');
  await stat(safePath(root, workPath));
  if (!facts || typeof facts !== 'object' || Array.isArray(facts) || !Array.isArray(evidence)) throw Error('Invalid observation');
  return updateState(root, previous => {
    const item = itemFor(previous, workPath), at = now();
    const prior = item.substates[namespace] ?? { facts: {}, evidence: [] };
    const substate = { facts: { ...prior.facts, ...facts }, evidence: [...prior.evidence, ...evidence], observedAt: at };
    const nextItem = { ...item, substates: { ...item.substates, [namespace]: substate }, updatedAt: at };
    return { ...previous, items: { ...previous.items, [workPath]: nextItem } };
  });
}
/** A machine suggestion stays pending until a separate human decision records approval. */
export async function suggestNext(root, workPath, suggestion, evidence = []) {
  await stat(safePath(root, workPath));
  if (!suggestion || typeof suggestion !== 'string' || !Array.isArray(evidence)) throw Error('Invalid suggestion');
  return updateState(root, previous => {
    const item = itemFor(previous, workPath);
    const proposal = { text: suggestion, evidence, status: 'PENDING_HUMAN', at: now() };
    return { ...previous, items: { ...previous.items, [workPath]: { ...item, suggestions: [...(item.suggestions ?? []), proposal] } } };
  });
}
