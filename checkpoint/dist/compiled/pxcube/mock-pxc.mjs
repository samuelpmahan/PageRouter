// Tiny mock PxC for the hypervisor packaging experiment.
// Worlds are addressed by mount name at the hypervisor seam.
// App source refers to data as {MOUNT}.{px|fn|oc|sc}.*, but the persisted
// Part address is {px|fn|oc|sc}.* with the mount prefix NOT persisted.

export const NAMESPACES = ['px', 'fn', 'oc', 'sc'];

export const worlds = {
  shelf: {
    px: {
      discs: [
        { mold: 'Buzzz', maker: 'Discraft', speed: 5, glide: 4, turn: -1, fade: 1 },
        { mold: 'Destroyer', maker: 'Innova', speed: 12, glide: 5, turn: -1, fade: 3 },
      ],
      'discs.buzzz': { mold: 'Buzzz', maker: 'Discraft', speed: 5, glide: 4, turn: -1, fade: 1 },
      makers: ['Discraft', 'Innova', 'MVP'],
    },
    fn: {
      'flight.total': 10,
      flight: { total: 10, average: 9.5 },
    },
    oc: {
      'sync.now': '2026-09-14T00:00:00.000Z',
    },
    sc: {
      draft: { name: 'Untitled bag', slots: [] },
    },
  },
  studio: {
    px: {
      shows: [
        { title: 'Morning rounds', discs: 3 },
        { title: 'Battle night', discs: 8 },
      ],
      cards: { corner: { visible: true } },
    },
    fn: {
      render: { fps: 30 },
    },
    oc: {
      clock: { epoch: 1726272000 },
    },
    sc: {
      project: { name: 'Demo studio' },
    },
  },
};

export function listWorlds() {
  return Object.keys(worlds);
}

export function hasWorld(name) {
  return Object.prototype.hasOwnProperty.call(worlds, name);
}

export function resolveAddress(world, address) {
  if (!hasWorld(world)) {
    throw new Error(`resolveAddress: unknown world "${world}"`);
  }
  if (typeof address !== 'string' || address.length === 0) {
    throw new Error('resolveAddress: address must be a non-empty string');
  }
  if (address.startsWith(`${world}.`)) {
    throw new Error(
      `resolveAddress: address "${address}" carries a mount prefix; ` +
      `persisted/resolved addresses must be px|fn|oc|sc.* without the mount prefix`,
    );
  }
  const [ns, ...rest] = address.split('.');
  if (!NAMESPACES.includes(ns)) {
    throw new Error(`resolveAddress: unknown namespace "${ns}" (expected one of ${NAMESPACES.join(', ')})`);
  }
  return resolveWorldValue(worlds[world], address);
}

// Same resolution law for an explicitly owned world instance. The original
// fixture resolver above keeps its public contract and shared fixture values.
export function resolveWorldValue(value, address) {
  if (typeof address !== 'string' || !address) throw new Error('A non-empty inner address is required');
  const [ns, ...rest] = address.split('.');
  if (!NAMESPACES.includes(ns) || rest.some(key => !key)) throw new Error(`Invalid inner address: ${address}`);
  let node = value[ns];
  if (node === undefined) {
    throw new Error(`resolveAddress: namespace "${ns}" missing in world instance`);
  }
  // Dotted-path traversal. At each level the longest remaining dotted key is
  // tried first, so literal keys like 'discs.buzzz' resolve alongside nested
  // objects like 'flight.total'.
  let i = 0;
  while (i < rest.length) {
    if (node === null || typeof node !== 'object') {
      throw new Error(`resolveAddress: no path "${address}" in world instance`);
    }
    let found = false;
    for (let j = rest.length; j > i; j--) {
      const key = rest.slice(i, j).join('.');
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        node = node[key];
        i = j;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`resolveAddress: no path "${address}" in world instance`);
    }
  }
  return node;
}
