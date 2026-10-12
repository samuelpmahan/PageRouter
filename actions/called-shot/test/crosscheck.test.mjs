import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatch, validateAnswer, compare, score, OBSERVATION } from '../lib/crosscheck.mjs';
import { canonical } from '../lib/canonical.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const shot = {
  id: 'mini', call: [
    { id: 'S1', text: 'Move safePath into src/paths.mjs with its body unchanged.' },
    { id: 'S2', text: 'The catalog changes only at $.release.siteBuildId.' },
  ],
  clauses: [
    { id: 'C1', covers: ['S1'], kind: 'ast.moved', symbol: 'safePath', from: 'src/a.mjs', to: 'src/paths.mjs', body: 'identical' },
    { id: 'C2', covers: ['S2'], kind: 'json.changedPathsExactly', file: 'data/catalog.json', paths: ['$.release.siteBuildId'] },
  ],
};
const { batch, key } = buildBatch([shot]);
const byMutation = m => Object.entries(key.gold).find(([, g]) => g.mutation === m);

test('the batch is content-addressed, holds every real sentence, gold mutants and controls, and no answers', () => {
  assert.equal(buildBatch([shot]).batch.case_id, batch.case_id);
  assert.match(batch.case_id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.keys(key.real).length, 2);
  assert.deepEqual(Object.values(key.gold).map(g => g.mutation).sort(), ['appended-claim', 'appended-claim', 'dropped-body-check', 'swapped-json-path']);
  assert.equal(Object.keys(key.controls).length, 2);
  assert.ok(!JSON.stringify(batch).includes('mutation'), 'the batch must not reveal which items are gold');
  const [dropped] = byMutation('dropped-body-check');
  assert.equal(batch.items.find(i => i.id === dropped).clauses[0].body, undefined);
});

test('an answer must be covered, or a gap quoting the sentence verbatim', () => {
  const item = batch.items.find(i => i.id === byMutation('dropped-body-check')[0]);
  assert.equal(validateAnswer(item, { verdict: 'gap', unchecked: 'with its body unchanged' }), null);
  assert.match(validateAnswer(item, { verdict: 'gap', unchecked: 'the body is the same' }), /not verbatim/);
  assert.match(validateAnswer(item, { verdict: 'gap', unchecked: '' }), /must quote/);
  assert.match(validateAnswer(item, { verdict: 'covered', unchecked: 'x' }), /quotes nothing/);
  assert.match(validateAnswer(item, { verdict: 'probably fine' }), /covered or gap/);
});

// A checker that knows the key: every gold is a gap on its seeded words, everything else covered.
function oracle(name, overrides = {}) {
  const observables = {};
  for (const item of batch.items) {
    const gold = key.gold[item.id];
    observables[item.id] = gold ? { verdict: 'gap', unchecked: gold.span } : { verdict: 'covered', unchecked: null };
  }
  return { format: OBSERVATION, checker: name, case_id: batch.case_id, observables: { ...observables, ...overrides } };
}

test('three agreeing checkers compose an accepted agreement through the PxC FunctionalGuarantee', async () => {
  const comparison = await compare(batch, [oracle('a'), oracle('b'), oracle('c')]);
  assert.equal(comparison.agreement.accepted, true);
  assert.equal(comparison.agreement.first_difference, null);
  assert.equal(comparison.producer.output_part, '/crosscheck/agreement');
  const s = score(comparison, key);
  assert.deepEqual(s.perChecker.a, { goldCaught: 4, goldPointed: 4, gold: 4, falseAlarms: 0, controls: 2, invalid: 0 });
});

test('two of three decide; a lone dissent is the first difference, by path', async () => {
  const [control] = Object.keys(key.controls);
  const comparison = await compare(batch, [oracle('a'), oracle('b'), oracle('c', { [control]: { verdict: 'gap', unchecked: 'nothing is added or removed' } })]);
  assert.equal(comparison.agreement.accepted, true);
  assert.equal(comparison.agreement.first_difference.path, `items.${control}.verdict`);
  assert.deepEqual(comparison.agreement.first_difference.values, { a: 'covered', b: 'covered', c: 'gap' });
  assert.equal(score(comparison, key).perChecker.c.falseAlarms, 1);
});

test('no two valid answers agreeing is not accepted; a non-verbatim quote counts as no answer', async () => {
  const id = batch.items[0].id;
  const comparison = await compare(batch, [
    oracle('a', { [id]: { verdict: 'covered', unchecked: null } }),
    oracle('b', { [id]: { verdict: 'gap', unchecked: batch.items[0].sentence.text.slice(0, 10) } }),
    oracle('c', { [id]: { verdict: 'gap', unchecked: 'words not in the sentence' } }),
  ]);
  assert.equal(comparison.agreement.accepted, false);
  assert.equal(comparison.agreement.items.find(r => r.id === id).majority, null);
  assert.equal(score(comparison, key).perChecker.c.invalid, 1);
});

test('an observation for another case is refused', async () => {
  await assert.rejects(compare(batch, [{ ...oracle('a'), case_id: 'sha256:' + '0'.repeat(64) }]), /not sha256:/);
});

test('a gold quote on the same earlier gap the checker found in the unmutated sentence earns credit', async () => {
  const [goldId, gold] = byMutation('appended-claim');
  const earlier = 'with its body unchanged';
  const real = gold.fromItem;
  const checker = oracle('a', { [real]: { verdict: 'gap', unchecked: batch.items.find(i => i.id === real).sentence.text.includes(earlier) ? earlier : batch.items.find(i => i.id === real).sentence.text.split(' ').slice(0, 2).join(' ') } });
  checker.observables[goldId] = { verdict: 'gap', unchecked: checker.observables[real].unchecked };
  const comparison = await compare(batch, [checker, oracle('b'), oracle('c')]);
  assert.equal(score(comparison, key).perChecker.a.goldPointed, 4);
});

test('canonical JSON matches the recorded crosscheck case id', () => {
  assert.equal(canonical({ b: [1, 'x', null], a: { d: true, c: 2.5 } }), '{"a":{"c":2.5,"d":true},"b":[1,"x",null]}');
  // Inside PageRouter, the recorded batch must still hash to its own case id.
  const recorded = path.resolve(import.meta.dirname, '../../../checkpoint/ci/shots/called/crosscheck-2026-10-12/batch.json');
  if (!fs.existsSync(recorded)) return;
  const { case_id, ...payload } = JSON.parse(fs.readFileSync(recorded, 'utf8'));
  assert.equal('sha256:' + crypto.createHash('sha256').update(canonical(payload)).digest('hex'), case_id);
});

test('the pinned PxC kernel is byte-identical to PageRouter\'s, when run inside PageRouter', () => {
  const pinned = fs.readFileSync(path.resolve(import.meta.dirname, '../vendor/pxc.mjs'));
  assert.equal(crypto.createHash('sha256').update(pinned).digest('hex'), '1b280236336522fd0568e9e7c0fc652b88c259c65f7db4efcd5b23f04ee88af9');
  const source = path.resolve(import.meta.dirname, '../../../checkpoint/vendor/hh/services/pxc.mjs');
  if (fs.existsSync(source)) assert.ok(fs.readFileSync(source).equals(pinned));
});
