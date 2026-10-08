import { cloneJson, validateJson } from './canonical.mjs';
import { parseRules, replay } from './grid-engine.mjs';
import { CALCULATIONS } from './providers.mjs';

export const GRID_WORDS = Object.freeze(['BABA', 'WALL', 'ROCK', 'FLAG', 'IS', 'YOU', 'STOP', 'PUSH', 'WIN']);
export const GRID_KINDS = Object.freeze(['baba', 'wall', 'rock', 'flag', 'text']);

export const DEFAULT_GRID_OBJECTS = Object.freeze([
  { id: 'text-baba', x: 0, y: 0, kind: 'text', word: 'BABA' },
  { id: 'text-is-you', x: 1, y: 0, kind: 'text', word: 'IS' },
  { id: 'text-you', x: 2, y: 0, kind: 'text', word: 'YOU' },
  { id: 'text-wall', x: 0, y: 1, kind: 'text', word: 'WALL' },
  { id: 'text-is-stop', x: 1, y: 1, kind: 'text', word: 'IS' },
  { id: 'text-stop', x: 2, y: 1, kind: 'text', word: 'STOP' },
  { id: 'text-rock', x: 0, y: 2, kind: 'text', word: 'ROCK' },
  { id: 'text-is-push', x: 1, y: 2, kind: 'text', word: 'IS' },
  { id: 'text-push', x: 2, y: 2, kind: 'text', word: 'PUSH' },
  { id: 'text-flag', x: 1, y: 5, kind: 'text', word: 'FLAG' },
  { id: 'text-is-win', x: 2, y: 5, kind: 'text', word: 'IS' },
  { id: 'text-win', x: 3, y: 5, kind: 'text', word: 'WIN' },
  { id: 'baba', x: 1, y: 6, kind: 'baba' },
  { id: 'wall', x: 5, y: 4, kind: 'wall' },
  { id: 'rock', x: 6, y: 4, kind: 'rock' },
  { id: 'flag', x: 7, y: 4, kind: 'flag' },
]);

export const DEFAULT_GRID_RECIPE = Object.freeze({
  id: 'grid-card-stack-v1',
  name: 'Push WIN to break FLAG IS WIN',
  rules: Object.freeze([
    Object.freeze({ id: 'right-1', calculation: CALCULATIONS.gridStep, enabled: true, parameters: Object.freeze({ direction: 'R' }) }),
    Object.freeze({ id: 'right-2', calculation: CALCULATIONS.gridStep, enabled: true, parameters: Object.freeze({ direction: 'R' }) }),
    Object.freeze({ id: 'up-1', calculation: CALCULATIONS.gridStep, enabled: true, parameters: Object.freeze({ direction: 'U' }) }),
    Object.freeze({ id: 'right-3', calculation: CALCULATIONS.gridStep, enabled: true, parameters: Object.freeze({ direction: 'R' }) }),
  ]),
});

export function validateGridWorld(world) {
  validateJson(world, 'grid world');
  if (!world || typeof world !== 'object' || Array.isArray(world) || !Number.isInteger(world.width) || world.width < 1 || !Number.isInteger(world.height) || world.height < 1 || !Array.isArray(world.objects)) {
    throw new TypeError('Grid world needs positive integer dimensions and an object array.');
  }
  const ids = new Set();
  for (const object of world.objects) {
    if (!object || typeof object !== 'object' || Array.isArray(object) || typeof object.id !== 'string' || !object.id || ids.has(object.id)) throw new TypeError('Grid pieces need unique nonempty IDs.');
    ids.add(object.id);
    if (!Number.isInteger(object.x) || !Number.isInteger(object.y) || object.x < 0 || object.y < 0 || object.x >= world.width || object.y >= world.height) throw new TypeError(`Grid piece ${object.id} is outside the board.`);
    if (!GRID_KINDS.includes(object.kind)) throw new TypeError(`Grid piece ${object.id} has invalid kind.`);
    if (object.kind === 'text' && !GRID_WORDS.includes(object.word)) throw new TypeError(`Text piece ${object.id} has invalid word.`);
    if (object.kind !== 'text' && Object.hasOwn(object, 'word')) throw new TypeError(`Non-text piece ${object.id} cannot have a word.`);
  }
  return world;
}

export function createGridWorld({ width = 9, height = 8, objects = DEFAULT_GRID_OBJECTS } = {}) {
  return normalizeGridWorld({ width, height, objects });
}

export function normalizeGridWorld(world) {
  validateGridWorld(world);
  const level = { width: world.width, height: world.height, objects: cloneJson(world.objects) };
  return replay(level, '')[0];
}

export function editGridObject(world, id, patch) {
  validateGridWorld(world);
  validateJson(patch, 'grid piece edit');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['x', 'y', 'kind', 'word'].includes(key))) throw new TypeError('Grid edit may set x, y, kind, or word only.');
  const found = world.objects.find(object => object.id === id);
  if (!found) throw new TypeError(`Unknown grid piece ${String(id)}.`);
  const objects = world.objects.map(object => {
    if (object.id !== id) return cloneJson(object);
    const updated = { ...object, ...cloneJson(patch) };
    if (updated.kind !== 'text') delete updated.word;
    return updated;
  });
  return createGridWorld({ width: world.width, height: world.height, objects });
}

export { parseRules as parseGridRules };
