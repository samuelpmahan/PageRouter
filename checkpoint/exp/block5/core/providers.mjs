import { cloneJson, canonicalJson, validateJson } from './canonical.mjs';
import { validateWorld, createInitialWorld, WORLD_IMPLEMENTATION_SOURCE } from './world.mjs';
import { step as gridStep } from './grid-engine.mjs';

const setupStarted = globalThis.performance?.now?.() ?? Date.now();

async function readGridEngineSource() {
  const sourceUrl = new URL('./grid-engine.mjs', import.meta.url);
  if (sourceUrl.protocol === 'http:' || sourceUrl.protocol === 'https:') {
    const response = await fetch(sourceUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Cannot pin grid engine source: HTTP ${response.status}.`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), method: 'same-origin-fetch' };
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    return { bytes: new Uint8Array(await readFile(sourceUrl)), method: 'node-file' };
  }
  throw new Error('Cannot read grid engine source for provider pinning in this runtime.');
}

async function sha256BytesHex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256TextHex(text) {
  return sha256BytesHex(new TextEncoder().encode(text));
}

const gridEngineSource = await readGridEngineSource();
export const GRID_ENGINE_SHA256 = await sha256BytesHex(gridEngineSource.bytes);

export const CALCULATIONS = Object.freeze({
  neighborhoodForce: 'entity.neighborhood-force.v1',
  integrateBounds: 'entity.integrate-bounds.v1',
  energyDecay: 'entity.energy-decay.v1',
  gridStep: 'grid.step.v1',
});

function finiteParameter(parameters, name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const value = parameters[name] ?? fallback;
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`Rule parameter ${name} must be finite and between ${min} and ${max}.`);
  return value;
}

function neighborhoodForce(state, parameters) {
  validateWorld(state);
  validateJson(parameters, 'rule parameters');
  const radius = finiteParameter(parameters, 'radius', 96, { min: 0, max: 2000 });
  const strength = finiteParameter(parameters, 'strength', 0.018, { min: 0, max: 5 });
  const radiusSquared = radius * radius;
  const entities = state.entities;
  const forces = new Array(entities.length);

  // Deliberately pairwise: this is a real O(n^2) neighborhood calculation.
  for (let i = 0; i < entities.length; i += 1) {
    const current = entities[i];
    let forceX = 0;
    let forceY = 0;
    for (let j = 0; j < entities.length; j += 1) {
      if (i === j) continue;
      const other = entities[j];
      const dx = current.x - other.x;
      const dy = current.y - other.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared === 0 || distanceSquared > radiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const scale = strength * (radius - distance) / (radius * distance || 1);
      forceX += dx * scale;
      forceY += dy * scale;
    }
    forces[i] = { forceX, forceY };
  }
  return cloneJson({
    ...state,
    entities: entities.map((entity, index) => ({ ...entity, ...forces[index] })),
  });
}

function reflect(position, velocity, limit, restitution) {
  if (position < 0) return { position: Math.min(limit, -position), velocity: Math.abs(velocity) * restitution };
  if (position > limit) return { position: Math.max(0, limit - (position - limit)), velocity: -Math.abs(velocity) * restitution };
  return { position, velocity };
}

function integrateBounds(state, parameters) {
  validateWorld(state);
  validateJson(parameters, 'rule parameters');
  const dt = finiteParameter(parameters, 'dt', 1, { min: 0, max: 10 });
  const restitution = finiteParameter(parameters, 'restitution', 0.82, { min: 0, max: 1 });
  const entities = state.entities.map(entity => {
    const x = reflect(entity.x + entity.vx * dt + 0.5 * entity.forceX * dt * dt, entity.vx + entity.forceX * dt, state.bounds.width, restitution);
    const y = reflect(entity.y + entity.vy * dt + 0.5 * entity.forceY * dt * dt, entity.vy + entity.forceY * dt, state.bounds.height, restitution);
    return {
      ...entity,
      x: x.position,
      y: y.position,
      vx: x.velocity,
      vy: y.velocity,
      forceX: 0,
      forceY: 0,
    };
  });
  return cloneJson({ ...state, entities });
}

function energyDecay(state, parameters) {
  validateWorld(state);
  validateJson(parameters, 'rule parameters');
  const drain = finiteParameter(parameters, 'drain', 0.035, { min: 0, max: 10 });
  const entities = state.entities.map(entity => ({ ...entity, energy: Math.max(0, entity.energy - drain) }));
  return cloneJson({ ...state, tick: state.tick + 1, entities });
}

function gridStepCalculation(state, parameters) {
  validateJson(state, 'grid state');
  validateJson(parameters, 'grid rule parameters');
  if (!state || !Number.isInteger(state.width) || !Number.isInteger(state.height) || !Array.isArray(state.objects)) throw new TypeError('Grid step needs a rule-engine level state.');
  if (!parameters || Object.keys(parameters).length !== 1 || !['U', 'D', 'L', 'R'].includes(parameters.direction)) throw new TypeError('Grid direction must be U, D, L, or R.');
  return gridStep(state, parameters.direction);
}

const implementationFunctions = [
  neighborhoodForce, integrateBounds, energyDecay, gridStepCalculation,
  finiteParameter, reflect, validateWorld, createInitialWorld,
  cloneJson, validateJson, canonicalJson, gridStep,
];
const implementationSource = `${GRID_ENGINE_SHA256}\n${canonicalJson(CALCULATIONS)}\n${WORLD_IMPLEMENTATION_SOURCE}\n${implementationFunctions.map(fn => fn.toString()).join('\n')}`;
const implementationHex = await sha256TextHex(implementationSource);

export const PROVIDER_SETUP = Object.freeze({
  sourceBytes: gridEngineSource.bytes.byteLength,
  elapsedMs: (globalThis.performance?.now?.() ?? Date.now()) - setupStarted,
  method: gridEngineSource.method,
});

export const PROVIDER_IDENTITY = Object.freeze({
  id: 'pagerouter.block5',
  version: '1',
  implementationId: `block5-core-v1:sha256:${implementationHex}`,
});

export const DEFAULT_RECIPE = Object.freeze({
  id: 'orbit-stack-v1',
  name: 'Neighborhood orbit',
  rules: Object.freeze([
    Object.freeze({ id: 'neighbor-force', calculation: CALCULATIONS.neighborhoodForce, enabled: true, parameters: Object.freeze({ radius: 96, strength: 0.018 }) }),
    Object.freeze({ id: 'integrate', calculation: CALCULATIONS.integrateBounds, enabled: true, parameters: Object.freeze({ dt: 1, restitution: 0.82 }) }),
    Object.freeze({ id: 'energy', calculation: CALCULATIONS.energyDecay, enabled: true, parameters: Object.freeze({ drain: 0.035 }) }),
  ]),
});

const functions = new Map([
  [CALCULATIONS.neighborhoodForce, neighborhoodForce],
  [CALCULATIONS.integrateBounds, integrateBounds],
  [CALCULATIONS.energyDecay, energyDecay],
  [CALCULATIONS.gridStep, gridStepCalculation],
]);

export const PROVIDER_REGISTRY = Object.freeze(Object.fromEntries([...functions.keys()].map(calculation => [calculation, Object.freeze({
  calculation,
  provider: PROVIDER_IDENTITY,
  run: functions.get(calculation),
})])));

export function resolveProvider(calculation, providerIdentity = PROVIDER_IDENTITY) {
  const entry = Object.hasOwn(PROVIDER_REGISTRY, calculation) ? PROVIDER_REGISTRY[calculation] : null;
  if (!entry) throw new TypeError(`Unknown calculation provider: ${String(calculation)}.`);
  if (providerIdentity.id !== entry.provider.id || providerIdentity.version !== entry.provider.version || providerIdentity.implementationId !== entry.provider.implementationId) {
    throw new TypeError(`Provider identity mismatch for ${calculation}.`);
  }
  return entry;
}

export function validateRecipe(recipe) {
  validateJson(recipe, 'recipe');
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || typeof recipe.id !== 'string' || !Array.isArray(recipe.rules)) throw new TypeError('Recipe needs an id and a rules array.');
  const ids = new Set();
  for (const [index, rule] of recipe.rules.entries()) {
    if (!rule || typeof rule.id !== 'string' || !rule.id || ids.has(rule.id)) throw new TypeError(`Recipe rule ${index} needs a unique nonempty id.`);
    ids.add(rule.id);
    resolveProvider(rule.calculation);
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') throw new TypeError(`Recipe rule ${rule.id} enabled must be Boolean.`);
    if (!rule.parameters || typeof rule.parameters !== 'object' || Array.isArray(rule.parameters)) throw new TypeError(`Recipe rule ${rule.id} needs a parameter object.`);
  }
  return recipe;
}
