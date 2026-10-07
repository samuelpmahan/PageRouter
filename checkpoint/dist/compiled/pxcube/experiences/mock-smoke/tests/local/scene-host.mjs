// PxCube scene orchestration over an existing Part-first PxC handler.
// This does not create a second Part registry: the handler owns the one world
// store; this module owns only scene/world lifecycle and verified receipts.
export const PXC_SCENE_HOST_API = 'pxcube-scene-host@1';
export const PXC_HANDLER_API = 'pxcube-pxc-handler@1';

const validId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
const address = value => typeof value === 'string' && value.length > 0 && !value.startsWith('mount.');
const requiredHandler = ['createWorld', 'has', 'get', 'set', 'part', 'isPart', 'compose', 'addresses', 'receipts', 'hasService', 'getService', 'dispose'];
const requiredCapabilities = ['parts@1', 'calculations@1', 'receipts@1', 'services@1', 'world-dispose@1'];

function validateHandler(handler) {
  if (handler?.api !== PXC_HANDLER_API || handler.version !== 1 || !validId(handler.id) || !Array.isArray(handler.capabilities)) {
    throw Error(`PxC handler must implement ${PXC_HANDLER_API} version 1, with a simple id and capabilities.`);
  }
  for (const method of requiredHandler) if (typeof handler[method] !== 'function') throw Error(`PxC handler is missing ${method}().`);
  for (const capability of requiredCapabilities) {
    if (!handler.capabilities.includes(capability)) throw Error(`PxC handler lacks capability: ${capability}`);
  }
}

function snapshotValue(value, where) {
  if (typeof value === 'function') return value;
  try { return structuredClone(value); }
  catch { throw Error(`Part value at ${where} is not readable as a snapshot.`); }
}

function normalizeResources(scene, field) {
  const value = scene[field] ?? [];
  if (!Array.isArray(value)) throw Error(`Scene ${scene.id} ${field} must be an array.`);
  const seen = new Set();
  return value.map(item => {
    const resource = typeof item === 'string' ? { address: item, scope: field === 'provides' ? 'scene' : 'world' } : item;
    const allowedScopes = field === 'provides' ? ['world', 'scene'] : ['world', 'provider'];
    if (!resource || !address(resource.address) || !allowedScopes.includes(resource.scope ?? (field === 'provides' ? 'scene' : 'world')))
      throw Error(`Scene ${scene.id} has an invalid ${field} resource.`);
    const normalized = { address: resource.address, scope: resource.scope ?? (field === 'provides' ? 'scene' : 'world') };
    if (seen.has(normalized.address)) throw Error(`Scene ${scene.id} repeats ${field} address ${normalized.address}.`);
    seen.add(normalized.address);
    return normalized;
  });
}

function validateScene(scene) {
  if (!scene || scene.api !== PXC_SCENE_HOST_API || !validId(scene.id) || typeof scene.mount !== 'function') {
    throw Error(`Scene must implement ${PXC_SCENE_HOST_API} with an id and mount().`);
  }
  const requires = normalizeResources(scene, 'requires');
  const calculations = (scene.calculations ?? []).map(item => typeof item === 'string' ? item : item?.address);
  if (!Array.isArray(scene.calculations ?? []) || calculations.some(item => !address(item)) || new Set(calculations).size !== calculations.length)
    throw Error(`Scene ${scene.id} calculations must name unique PxC addresses.`);
  const provides = normalizeResources(scene, 'provides');
  if (!provides.length) throw Error(`Scene ${scene.id} must declare at least one output Part.`);
  const services = scene.services ?? [];
  if (!Array.isArray(services) || services.some(name => typeof name !== 'string' || !name.trim()) || new Set(services).size !== services.length)
    throw Error(`Scene ${scene.id} services must be unique named provider services.`);
  return { ...scene, requires, calculations, provides, services };
}

function planScenes(scenes, initialAddresses) {
  const providers = new Map();
  for (const scene of scenes) for (const part of scene.provides) {
    if (providers.has(part.address) || initialAddresses.has(part.address)) throw Error(`World has multiple owners for Part ${part.address}.`);
    providers.set(part.address, { scene: scene.id, scope: part.scope });
  }
  const pending = new Map(scenes.map(scene => [scene.id, scene]));
  const available = new Set(initialAddresses), order = [];
  while (pending.size) {
    const ready = [...pending.values()].filter(scene => scene.requires.every(item =>
      item.scope === 'provider' || available.has(item.address) || (providers.get(item.address)?.scope === 'world' && !pending.has(providers.get(item.address).scene))));
    if (!ready.length) {
      const blocked = [...pending.values()].map(scene => `${scene.id} needs ${scene.requires.filter(item => !available.has(item.address)).map(item => item.address).join(', ')}`).join('; ');
      throw Error(`Scene graph has an unresolved Part, local-scope leak, or cycle: ${blocked}`);
    }
    for (const scene of ready) {
      order.push(scene); pending.delete(scene.id);
      for (const part of scene.provides) if (part.scope === 'world') available.add(part.address);
    }
  }
  return { order, providers };
}

