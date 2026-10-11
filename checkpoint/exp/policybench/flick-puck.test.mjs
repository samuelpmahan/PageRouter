// Flick Puck: a continuous-action physics game on the same engine, with no engine changes (extension proof).
// Checks bit-exact replay, PxC == engine GO for GO, integer-only physics, and rule validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from './core/index.mjs';
import { runMatch, replay } from './engine/index.mjs';
import { runPxcMatch } from './pxc/index.mjs';
import { flickPuck, sniper, spray, patient, planner, isqrt } from './flick-puck/index.mjs';

const LIB = { 'fp-sniper': sniper, 'fp-spray': spray, 'fp-patient': patient, 'fp-planner': planner };
const budgets = { planningUnits: 30, memorySlots: 4 };

test('every pairing replays exactly and the PxC-composed match is identical, with and without aim noise', async () => {
  for (const rules of [{}, { aimNoise: 4 }]) {
    const { config } = resolveConfig(flickPuck, rules, 2);
    for (const a of Object.keys(LIB)) for (const b of Object.keys(LIB)) {
      const seed = `ci|${a}|${b}|${JSON.stringify(rules)}`;
      const old = await runMatch({ game: flickPuck, config, seed, policyLibrary: LIB, settings: { budget: { decisionMs: 5000, matchMs: null }, maxRetries: 0, onInvalid: 'default-action' },
        participants: [{ player: 'A', policy: LIB[a](), budgets }, { player: 'B', policy: LIB[b](), budgets }] });
      assert.ok(replay(flickPuck, old.log).ok, `replay ${a} vs ${b}`);
      const neu = await runPxcMatch({ game: flickPuck, config, seed, policyLibrary: LIB, seats: [{ player: 'A', policy: LIB[a](), budgets }, { player: 'B', policy: LIB[b](), budgets }] });
      assert.deepEqual(neu.stateHashes.slice(1), old.log.filter((e) => e.t === 'resolved').map((e) => e.stateHash), `${a} vs ${b}`);
      assert.ok(old.outcome.reason, 'match ended');
    }
  }
});

test('physics state stays integer (no float drift between Node and browser)', async () => {
  const { config } = resolveConfig(flickPuck, { aimNoise: 6 }, 2);
  const r = await runMatch({ game: flickPuck, config, seed: 'ints', participants: [{ player: 'A', policy: spray() }, { player: 'B', policy: spray() }], settings: { budget: { decisionMs: 5000, matchMs: null } } });
  for (const d of r.finalState.discs) for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isInteger(d[k]), `disc ${d.id}.${k} = ${d[k]}`);
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99999999, 2 ** 52]) { const s = isqrt(n); assert.ok(s * s <= n && (s + 1) * (s + 1) > n, `isqrt(${n})`); }
});

test('rules: grabbing, duplicates, flicks per GO, and the gap must fit a disc', () => {
  const { config } = resolveConfig(flickPuck, { flicksPerGo: 1 }, 2);
  const s = flickPuck.setup({ config, players: ['A', 'B'], rng: null });
  assert.equal(flickPuck.validateAction(s, 'A', { flicks: [{ disc: 0, angle: 270, power: 100 }] }).ok, true);
  assert.equal(flickPuck.validateAction(s, 'A', { flicks: [{ disc: 5, angle: 90, power: 100 }] }).ok, false, "B's disc");
  assert.equal(flickPuck.validateAction(s, 'A', { flicks: [{ disc: 0, angle: 270, power: 100 }, { disc: 1, angle: 270, power: 100 }] }).ok, false, 'flicksPerGo');
  assert.equal(flickPuck.validateAction(s, 'A', { flicks: [{ disc: 0, angle: 270, power: 0 }] }).ok, false, 'power');
  assert.equal(flickPuck.validateAction(s, 'A', 'flick!').ok, false);
  assert.ok(resolveConfig(flickPuck, { gap: 10 }, 2).errors.length > 0, 'gap narrower than a disc is rejected');
});
