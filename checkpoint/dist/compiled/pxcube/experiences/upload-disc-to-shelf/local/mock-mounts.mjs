import { worlds, resolveWorldValue, NAMESPACES } from '../mock-pxc/mock-pxc.mjs';
import { scenarioFor, scenarioWorld, fixtureHash } from './scenarios.mjs';

const clone = value => structuredClone(value);
const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id);

// Own JSON mock worlds, not a replacement Part kernel. Storage is an adapter:
// the browser uses localStorage; tests use memory. Failure to retain is loud.
export function createMockMounts({ storage, key, seedIdentity }) {
  const raw = storage.getItem(key);
  let state = raw ? JSON.parse(raw) : { schemaVersion: 1, revision: 0, runs: {}, results: [] };
  if (state.schemaVersion !== 1 || !state.runs || Array.isArray(state.runs)) throw Error('Unsupported retained mock state');
  // results arrived after schemaVersion 1; earlier retained states simply have none.
  if (!Array.isArray(state.results)) state.results = [];
  let knownRaw = raw;
  function commit(next) {
    if (storage.getItem(key) !== knownRaw) throw Error('Another owner changed these mounts. Reload to inspect its state.');
    next.revision = state.revision + 1;
    const serialized = JSON.stringify(next);
    storage.setItem(key, serialized); // Quota failure leaves both prior state and runs intact.
    knownRaw = serialized; state = next;
  }
  function entry(name) {
    const found = Object.hasOwn(state.runs, name) ? state.runs[name] : null;
    if (!found) throw Error(`Unknown mount: ${name}`);
    return found;
  }
  function handle(name) {
    entry(name);
    return Object.freeze({
      name,
      resolve(address) {
        const prefix = name + '.';
        if (typeof address !== 'string' || !address.startsWith(prefix) || !NAMESPACES.includes(address.slice(prefix.length).split('.')[0])) throw Error(`Address is outside ${name}`);
        return clone(resolveWorldValue(entry(name).value, address.slice(prefix.length)));
      },
      writeScratch(address, value) {
        // This first mock mutates a whole named scratch value. Nested field
        // access still follows the backend's longest-dotted-key resolution.
        if (!/^sc\.[A-Za-z_][A-Za-z0-9_-]*$/.test(address)) throw Error('Write a whole sc.<name> value, without a mount prefix');
        const encoded = JSON.stringify(value);
        if (encoded === undefined || JSON.stringify(JSON.parse(encoded)) !== encoded) throw Error('Scratch values must be JSON');
        const next = clone(state), run = next.runs[name], previous = run.value.sc[address.slice(3)];
        run.value.sc[address.slice(3)] = JSON.parse(encoded);
        run.changes.push({ step: run.changes.length + 1, address, before: previous ?? null, after: JSON.parse(encoded) });
        commit(next);
      },
      inspect: () => clone(entry(name)),
    });
  }
  function validateSeed(id, world) {
    if (!validId(id) || !Object.hasOwn(worlds, world)) throw Error('Known world and simple sandbox id required');
  }
  function allocate({name, id, world, kind, iteration, replayOf, scenario, sourceSurface}) {
    const next = clone(state);
    next.runs[name] = { name, id, kind, ...(iteration === undefined ? {} : {iteration}), ...(replayOf === undefined ? {} : {replayOf}), world, seedIdentity, ...(scenario ? {scenario,scenarioId:scenario,adapterVersion:1,fixtureHash:fixtureHash(world,scenario),sourceSurface:sourceSurface??world} : {}), seed: clone(scenarioWorld(worlds[world],scenario)), value: clone(scenarioWorld(worlds[world],scenario)), changes: [] };
    commit(next); return handle(name);
  }
  return Object.freeze({
    openInteractive(id, world = 'shelf') {
      validateSeed(id, world);
      const name = `mock.${id}`;
      if (Object.hasOwn(state.runs, name)) {
        const existing = entry(name);
        if (existing.kind !== 'interactive' || existing.world !== world) throw Error(`Existing sandbox ${name} has a different kind or world`);
        return handle(name);
      }
      return allocate({name, id, world, kind:'interactive'});
    },
    createTestRun(id, world = 'shelf', opts = {}) {
      validateSeed(id, world);
      if (opts.scenario !== undefined && !scenarioFor(opts.scenario)) throw Error(`Unknown scenario: ${opts.scenario}`);
      const iteration = Math.max(0, ...Object.values(state.runs).filter(run => run.id === id && Number.isSafeInteger(run.iteration)).map(run => run.iteration)) + 1;
      if (!Number.isSafeInteger(iteration)) throw Error(`Test iterator exhausted for ${id}`);
      return allocate({name:`mock.${id}.${iteration}`, id, world, scenario:opts.scenario, sourceSurface:opts.sourceSurface, kind: opts.kind ?? 'test', iteration, replayOf: opts.replayOf});
    },
    // Run records live in MockPxC, next to the runs they describe. A replay
    // never writes here; it performs in its own distinct sandbox.
    recordResult(result) {
      const { testFile, testName, ok } = result ?? {};
      if (typeof testFile !== 'string' || typeof testName !== 'string' || typeof ok !== 'boolean') throw Error('recordResult needs {testFile, testName, ok}');
      const next = clone(state);
      next.results.push({ testFile, testName, ok, error: result.error ?? null, ranAt: new Date().toISOString(), runs: Object.keys(next.runs) });
      commit(next);
    },
    handle,
    // Earlier snapshots did not record purpose; retain them without inventing it.
    list: () => Object.values(state.runs).map(({ name, id, kind, iteration, world, seedIdentity, replayOf, scenarioId, adapterVersion, fixtureHash, sourceSurface }) => ({name,id,kind:kind ?? 'legacy',iteration,world,seedIdentity,...(replayOf === undefined ? {} : {replayOf}),...(scenarioId ? {scenarioId,adapterVersion,fixtureHash,sourceSurface} : {})})),
    inspect: () => clone(state),
  });
}