// Adapter helper for Part-first stores such as DiscStudio's PxC. `storeFor`
// returns that producer's actual store; no facade copies Parts or receipts.
export function createPartFirstHandler({ id = 'part-first', storeFor, storeOf = world => world,
  makePart, isPart, serviceFor = () => undefined, dispose = () => {} }) {
  if (typeof storeFor !== 'function' || typeof makePart !== 'function' || typeof isPart !== 'function') throw Error('Part-first handler needs storeFor, makePart, and isPart.');
  if (typeof storeOf !== 'function' || typeof serviceFor !== 'function') throw Error('Part-first handler needs storeOf and serviceFor functions.');
  const store = world => {
    const value = storeOf(world);
    if (!value) throw Error('PxC handler returned no Part-first store.');
    return value;
  };
  const hasService = (world, name) => serviceFor(world, name) !== undefined;
  const getService = (world, name) => {
    const result = serviceFor(world, name);
    if (result === undefined) throw Error(`Unknown provider service: ${name}`);
    return result;
  };
  return Object.freeze({
    api: PXC_HANDLER_API, id, version: 1,
    capabilities: Object.freeze(requiredCapabilities),
    // The handler creates the existing store only. The host below is the sole
    // initializer for declared input Parts, so adapters must not seed twice.
    createWorld: ({ id: worldId }) => storeFor({ id: worldId }),
    has: (world, address_) => store(world).entries().some(([candidate]) => candidate === address_),
    get: (world, address_) => store(world).get(address_),
    set: (world, address_, value) => store(world).set(address_, makePart(value)),
    part: makePart, isPart,
    compose: (world, spec) => store(world).compose(spec),
    addresses: world => store(world).entries().map(([address_]) => address_),
    receipts: world => store(world).receipts(),
    hasService, getService,
    summarizeReceipt(world, receipt) {
      const names = new Map(store(world).entries().map(([address_, part]) => [part, address_]));
      const composition = receipt.composition ?? {};
      const ref = part => names.get(part) ?? { inlinePart: true, valueType: part === null ? 'null' : typeof part?.value };
      return { status: receipt.status, into: receipt.into,
        calculation: ref(composition.calculation),
        inputs: Object.fromEntries(Object.entries(composition.inputs ?? {}).map(([name, part]) => [name, ref(part)])),
        ...(receipt.error ? { error: String(receipt.error) } : {}) };
    },
    dispose: (world, meta) => dispose(world, meta),
  });
}

