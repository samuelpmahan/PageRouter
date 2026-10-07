// The shell-owned PxC substrate. Every Experience's worlds live in PxC boards
// owned by the shell; frames on the same page reach the kernel API directly
// (same origin, no messages, no client). Storage keeps the exact shape the
// mock used (schemaVersion 1), so retained browser state loads untouched.
//
// A run's board is a read-optimized derived index over its persisted nested
// value. Flattening registers every node at its literal-key dotted address,
// which makes direct part lookup exactly the old longest-dotted-key
// resolution: 'px.discs.buzzz' is one registered address, not a traversal.
// The invariant board == flatten(value) holds in two places: load and
// writeScratch. Reads go through readPart (telemetry recorded, unknown
// addresses raise MissingPartError); the change log stays the write history.

const clone = value => structuredClone(value);
const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id);

function flattenInto(board, registerPart, prefix, value) {
  let next = registerPart(board, prefix, value);
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((entry, index) => [String(index), entry])
      : Object.entries(value);
    for (const [key, child] of entries) next = flattenInto(next, registerPart, `${prefix}.${key}`, child);
  }
  return next;
}

export function createPxcKernel({ storage, key, seedIdentity, seeds, pxc }) {
  const { worlds, namespaces } = seeds;
  const { createPxC, registerPart, readPart } = pxc;

  const raw = storage.getItem(key);
  let state = raw ? JSON.parse(raw) : { schemaVersion: 1, revision: 0, runs: {}, results: [] };
  if (state.schemaVersion !== 1 || !state.runs || Array.isArray(state.runs)) throw Error('Unsupported retained PxC state');
  if (!Array.isArray(state.results)) state.results = [];

  const boards = new Map();
  function buildBoard(value) {
    let board = createPxC();
    for (const ns of namespaces) {
      if (value[ns] !== undefined) board = flattenInto(board, registerPart, ns, value[ns]);
    }
    return board;
  }
  for (const [name, run] of Object.entries(state.runs)) boards.set(name, buildBoard(run.value));

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
  function innerAddress(name, address) {
    const prefix = name + '.';
    if (typeof address !== 'string' || !address.startsWith(prefix)) throw Error(`Address is outside ${name}`);
    const inner = address.slice(prefix.length);
    const [ns, ...rest] = inner.split('.');
    if (!namespaces.includes(ns) || rest.some(part => !part)) throw Error(`Address is outside ${name}`);
    return inner;
  }
  function handle(name) {
    entry(name);
    const board = () => {
      const found = boards.get(name);
      if (!found) throw Error(`Unknown mount: ${name}`);
      return found;
    };
    const readThrough = address => {
      const inner = innerAddress(name, address);
      const result = readPart(board(), inner);
      boards.set(name, result.pxc); // keep the read telemetry
      return result;
    };
    return {
      name,
      resolve(address) {
        return clone(readThrough(address).value);
      },
      read(address) {
        const result = readThrough(address);
        return { value: clone(result.value), receipt: result.pxc.telemetry.reads.at(-1) };
      },
      // A telemetry-free peek for the console's address listing: listing
      // types is not a read, only the Read button is.
      peek(address) {
        return clone(board().parts.get(innerAddress(name, address)));
      },
      addresses() {
        return [...board().parts.keys()].sort();
      },
      writeScratch(address, value) {
        // This kernel writes a whole named scratch value. Nested field
        // access still follows the backend's literal-key dotted addresses.
        if (!/^sc\.[A-Za-z_][A-Za-z0-9_-]*$/.test(address)) throw Error('Write a whole sc.<name> value, without a mount prefix');
        const encoded = JSON.stringify(value);
        if (encoded === undefined || JSON.stringify(JSON.parse(encoded)) !== encoded) throw Error('Scratch values must be JSON');
        const parsed = JSON.parse(encoded);
        const field = address.slice(3);
        const next = clone(state);
        const run = next.runs[name];
        const previous = run.value.sc[field];
        run.value.sc[field] = parsed;
        run.changes.push({ step: run.changes.length + 1, address, before: previous ?? null, after: parsed });
        commit(next);
        const previousBoard = boards.get(name);
        let nextBoard = createPxC();
        for (const [partAddress, partValue] of previousBoard.parts) {
          if (partAddress !== address && !partAddress.startsWith(address + '.')) {
            nextBoard = registerPart(nextBoard, partAddress, partValue);
          }
        }
        nextBoard = flattenInto(nextBoard, registerPart, address, parsed);
        boards.set(name, { ...nextBoard, telemetry: previousBoard.telemetry });
        return run.changes.at(-1);
      },
      inspect() {
        return clone(entry(name));
      },
    };
  }
  function validateSeed(id, world) {
    if (!validId(id) || !Object.hasOwn(worlds, world)) throw Error('Known world and simple sandbox id required');
  }
  function allocate({ name, id, world, kind, iteration, replayOf }) {
    const next = clone(state);
    const seed = clone(worlds[world]);
    next.runs[name] = {
      name, id, kind,
      ...(iteration === undefined ? {} : { iteration }),
      ...(replayOf === undefined ? {} : { replayOf }),
      world, seedIdentity, seed, value: seed, changes: [],
    };
    commit(next);
    boards.set(name, buildBoard(next.runs[name].value));
    return handle(name);
  }
  function openInteractive(id, world = 'shelf') {
    validateSeed(id, world);
    const name = `mock.${id}`;
    if (Object.hasOwn(state.runs, name)) {
      const existing = entry(name);
      if (existing.kind !== 'interactive' || existing.world !== world) throw Error(`Existing sandbox ${name} has a different kind or world`);
      return handle(name);
    }
    return allocate({ name, id, world, kind: 'interactive' });
  }
  function createTestRun(id, world = 'shelf', opts = {}) {
    validateSeed(id, world);
    const iteration = Math.max(0, ...Object.values(state.runs).filter(run => run.id === id && Number.isSafeInteger(run.iteration)).map(run => run.iteration)) + 1;
    if (!Number.isSafeInteger(iteration)) throw Error(`Test iterator exhausted for ${id}`);
    return allocate({ name: `mock.${id}.${iteration}`, id, world, kind: opts.kind ?? 'test', iteration, replayOf: opts.replayOf });
  }
  function recordResult(result) {
    const { testFile, testName, ok } = result ?? {};
    if (typeof testFile !== 'string' || typeof testName !== 'string' || typeof ok !== 'boolean') throw Error('recordResult needs {testFile, testName, ok}');
    const next = clone(state);
    next.results.push({ testFile, testName, ok, error: result.error ?? null, ranAt: new Date().toISOString(), runs: Object.keys(next.runs) });
    commit(next);
  }
  function list() {
    return Object.values(state.runs).map(({ name, id, kind, iteration, world, seedIdentity, replayOf }) => ({
      name, id, kind: kind ?? 'legacy', iteration, world, seedIdentity,
      ...(replayOf === undefined ? {} : { replayOf }),
    }));
  }
  function inspect() {
    return clone(state);
  }
  return { openInteractive, createTestRun, recordResult, handle, list, inspect };
}

// The shell side: one kernel per storage key. Frames on the same page call
// the kernel API directly, so there is no wire surface and no messages.
export function createPxcHost({ storage, seeds, pxc }) {
  const kernels = new Map();
  const experienceForKey = new Map();
  function kernelFor(key, seedIdentity = 'pxc-host') {
    if (!kernels.has(key)) {
      kernels.set(key, createPxcKernel({ storage, key, seedIdentity, seeds, pxc }));
    }
    return kernels.get(key);
  }
  return { kernelFor, kernels, experienceForKey };
}
