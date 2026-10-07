#!/usr/bin/env node
// Phase 1 guards for the advisory browser optimization store. These tests are
// intentionally independent of the live server and of any Experience UI.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STORE_PATH,
  SEEDED_IDS,
  getOptimization,
  loadOptimizationStore,
  selectOptimizations,
  summarizeOptimizationStore,
  validateOptimizationStore,
} from '../lib/store.mjs';
import { LANE_INTEGRATION, optimizationAdvisory } from '../lib/integrations.mjs';
import { tidyOptimizationAdvisory } from '../../tidy/lib/optimization-links.mjs';
import { crispOptimizationAdvisory } from '../../crisp/lib/optimization-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAIL ${name} :: ${error.message}\n`);
  }
}

const store = await loadOptimizationStore();

await check('registry exists and validates', async () => {
  assert.equal(DEFAULT_STORE_PATH, join(ROOT, 'registry.json'));
  assert.deepEqual(validateOptimizationStore(store), []);
});

await check('seed records are exactly the Phase 1 set', async () => {
  assert.deepEqual(store.records.map(record => record.id), SEEDED_IDS);
  assert.equal(store.records.length, SEEDED_IDS.length);
});

await check('BO-0008 encodes the exact #PROcision crop example', async () => {
  const record = getOptimization(store, 'BO-0008');
  assert.ok(record);
  assert.deepEqual(record.examples, [{
    kind: 'crop-correction-strip',
    increments: [-10, -5, -3, -1, 1, 3, 5, 10],
    unit: 'selection-diameter-percentage-points',
    verification: 'same-viewport',
  }]);
  assert.match(record.recommendation.summary, /automatic first pass/);
  assert.match(record.recommendation.summary, /explicit commit/);
});

await check('#PROcision is documented as a repo principle', async () => {
  const principles = await readFile(join(ROOT, '..', 'docs', 'design-principles.md'), 'utf8');
  assert.match(principles, /## #PROcision/);
  assert.match(principles, /-10, -5, -3, -1, \+1, \+3, \+5, \+10/);
  assert.match(principles, /percentage points of selection diameter/);
  assert.match(principles, /same-viewport visual verification/);
});

for (const id of SEEDED_IDS) await check(`${id} has actionable guard and evidence`, async () => {
  const record = getOptimization(store, id);
  assert.ok(record);
  assert.ok(record.recommendation.actions.length > 0);
  assert.ok(record.guard.testRef.startsWith('browser-optimizations/test/'));
  assert.ok(record.evidence.length > 0);
});

await check('lane selection is shared and non-retired', async () => {
  assert.deepEqual(Object.keys(LANE_INTEGRATION).sort(), ['crisp', 'neat', 'tidy']);
  assert.equal(selectOptimizations(store, { lane: 'crisp' }).length, 5);
  assert.equal(selectOptimizations(store, { tag: 'startup' }).length, 2);
});

await check('advisory bridge does not mutate the store', async () => {
  const before = JSON.stringify(store);
  const advice = await optimizationAdvisory({ lane: 'neat' });
  assert.equal(advice.mode, 'advisory');
  assert.equal(advice.records.length, 5);
  assert.equal(JSON.stringify(store), before);
});

await check('tidy and crisp bridges share the same advisory registry', async () => {
  const [tidyAdvice, crispAdvice] = await Promise.all([
    tidyOptimizationAdvisory({ tag: 'startup' }),
    crispOptimizationAdvisory({ tag: 'preview' }),
  ]);
  assert.deepEqual(tidyAdvice.map(record => record.id), ['BO-0001', 'BO-0002']);
  assert.deepEqual(crispAdvice.map(record => record.id), ['BO-0007']);
});

await check('summary is stable and useful to lane callers', async () => {
  assert.deepEqual(summarizeOptimizationStore(store), {
    storeId: 'pxcube-browser-optimizations',
    schemaVersion: 1,
    recordCount: 5,
    ids: SEEDED_IDS,
    scopes: ['all-experiences', 'browser-runtime', 'local-development'],
  });
});

await check('validator catches duplicate and missing seeded records', async () => {
  const broken = { ...store, records: [store.records[0], store.records[0]] };
  const problems = validateOptimizationStore(broken);
  assert.ok(problems.some(problem => problem.includes('duplicate optimization id BO-0001')));
  assert.ok(problems.some(problem => problem.includes('missing seeded optimization BO-0002')));
});

await check('registry and bridges stay clear of protected live UI/process controls', async () => {
  const paths = [
    join(ROOT, 'registry.json'),
    join(ROOT, 'schema.json'),
    join(ROOT, 'lib', 'store.mjs'),
    join(ROOT, 'lib', 'integrations.mjs'),
  ];
  const text = (await Promise.all(paths.map(path => readFile(path, 'utf8')))).join('\n');
  for (const forbidden of [
    'vendor/studio/upload-disc-to-shelf',
    'process.kill',
    'child.kill',
    'local/run.mjs',
    'fs.rmSync',
  ]) assert.equal(text.includes(forbidden), false, `found forbidden reference ${forbidden}`);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
