// The clean seam for test results.
//
// Tests ask the seam for a session instead of constructing kernel owners
// directly. The seam hands out the same isolated owners the tests built
// before (fresh memory storage per call, caller-chosen), registers every
// owner it hands out, and records each test's result into the kernel's run
// records (the session anchor's records), next to the runs the test made.
//
// In Node the session is bookkeeping. In the browser the experience UI sets
// the active session before importing a test file, and reads the same module
// instance back afterwards (the dist mirror keeps one copy) to show results,
// worlds, and replays.
//
// A replay never touches the record: it performs the recorded changes in its
// own distinct sandbox, through the same write path, so each step is visibly
// auditable.
import { createPxcKernel } from '../pxc-kernel.mjs';
import * as pxc from '../../vendor/neat/dist/pxc.js';
import { worlds, NAMESPACES } from '../../mock-pxc/mock-pxc.mjs';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

const sessions = new Map();
let activeKey = null;

export function setActiveTestSession(key) { activeKey = key; }
export function clearActiveTestSession() { activeKey = null; }

function createSession(key) {
  const anchor = createPxcKernel({ storage: memoryStorage(), key: `pxcube.test-seam.v1:${key}`, seedIdentity: 'test-seam-anchor', seeds: { worlds, namespaces: NAMESPACES }, pxc });
  const owners = [];
  // A fresh read of retained state. Owner objects captured during a test can
  // go stale (a later owner on the same storage commits after them), so the
  // audit path never trusts them; it re-reads.
  const fresh = index => {
    const entry = owners[index];
    if (!entry) throw Error(`Unknown session owner ${index}`);
    return createPxcKernel({ storage: entry.storage, key: entry.key, seedIdentity: entry.seedIdentity, seeds: { worlds, namespaces: NAMESPACES }, pxc });
  };
  const session = {
    key,
    anchor,
    // Fresh isolated storage, exactly as the tests built before.
    memory() { return memoryStorage(); },
    // Same owner the tests built before; registered so the UI can audit it.
    owner(storage, { key: ownerKey = `test-seam:${key}`, seedIdentity = 'test-seam' } = {}) {
      const owner = createPxcKernel({ storage, key: ownerKey, seedIdentity, seeds: { worlds, namespaces: NAMESPACES }, pxc });
      owners.push({ owner, storage, key: ownerKey, seedIdentity });
      return owner;
    },
    // The result lands in the kernel, committed through the guarded path.
    async recordResult(result) { await anchor.recordResult(result); },
    ownerCount() { return owners.length; },
    // Plain data for the UI: results plus every run of every registered owner.
    async snapshot() {
      return {
        key,
        results: (await anchor.inspect()).results,
        worlds: await Promise.all(owners.map(async (entry, index) => ({ owner: index, runs: Object.values((await fresh(index).inspect()).runs) }))),
      };
    },
    // A visibly auditable replay: a distinct sandbox seeded like the source
    // run, then the recorded changes performed one step at a time through
    // writeScratch. The source run is never written to.
    async replay(ownerIndex, runName) {
      const owner = fresh(ownerIndex);
      const source = (await owner.inspect()).runs[runName];
      if (!source) throw Error(`Unknown run ${runName}`);
      const handle = await owner.createTestRun(source.id, source.world, { kind: 'replay', replayOf: runName });
      const steps = source.changes.map(change => ({ address: change.address, before: change.before, after: change.after }));
      let applied = 0;
      const state = () => handle.inspect();
      return {
        name: handle.name,
        source: runName,
        total: steps.length,
        get applied() { return applied; },
        changeAt(index) { return steps[index] ?? null; },
        async applyNext() {
          if (applied >= steps.length) return null;
          const step = steps[applied];
          await handle.writeScratch(step.address, step.after);
          applied += 1;
          return { step: applied, total: steps.length, change: step, state: await state() };
        },
        async runAll() { let last = null; let next; while ((next = await this.applyNext()) !== null) last = next; return last; },
        state,
        // The replay performed the same writes in the same order, so its
        // final value should equal the recorded run's.
        async matches() { return JSON.stringify((await state()).value) === JSON.stringify(source.value); },
      };
    },
  };
  return session;
}

export function testSession(key = null) {
  const sessionKey = key ?? activeKey ?? 'default';
  if (!sessions.has(sessionKey)) sessions.set(sessionKey, createSession(sessionKey));
  return sessions.get(sessionKey);
}
