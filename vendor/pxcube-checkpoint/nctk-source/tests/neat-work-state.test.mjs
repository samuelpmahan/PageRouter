import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state, setPhase, recordRun, recordObservation, suggestNext, itemFor,
  openReview, decideReview, beginMerge, completeMergeBatch, reopenReview } from '../policies/neat.mjs';
import { fileHash } from '../facts.mjs';
import { captureCandidate } from '../policies/candidate.mjs';

const HOUSE = 'recipes/house-cut.json', DISC = 'recipes/discstudio-photo-card.json';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'neat-items-'));
  await mkdir(join(root, 'recipes'));
  await mkdir(join(root, 'work'));
  for (const path of [HOUSE, DISC]) await writeFile(join(root, path), '{}');
  const manifest = (address, children, source = null, neat = { mode: 'none' }) => ({
    schema: 'nctk-directory@1', address, children, source, kind: source ? 'part' : 'group',
    policies: { neat, crisp: { mode: 'none' }, tidy: { mode: 'local' }, kompoze: { mode: 'none', references: [] } } });
  await mkdir(join(root, 'recipes/house-cut'));
  await mkdir(join(root, 'recipes/discstudio-photo-card'));
  await writeFile(join(root, 'nctk.json'), JSON.stringify(manifest('.', ['recipes'], null,
    { mode: 'local', role: 'batch-journal', state: 'Compare', mergedBatches: [] })));
  await writeFile(join(root, 'recipes/nctk.json'), JSON.stringify(manifest('recipes', ['recipes/discstudio-photo-card', 'recipes/house-cut'])));
  await writeFile(join(root, 'recipes/house-cut/nctk.json'), JSON.stringify(manifest('recipes/house-cut', [], HOUSE,
    { mode: 'local', state: 'Compare', phase: 'Compare', substates: {} })));
  await writeFile(join(root, 'recipes/discstudio-photo-card/nctk.json'), JSON.stringify(manifest('recipes/discstudio-photo-card', [], DISC,
    { mode: 'local', state: 'Compare', phase: 'Compare', substates: {} })));
  await writeFile(join(root, 'work/lifecycle.json'), JSON.stringify({ workPath: HOUSE, phase: 'EXPERIMENT', events: [],
    lastRun: { recipe: DISC, at: '2026-09-29T00:00:00Z', codeContentId: 'prior-disc-build' } }));
  return root;
}

test('legacy lifecycle migrates a mismatched lastRun to its own work item', async () => {
  const root = await fixture(), snapshot = await state(root);
  assert.equal(snapshot.workPath, HOUSE);
  assert.equal(itemFor(snapshot, HOUSE).state, 'Compare');
  assert.equal(itemFor(snapshot, HOUSE).lastRun, undefined);
  assert.equal(itemFor(snapshot, DISC).lastRun.codeContentId, 'prior-disc-build');
});

test('phase, observed evidence, and suggestions stay scoped without semantic auto-approval', async () => {
  const root = await fixture(), version = { x: 2, y: 3, z: 4, taskId: 'work-states' };
  await setPhase(root, 'Park', version, HOUSE);
  await setPhase(root, 'Validate', version, DISC, [{ kind: 'parallelWith', path: HOUSE }]);
  await recordRun(root, { recipe: DISC, at: '2026-09-29T01:00:00Z', source: { sha256: 'source' },
    report: 'work/runs/disc.json', actions: [{ part: 'parts/card/discstudio', outputs: [{ path: 'work/card.png', sha256: 'card' }] }], editorialAcceptance: 'UNKNOWN' }, 'disc-build');
  await recordObservation(root, DISC, 'localci.discstudio-pages@1', { verdict: 'PASS', buildId: 'abc' },
    [{ path: 'work/release-receipt.json', sha256: 'proof' }]);
  await suggestNext(root, DISC, 'Merge after human review');
  const snapshot = await state(root);
  assert.equal(snapshot.items[HOUSE].state, 'Park');
  assert.equal(snapshot.items[HOUSE].lastRun, undefined);
  assert.equal(snapshot.items[DISC].state, 'Validate');
  assert.equal(snapshot.items[DISC].lastRun.codeContentId, 'disc-build');
  assert.equal(snapshot.items[DISC].substates['localci.discstudio-pages@1'].facts.verdict, 'PASS');
  assert.equal(snapshot.items[DISC].suggestions[0].status, 'PENDING_HUMAN');
  assert.equal(snapshot.phase, 'Validate', 'legacy CLI field remains available');
  assert.equal(JSON.parse(await readFile(join(root, 'work/lifecycle.json'))).schema, 'neat-work-state@2');
});

test('concurrent observers retain both namespaced updates', async () => {
  const root = await fixture();
  await Promise.all([
    recordObservation(root, HOUSE, 'localci.house@1', { checked: true }, [{ sha256: 'a' }]),
    recordObservation(root, DISC, 'localci.discstudio-pages@1', { checked: true }, [{ sha256: 'b' }]),
  ]);
  const snapshot = await state(root);
  assert.equal(snapshot.items[HOUSE].substates['localci.house@1'].facts.checked, true);
  assert.equal(snapshot.items[DISC].substates['localci.discstudio-pages@1'].facts.checked, true);
});

test('managed Review freezes authored bytes, needs human approval, and rejects legacy promotion', async () => {
  const root = await fixture(), version = { x: 5, y: 0, z: 0, taskId: 'queue' };
  const claim = await captureCandidate(root, 'work/candidate.json', {
    workItem: DISC, target: DISC, affectedAddresses: ['recipes/discstudio-photo-card'] });
  const options = { candidateSha256: claim.candidateSha256, checkpointPath: claim.checkpointPath,
    target: DISC, affectedAddresses: ['recipes/discstudio-photo-card'],
    evidence: [{ path: claim.checkpointPath, sha256: claim.candidateSha256 }] };
  await assert.rejects(setPhase(root, 'Merge', version, DISC), /explicit Neat/);
  await openReview(root, DISC, options);
  await assert.rejects(setPhase(root, 'Validate', version, DISC), /Reopen Review/);
  await assert.rejects(beginMerge(root, DISC, { candidateSha256: claim.candidateSha256, target: DISC }), /approval/);
  await decideReview(root, DISC, { candidateSha256: claim.candidateSha256, target: DISC, verdict: 'APPROVE', actor: 'human reviewer' });
  await writeFile(join(root, DISC), '{"tampered":true}');
  await assert.rejects(beginMerge(root, DISC, { candidateSha256: claim.candidateSha256, target: DISC }), /authored bytes changed/);
  assert.equal(itemFor(await state(root), DISC).state, 'Review');
  await writeFile(join(root, DISC), '{}');
  await beginMerge(root, DISC, { candidateSha256: claim.candidateSha256, target: DISC });
  await writeFile(join(root, 'work/legacy.json'), JSON.stringify({ schema: 'neat-promotion-batch@1', status: 'PROMOTED',
    target: DISC, entries: [{ workItem: DISC, candidateSha256: claim.candidateSha256 }], targetContentId: '0'.repeat(64) }));
  await assert.rejects(completeMergeBatch(root, { receiptPath: 'work/legacy.json', receiptSha256: await fileHash(join(root, 'work/legacy.json')) }), /legacy @1 is untrusted/);
  assert.equal(itemFor(await state(root), DISC).state, 'Merge');
  await reopenReview(root, DISC, 'Combine');
  assert.equal(itemFor(await state(root), DISC).approval, undefined);
});
