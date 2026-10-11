// PolicyBench × Tac-x-Tic, verified inside PageRouter with node:test (no extra tooling).
// The modules beside this file are generated from the TypeScript source by tools/emit-pagerouter.mjs; this test is authored here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from './core/index.mjs';
import { runMatch, replay } from './engine/index.mjs';
import { runPxcMatch, provenance } from './pxc/index.mjs';
import { tacXTic, stayer, scout, planner } from './tac-x-tic/index.mjs';
import { AUTHORED } from './tac-x-tic/contrib/index.mjs';
import { buildTxtGraph } from './tac-x-tic/capabilities.mjs';
import { seededRandom } from './policies/index.mjs';

const library = { 'txt-stayer': stayer, 'txt-scout': scout, 'txt-planner': planner };
const factories = { ...library, ...Object.fromEntries(Object.entries(AUTHORED).map(([k, a]) => [k, a.factory])) };
const names = Object.keys(factories);
const budgets = { planningUnits: 20, memorySlots: 4 };

test('PxC-composed match equals the original engine, GO for GO, for every pairing', async () => {
  for (const rules of [{}, { positions: 'hidden', clash: 'both-fail', startA: 4, startB: 4 }]) {
    const { config } = resolveConfig(tacXTic, rules, 2);
    for (const a of names) for (const b of names) {
      const seed = `pr-${a}-${b}`;
      const old = await runMatch({ game: tacXTic, config, seed, policyLibrary: library, settings: { budget: { decisionMs: 5000, matchMs: null }, maxRetries: 0, onInvalid: 'default-action' },
        participants: [{ player: 'A', policy: factories[a](), budgets }, { player: 'B', policy: factories[b](), budgets }] });
      const neu = await runPxcMatch({ game: tacXTic, config, seed, policyLibrary: library, seats: [{ player: 'A', policy: factories[a](), budgets }, { player: 'B', policy: factories[b](), budgets }] });
      const oldHashes = old.log.filter((e) => e.t === 'resolved').map((e) => e.stateHash);
      assert.deepEqual(neu.stateHashes.slice(1), oldHashes, `${a} vs ${b} ${JSON.stringify(rules)}`);
      assert.deepEqual(neu.outcome, old.outcome);
      assert.ok(replay(tacXTic, old.log).ok, `replay ${a} vs ${b}`);
    }
  }
});

test('simultaneity and provenance are structural in PxC receipts', async () => {
  const { config } = resolveConfig(tacXTic, {}, 2);
  const r = await runPxcMatch({ game: tacXTic, config, seed: 'prov', policyLibrary: library, seats: [{ player: 'A', policy: scout() }, { player: 'B', policy: stayer() }] });
  const p = provenance(r.pxc, 'plan/3/A');
  assert.ok(p.includes('obs/3/A') && p.includes('state/3'));
  assert.ok(!p.includes('plan/3/B') && !p.includes('obs/3/B'), "A's plan must not depend on B's plan or view");
  for (const x of ['accepted/3/A', 'accepted/3/B']) assert.ok(provenance(r.pxc, 'state/4').includes(x));
  assert.ok(r.pxc.receipts().every((x) => x.status === 'produced'));
});

test('capability ledger: every implementation proves its contract', async () => {
  const policies = {
    'txt-stayer': { factory: stayer, origin: 'baseline', description: '' }, 'txt-scout': { factory: scout, origin: 'baseline', description: '' },
    'txt-planner': { factory: planner, origin: 'baseline', description: '' }, 'seeded-random': { factory: seededRandom, origin: 'baseline', description: '' },
    ...Object.fromEntries(Object.entries(AUTHORED).map(([k, a]) => [`contrib-${k}`, { factory: a.factory, origin: a.file, description: '' }])),
  };
  const g = buildTxtGraph(policies);
  for (const c of g.ledger()) for (const i of c.implementations) await g.prove(i.id, '2026-10-11T00:00:00Z');
  const failing = g.ledger().flatMap((c) => c.implementations.filter((i) => i.status !== 'proven').map((i) => `${i.id}: ${i.failed.join('; ')}`));
  assert.deepEqual(failing, []);
});