export function createSceneHost({ handler }) {
  validateHandler(handler);
  const worlds = new Map();
  const reservations = new Set();

  async function composeWorld({ id, inputs = [], scenes = [] } = {}) {
    if (!validId(id)) throw Error('World needs a simple id.');
    if (worlds.has(id) || reservations.has(id)) throw Error(`World already open or opening: ${id}`);
    if (!Array.isArray(inputs) || !Array.isArray(scenes)) throw Error('World inputs and scenes must be arrays.');
    const seed = new Map();
    for (const item of inputs) {
      if (!item || !address(item.address) || seed.has(item.address) || !Object.hasOwn(item, 'value')) throw Error('World input Parts need unique addresses and explicit values.');
      let value;
      try { value = structuredClone(item.value); }
      catch { throw Error(`World input ${item.address} must be structured-cloneable data.`); }
      seed.set(item.address, { address: item.address, value, scope: 'world' });
    }
    const normalized = scenes.map(validateScene);
    if (new Set(normalized.map(scene => scene.id)).size !== normalized.length) throw Error('World scene ids must be unique.');
    const { order, providers } = planScenes(normalized, new Set(seed.keys()));
    // Missing Calculation Parts are rejected before a scene can execute.
    const calculationAddresses = [...new Set(normalized.flatMap(scene => scene.calculations))];
    reservations.add(id);
    let store;
    try { store = await handler.createWorld({ id }); }
    catch (error) { reservations.delete(id); throw error; }
    let disposed = false;
    const sceneReceipts = [];
    const mountedScenes = [];
    const ensureOpen = () => { if (disposed) throw Error(`World is closed: ${id}`); };
    const release = async ({ failed = false } = {}) => {
      if (disposed) return;
      disposed = true; worlds.delete(id); reservations.delete(id);
      const errors = [];
      for (const mounted of mountedScenes.slice().reverse()) {
        for (const cleanup of mounted.cleanups.slice().reverse()) {
          try { await cleanup(); } catch (error) { errors.push(String(error)); }
        }
        try { await mounted.scene.dispose?.({ worldId: id, sceneId: mounted.scene.id, failed }); }
        catch (error) { errors.push(String(error)); }
      }
      try { await handler.dispose(store, { id }); } catch (error) { errors.push(String(error)); }
      if (errors.length) throw Error(`World ${id} disposal had errors: ${errors.join('; ')}`);
    };
    try {
      for (const part of seed.values()) await handler.set(store, part.address, part.value);
      for (const calculation of calculationAddresses) if (!await handler.has(store, calculation)) throw Error(`Missing Calculation Part: ${calculation}`);
      const providerAvailable = new Set(seed.keys());
      // Preflight every mounted scene against the fresh producer store before
      // any scene runs, so a missing provider Part/service or occupied output
      // cannot be discovered only after earlier scenes have executed.
      for (const scene of order) {
        for (const name of scene.services) if (!handler.hasService(store, name)) throw Error(`Scene ${scene.id} requires missing provider service ${name}.`);
        for (const part of scene.provides) if (await handler.has(store, part.address)) throw Error(`Scene output Part already exists: ${part.address}`);
        for (const requirement of scene.requires) {
          if (requirement.scope === 'provider') {
            if (!await handler.has(store, requirement.address)) throw Error(`Scene ${scene.id} requires missing provider Part ${requirement.address}.`);
            providerAvailable.add(requirement.address);
            continue;
          }
          if (providerAvailable.has(requirement.address)) {
            if (!await handler.has(store, requirement.address)) throw Error(`Scene ${scene.id} requires missing Part ${requirement.address}.`);
          } else if (providers.get(requirement.address)?.scope !== 'world') {
            throw Error(`Scene ${scene.id} cannot read unexported Part ${requirement.address}.`);
          }
        }
      }
      const worldAvailable = new Set(providerAvailable);
      for (const scene of order) {
        const owned = new Set(scene.provides.map(item => item.address));
        const readable = new Set([...worldAvailable, ...scene.requires.map(item => item.address), ...owned]);
        const startAddresses = new Set(await handler.addresses(store));
        const startReceipt = (await handler.receipts(store)).length;
        const cleanups = [];
        const inlineParts = new Set();
        const mounted = { scene, cleanups };
        mountedScenes.push(mounted);
        const api = Object.freeze({
          worldId: id, sceneId: scene.id, handler: Object.freeze({ id: handler.id, version: handler.version }),
          service: name => { ensureOpen(); if (!scene.services.includes(name)) throw Error(`Scene ${scene.id} did not declare provider service ${name}.`); return handler.getService(store, name); },
          has: async address_ => { ensureOpen(); return readable.has(address_) && handler.has(store, address_); },
          get: async address_ => {
            ensureOpen(); if (!readable.has(address_)) throw Error(`Scene ${scene.id} did not declare Part ${address_}.`);
            return snapshotValue(handler.get(store, address_).value, address_);
          },
          part: value => { ensureOpen();
            let copy; try { copy = structuredClone(value); } catch { throw Error('Inline scene Parts must be structured-cloneable data.'); }
            const part = handler.part(copy); inlineParts.add(part); return part;
          },
          onDispose: cleanup => {
            ensureOpen(); if (typeof cleanup !== 'function') throw Error('onDispose needs a cleanup function.');
            cleanups.push(cleanup);
          },
          set: async (address_, value) => {
            ensureOpen(); if (!owned.has(address_)) throw Error(`Scene ${scene.id} does not own output Part ${address_}.`);
            if (await handler.has(store, address_)) throw Error(`Scene output Part already exists: ${address_}`);
            let copy; try { copy = structuredClone(value); } catch { throw Error('Scene output values must be structured-cloneable data.'); }
            await handler.set(store, address_, copy);
          },
          compose: async spec => {
            ensureOpen();
            if (!spec || !owned.has(spec.into)) throw Error(`Scene ${scene.id} does not own composed output ${spec?.into}.`);
            const calculationAddress = typeof spec.calculation === 'string' ? spec.calculation : null;
            if (!calculationAddress || !scene.calculations.includes(calculationAddress)) throw Error(`Scene ${scene.id} must invoke a declared Calculation by address.`);
            for (const [name, reference] of Object.entries(spec.inputs ?? {})) {
              if (typeof reference === 'string' && !readable.has(reference)) throw Error(`Scene ${scene.id} did not declare input Part ${reference} (${name}).`);
              if (typeof reference !== 'string' && (!handler.isPart(reference) || !inlineParts.has(reference)))
                throw Error(`Scene ${scene.id} input ${name} must use a declared address or a Part created by ctx.part().`);
            }
            if (await handler.has(store, spec.into)) throw Error(`Scene output Part already exists: ${spec.into}`);
            await handler.compose(store, spec);
          },
          output: async address_ => {
            ensureOpen(); if (!owned.has(address_)) throw Error(`Scene ${scene.id} does not own output Part ${address_}.`);
            return snapshotValue(handler.get(store, address_).value, address_);
          },
        });
        const result = await scene.mount(api);
        const outputs = scene.provides.map(item => item.address);
        for (const output of outputs) if (!await handler.has(store, output)) throw Error(`Scene ${scene.id} did not produce declared Part ${output}.`);
        const receipts = (await handler.receipts(store)).slice(startReceipt);
        if (receipts.some(receipt => receipt.status === 'failed')) throw Error(`Scene ${scene.id} has a failed PxC Calculation receipt.`);
        const unexpected = (await handler.addresses(store)).filter(item => !startAddresses.has(item) && !owned.has(item));
        if (unexpected.length) throw Error(`Scene ${scene.id} wrote undeclared Parts: ${unexpected.join(', ')}.`);
        const report = Object.freeze({ id: scene.id, status: 'PASS', requires: scene.requires.map(item => item.address), provides: outputs,
          calculations: [...scene.calculations], receipts: receipts.map(receipt => handler.summarizeReceipt ? handler.summarizeReceipt(store, receipt) : receipt), result: result ?? null });
        sceneReceipts.push(report);
        for (const item of scene.provides) if (item.scope === 'world') worldAvailable.add(item.address);
      }
      const visibleAddresses = [...worldAvailable];
      const visible = new Set(visibleAddresses);
      const publicScenes = sceneReceipts.map(scene => ({ id: scene.id, status: scene.status,
        requires: scene.requires.filter(address_ => visible.has(address_)),
        provides: scene.provides.filter(address_ => visible.has(address_)),
        calculations: scene.calculations,
        receipts: scene.receipts.filter(receipt => !receipt.into || visible.has(receipt.into)),
      }));
      const record = Object.freeze({ api: PXC_SCENE_HOST_API, id, handler: { id: handler.id, version: handler.version }, scenes: publicScenes });
      let closed = false;
      const handle = Object.freeze({
        id,
        inspect: () => { if (closed) throw Error(`World is closed: ${id}`); return { ...record, addresses: [...worldAvailable] }; },
        scene: sceneId => { if (closed) throw Error(`World is closed: ${id}`); const found = sceneReceipts.find(item => item.id === sceneId); if (!found) throw Error(`Unknown scene: ${sceneId}`); return found; },
        read: async address_ => {
          if (closed) throw Error(`World is closed: ${id}`);
          if (!worldAvailable.has(address_)) throw Error(`Part is not world-visible: ${address_}`);
          return snapshotValue(handler.get(store, address_).value, address_);
        },
        close: async () => { if (closed) return; closed = true; await release(); },
      });
      worlds.set(id, { handle, store, addresses: [...worldAvailable] });
      return handle;
    } catch (error) {
      const failure = error instanceof Error ? error : Error(String(error));
      try {
        const receipts = await handler.receipts(store);
        failure.sceneFailureEvidence = Object.freeze({ api: PXC_SCENE_HOST_API, worldId: id,
          handler: { id: handler.id, version: handler.version }, completedScenes: sceneReceipts.map(scene => scene.id),
          addresses: await handler.addresses(store),
          receipts: receipts.map(receipt => handler.summarizeReceipt ? handler.summarizeReceipt(store, receipt) : receipt),
          failure: String(error?.message ?? error),
        });
      } catch (evidenceError) { failure.sceneFailureEvidenceError = String(evidenceError); }
      try { await release({ failed: true }); } catch (disposeError) {
        failure.disposeError = String(disposeError);
      }
      throw failure;
    }
  }

  return Object.freeze({ api: PXC_SCENE_HOST_API, handler: Object.freeze({ id: handler.id, version: handler.version }),
    composeWorld, listWorlds: () => [...worlds.keys()], closeWorld: async id => {
      const found = worlds.get(id); if (!found) throw Error(`Unknown world: ${id}`); await found.handle.close();
    } });
}
