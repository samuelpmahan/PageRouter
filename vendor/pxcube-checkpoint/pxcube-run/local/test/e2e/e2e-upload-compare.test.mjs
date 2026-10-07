// Paired probe against the two assembled cartridges, using identical inputs.
// Run after `node local/ci.mjs`; the JSON witness is intentionally generated
// from the shipped chunks, not copied from the source implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../../run.mjs';
import { siteFile, sitePath } from './e2e-site.mjs';

const ids = ['upload-disc-to-shelf', 'upload-disc-to-shelf-delta'];
const loaded = await Promise.all(ids.map(async id => {
  const prefix = `experiences/${id}`;
  const studio = `${prefix}/studio/upload-disc-to-shelf`;
  return {
    id,
    config: (await import(siteFile(prefix, 'config.mjs'))).default,
    receipt: JSON.parse(fs.readFileSync(sitePath(prefix, 'receipt.json'), 'utf8')),
    fixture: await import(siteFile(studio, 'experience-fixtures.js')),
    model: await import(siteFile(studio, 'model.js')),
    search: await import(siteFile(studio, 'mold-search.js')),
  };
}));

test('baseline and typed delta execute the same upload and search inputs with separate workspace identities', async () => {
  const photo = Object.freeze({ kind: 'photo', name: 'paired synthetic prepared photo', src: 'data:image/png;base64,iVBORw0KGgo=' });
  const runs = [];
  for (const { id, config, receipt, fixture, model, search } of loaded) {
    assert.equal(config.id, id);
    assert.equal(config.mode, 'upload');
    const app = await fixture.startSandbox('upload', () => {});
    const untouched = await fixture.startSandbox('upload', () => {});
    const draft = { ...model.initialDraft(), plastic: 'ESP', weight: 174 };
    const seed = app.seedAt(draft.mold);
    const options = search.fuzzyMoldOptions(app.seedOptions(), 'Discraft Buzx', row => `${row.seed.manufacturer} ${row.seed.name}`);
    assert.equal(options[0].address, draft.mold, 'the same typo suggests Buzzz');
    const address = await app.save(draft, photo);
    const snap = fixture.inspectExperience(app);
    assert.equal(snap.discs.length, 1);
    assert.equal(address, snap.discs[0].address);
    assert.equal(app.pxc.get(address), app.pxc.get(address), 'live Part identity is stable');
    assert.ok(app.pxc.get(app.shelfAddress).value.includes(address));
    assert.equal(fixture.inspectExperience(untouched).discs.length, 0);
    const row = snap.discs[0];
    assert.equal(row.own.depiction.src, photo.src);
    assert.equal(row.own.mold, draft.mold);
    assert.equal(row.own.weight, 174);
    assert.equal(row.own.speed, undefined, 'hydrated flight numbers are not stored in the Disc');
    for (const field of ['manufacturer', 'name', 'speed', 'glide', 'turn', 'fade']) assert.equal(row.resolved[field], seed[field], field);
    assert.equal(row.resolved.plastic, 'ESP');
    assert.ok(snap.receipts.length > 0 && snap.receipts.every(item => item.status === 'produced'));
    const saveReceipt = app.events.find(event => event.event === 'disc.save.completed');
    assert.ok(saveReceipt?.readbackMatched && saveReceipt.shelfContainsDisc);
    assert.equal(saveReceipt.storage, 'session-memory');
    runs.push({
      id, storageKey: `pxcube.studio.v1:${config.id}:mounts`,
      packageReceipt: `experiences/${id}/receipt.json`,
      packageSourceHash: receipt.sourceHash,
      suggestion: { query: 'Discraft Buzx', first: options[0].seed.name },
      upload: { depiction: row.own.depiction.kind, shelfCount: snap.discs.length, otherSandboxCount: fixture.inspectExperience(untouched).discs.length,
        ownFlightPersisted: Object.hasOwn(row.own, 'speed'), resolvedFlight: [row.resolved.speed, row.resolved.glide, row.resolved.turn, row.resolved.fade],
        shelfReadback: saveReceipt.shelfContainsDisc, saveReadback: saveReceipt.readbackMatched, receiptCount: snap.receipts.length },
    });
  }
  assert.notEqual(runs[0].storageKey, runs[1].storageKey);
  assert.deepEqual(runs[0].suggestion, runs[1].suggestion);
  assert.deepEqual(runs[0].upload, runs[1].upload);
  const [base, delta] = loaded.map(({ receipt }) => receipt);
  const baseChunks = new Map(base.chunks.map(c => [c.path, c.sha256]));
  const deltaChunks = new Map(delta.chunks.map(c => [c.path, c.sha256]));
  assert.deepEqual([...baseChunks.keys()].sort(), [...deltaChunks.keys()].sort());
  const differingChunks = [...baseChunks].filter(([name, hash]) => deltaChunks.get(name) !== hash).map(([name]) => name);
  assert.deepEqual(differingChunks, ['config.mjs'], 'only the owning config differs');
  assert.deepEqual(delta.composition.overridden, ['config.mjs']);
  const evidence = {
    schemaVersion: 1, kind: 'paired-upload-probe', subject: 'locally assembled cartridges',
    command: 'node local/ci.mjs && node --test local/test/e2e/e2e-upload-compare.test.mjs',
    inputs: { query: 'Discraft Buzx', mold: 'Buzzz', plastic: 'ESP', weight: 174, depiction: 'synthetic prepared PNG data URL' },
    runs, differingChunks, sharedChunkCount: baseChunks.size - differingChunks.length,
    conclusion: 'behavior parity on these inputs; distinct workspace storage keys; no refinement winner or human acceptance',
    limits: ['Node execution of shipped model and search chunks, not a browser interaction', 'No photograph selection, crop, visual inspection, or remote Pages deployment tested'],
  };
  const file = path.join(root, 'evidence/upload-refinement-compare.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
});
