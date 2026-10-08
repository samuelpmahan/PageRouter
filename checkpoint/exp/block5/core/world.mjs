import { cloneJson, validateJson } from './canonical.mjs';

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 360;
const MAX_ENTITIES = 512;

function random32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function validateWorld(world) {
  validateJson(world, 'world');
  if (!world || Array.isArray(world) || typeof world !== 'object') throw new TypeError('World must be an object.');
  if (!Number.isInteger(world.tick) || world.tick < 0) throw new TypeError('World tick must be a nonnegative integer.');
  if (!Number.isInteger(world.seed) || world.seed < 0 || world.seed > 0xffffffff) throw new TypeError('World seed must be uint32.');
  if (!world.bounds || !Number.isFinite(world.bounds.width) || !Number.isFinite(world.bounds.height) || world.bounds.width <= 0 || world.bounds.height <= 0) {
    throw new TypeError('World bounds must have positive finite width and height.');
  }
  if (!Array.isArray(world.entities) || world.entities.length > MAX_ENTITIES) throw new TypeError(`World entities must be an array of at most ${MAX_ENTITIES}.`);
  const seen = new Set();
  for (const entity of world.entities) {
    if (!entity || typeof entity.id !== 'string' || entity.id.length === 0 || seen.has(entity.id)) throw new TypeError('World entity IDs must be unique nonempty strings.');
    seen.add(entity.id);
    for (const field of ['x', 'y', 'vx', 'vy', 'energy', 'forceX', 'forceY']) {
      if (!Number.isFinite(entity[field])) throw new TypeError(`Entity ${entity.id} needs finite ${field}.`);
    }
    if (entity.energy < 0) throw new TypeError(`Entity ${entity.id} energy cannot be negative.`);
  }
  return world;
}

export function createInitialWorld({ seed = 1, entityCount = 48, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Seed must be uint32.');
  if (!Number.isInteger(entityCount) || entityCount < 0 || entityCount > MAX_ENTITIES) throw new TypeError(`Entity count must be an integer from 0 through ${MAX_ENTITIES}.`);
  if (!Number.isFinite(width) || width < 32 || !Number.isFinite(height) || height < 32) throw new TypeError('World width and height must be finite and at least 32.');
  const random = random32(seed);
  const entities = Array.from({ length: entityCount }, (_, index) => ({
    id: `e${String(index).padStart(4, '0')}`,
    x: 16 + random() * (width - 32),
    y: 16 + random() * (height - 32),
    vx: (random() - 0.5) * 2,
    vy: (random() - 0.5) * 2,
    energy: 80 + Math.floor(random() * 21),
    forceX: 0,
    forceY: 0,
  }));
  return validateWorld({ tick: 0, seed, bounds: { width, height }, entities });
}

export function normalizeWorld(world) {
  return cloneJson(validateWorld(world));
}

export const WORLD_IMPLEMENTATION_SOURCE = [
  `bounds:${DEFAULT_WIDTH}:${DEFAULT_HEIGHT}:maximum-entities:${MAX_ENTITIES}`,
  random32.toString(),
  validateWorld.toString(),
  createInitialWorld.toString(),
  normalizeWorld.toString(),
].join('\n');
