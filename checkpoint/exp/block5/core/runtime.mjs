import { Part, PxC } from '../../../vendor/hh/services/pxc.mjs';
import { canonicalJson, cloneJson, hashState, validateJson } from './canonical.mjs';
import { executeComposedCalculation, prepareComposedCalculation } from './composed.mjs';
import { validateTickStream } from './events.mjs';
import { createPixelCache } from './pixel-cache.mjs';
import { DEFAULT_RECIPE, PROVIDER_IDENTITY, resolveProvider, validateRecipe } from './providers.mjs';
import { createInitialWorld, normalizeWorld } from './world.mjs';
import { createGridWorld, DEFAULT_GRID_RECIPE, normalizeGridWorld } from './grid-world.mjs';

const VALID_MODES = new Set(['uncached', 'atomic', 'composed']);
const atomicCacheScopes = new Map();
const clone = value => cloneJson(value);
const now = () => globalThis.performance?.now?.() ?? Date.now();

function atomicCacheScope(calculation) {
  if (!atomicCacheScopes.has(calculation)) atomicCacheScopes.set(calculation, canonicalJson({ provider: PROVIDER_IDENTITY, calculation, program: null }));
  return atomicCacheScopes.get(calculation);
}

function activeRules(recipe) {
  return recipe.rules.filter(rule => rule.enabled !== false);
}

function equalJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function matchingProgramAt(program, rules, start, inputByPort) {
  if (!program || start + program.nodes.length > rules.length) return null;
  let statePort = null;
  const parameterByPort = new Map();
  for (let index = 0; index < program.nodes.length; index += 1) {
    const node = program.nodes[index];
    const rule = rules[start + index];
    if (node.calculation !== rule.calculation) return null;
    const [stateBinding, parameterBinding] = node.inputs;
    if (index === 0) {
      if (stateBinding.kind !== 'input' || !inputByPort.has(stateBinding.port)) return null;
      statePort = stateBinding.port;
    } else if (stateBinding.kind !== 'node' || stateBinding.nodeId !== program.nodes[index - 1].id) return null;
    if (parameterBinding.kind !== 'input' || !inputByPort.has(parameterBinding.port)) return null;
    if (parameterBinding.port === statePort) return null;
    if (parameterByPort.has(parameterBinding.port) && canonicalJson(parameterByPort.get(parameterBinding.port)) !== canonicalJson(rule.parameters)) return null;
    parameterByPort.set(parameterBinding.port, rule.parameters);
  }
  return { length: program.nodes.length, statePort };
}

export function selectComposedCalculation(candidates, recipe) {
  if (!Array.isArray(candidates)) throw new TypeError('Discovered calculations must be an array.');
  validateRecipe(recipe);
  const rules = activeRules(recipe);
  const applicable = [];
  for (const candidate of candidates) {
    const prepared = prepareComposedCalculation(candidate);
    const program = prepared.program;
    if (program.training.eventIds.length === 0 || program.training.occurrenceCount < 2) continue;
    const ports = new Set(program.inputs.map(input => input.port));
    for (let start = 0; start + program.nodes.length <= rules.length; start += 1) {
      if (matchingProgramAt(program, rules, start, ports)) {
        applicable.push({ candidate, length: program.nodes.length, id: program.id, start });
        break;
      }
    }
  }
  applicable.sort((left, right) => right.length - left.length || left.id.localeCompare(right.id) || left.start - right.start);
  return applicable[0]?.candidate ?? null;
}

function addEvent({ stream, events, diagnostics, ledger, previousRun, cacheHit, tick, rule, ruleIndex, inputs, inputRefs, output, ordinal }) {
  const id = `block5:t${tick}:r${ruleIndex}:${encodeURIComponent(rule.id)}`;
  const outputRef = `event:${id}:output`;
  const previousEvent = previousRun?.stream?.events?.find(event => event.id === id) ?? null;
  const sameProvider = previousEvent?.provider?.id === PROVIDER_IDENTITY.id && previousEvent?.provider?.version === PROVIDER_IDENTITY.version && previousEvent?.provider?.implementationId === PROVIDER_IDENTITY.implementationId;
  const mayAffect = previousEvent ? !sameProvider || previousEvent.calculation !== rule.calculation || !equalJson(previousEvent.inputs, inputs) : true;
  const didAffect = previousEvent ? !equalJson(previousEvent.output, output) : true;
  const firstExecution = previousEvent === null;
  const dependencies = inputRefs.flatMap(ref => {
    const owner = events.find(event => event.outputRef === ref);
    return owner ? [owner.id] : [];
  });
  const event = {
    id,
    tick,
    sequence: ordinal * 2,
    kind: 'calculation',
    calculation: rule.calculation,
    provider: PROVIDER_IDENTITY,
    inputRefs,
    inputs: clone(inputs),
    outputRef,
    output: clone(output),
    dependencies,
    stateHash: hashState(output),
  };
  const diagnostic = {
    id: `diagnostic:${id}`,
    tick,
    sequence: ordinal * 2 + 1,
    kind: 'cache',
    eventId: id,
    cacheHit,
    mayAffect,
    didAffect,
    firstExecution,
  };
  events.push(event);
  diagnostics.push(diagnostic);
  ledger.push({ eventId: id, tick, calculation: rule.calculation, cacheHit, mayAffect, didAffect, firstExecution, provider: PROVIDER_IDENTITY });
  return event;
}

async function runAtomicEvent({ pxc, cache, mode, state, parameters, calculation, address, receipts }) {
  const provider = resolveProvider(calculation);
  const keyRequest = { provider: PROVIDER_IDENTITY, calculation, inputs: [state, parameters] };
  const cacheScope = mode === 'atomic' ? atomicCacheScope(calculation) : null;
  const cacheInputs = keyRequest.inputs;
  const canonicalCacheInputs = mode === 'atomic' ? canonicalJson(cacheInputs) : null;
  let cacheHit = false;
  const stateAddress = `${address}:state`;
  const parameterAddress = `${address}:parameters`;
  const calculationAddress = `${address}:calculation`;
  const outputAddress = `${address}:output`;
  pxc.set(stateAddress, new Part(state));
  pxc.set(parameterAddress, new Part(parameters));
  pxc.set(calculationAddress, new Part(async ({ state: inputState, parameters: inputParameters }) => {
    if (mode === 'atomic') {
      const found = cache.lookupScopedCanonical ? cache.lookupScopedCanonical(cacheScope, canonicalCacheInputs, { borrowed: true }) : cache.lookup(keyRequest);
      if (found.hit) {
        cacheHit = true;
        return found.value;
      }
    }
    const output = await provider.run(inputState, inputParameters);
    validateJson(output, `output from ${calculation}`);
    if (mode === 'atomic') {
      if (cache.storeScopedCanonical) cache.storeScopedCanonical(cacheScope, canonicalCacheInputs, output);
      else cache.store(keyRequest, output);
    }
    return output;
  }));
  const output = await pxc.compose({
    into: outputAddress,
    calculation: calculationAddress,
    inputs: { state: stateAddress, parameters: parameterAddress },
  });
  receipts.push(pxc.receipts().at(-1));
  return { output: output.value, cacheHit };
}

async function runRecipe({
  initialState,
  recipe,
  ticks = 1,
  mode = 'uncached',
  cache = null,
  previousRun = null,
  program = null,
  inputs = {},
  createInitial,
  normalizeInitial,
} = {}) {
  const started = now();
  if (!VALID_MODES.has(mode)) throw new TypeError(`Unknown simulation mode: ${String(mode)}.`);
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > 1000) throw new TypeError('Ticks must be an integer from 0 through 1000.');
  validateJson(inputs, 'simulation input overrides');
  const activeCache = cache ?? createPixelCache();
  if (typeof activeCache.lookup !== 'function' || typeof activeCache.store !== 'function') throw new TypeError('Simulation cache must come from createPixelCache().');
  const suppliedState = inputs['input:state'] ?? inputs.state ?? initialState;
  const world = normalizeInitial(suppliedState ?? createInitial());
  const recipeValue = clone(recipe);
  if (!recipeValue || !Array.isArray(recipeValue.rules)) throw new TypeError('Recipe needs a rules array.');
  for (const rule of recipeValue.rules) {
    const parameterRef = `input:parameters:${rule.id}`;
    if (Object.hasOwn(inputs, parameterRef)) rule.parameters = clone(inputs[parameterRef]);
  }
  validateRecipe(recipeValue);
  const rules = activeRules(recipeValue);
  let composedProgram = program;
  let composedPlan = null;
  let composedInputByPort = null;
  if (mode === 'composed' && composedProgram) {
    composedPlan = prepareComposedCalculation(composedProgram);
    composedProgram = composedPlan.program;
    composedInputByPort = new Set(composedProgram.inputs.map(input => input.port));
  }

  const events = [];
  const diagnosticEvents = [
    { id: 'diagnostic:recipe:adopted', tick: 0, sequence: -2, kind: 'recipe', recipeId: recipeValue.id, recipeRef: 'input:recipe', recipeHash: hashState(recipeValue) },
    { id: 'diagnostic:simulation:start', tick: 0, sequence: -1, kind: 'simulation', phase: 'start', initialStateHash: hashState(world) },
  ];
  const ledger = [];
  const receipts = [];
  const compositionUsage = [];
  const pxc = new PxC();
  let state = world;
  let previousOutputRef = 'input:state';
  let ordinal = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    for (let ruleOffset = 0; ruleOffset < rules.length;) {
      const group = mode === 'composed' && composedProgram ? matchingProgramAt(composedProgram, rules, ruleOffset, composedInputByPort) : null;
      if (group) {
        const nodeToRule = new Map(composedProgram.nodes.map((node, index) => [node.id, rules[ruleOffset + index]]));
        const overrides = Object.fromEntries(composedProgram.inputs.map(input => [input.port, clone(input.defaultValue)]));
        overrides[group.statePort] = clone(state);
        for (let index = 0; index < composedProgram.nodes.length; index += 1) {
          const parameterPort = composedProgram.nodes[index].inputs[1].port;
          const value = rules[ruleOffset + index].parameters;
          for (let other = 0; other < index; other += 1) {
            if (composedProgram.nodes[other].inputs[1].port === parameterPort && canonicalJson(rules[ruleOffset + other].parameters) !== canonicalJson(value)) throw new Error('Preflight invariant: unsupported composed input reuse.');
          }
          overrides[parameterPort] = clone(value);
        }
        for (const [key, value] of Object.entries(inputs)) {
          const input = composedProgram.inputs.find(candidate => candidate.port === key || candidate.sourceRef === key);
          if (input && input.port !== group.statePort && !composedProgram.nodes.some(node => node.inputs[1].port === input.port)) overrides[input.port] = clone(value);
        }
        const composed = await executeComposedCalculation({ prepared: composedPlan, inputs: overrides, cache: activeCache, borrowCachedResult: true });
        receipts.push(...composed.receipts);
        compositionUsage.push({ tick, firstRuleIndex: recipeValue.rules.indexOf(rules[ruleOffset]), count: group.length, programId: composedProgram.id, used: true, cacheHit: composed.cacheHit });
        for (let index = 0; index < group.length; index += 1) {
          const rule = rules[ruleOffset + index];
          const node = composed.nodes[index];
          const stateRef = previousOutputRef;
          const parameterRef = `input:parameters:${rule.id}`;
          const event = addEvent({ events, diagnostics: diagnosticEvents, ledger, previousRun, cacheHit: composed.cacheHit, tick, rule, ruleIndex: recipeValue.rules.indexOf(rule), inputs: node.inputs, inputRefs: [stateRef, parameterRef], output: node.value, ordinal });
          state = clone(event.output);
          previousOutputRef = event.outputRef;
          ordinal += 1;
        }
        ruleOffset += group.length;
        continue;
      }

      const rule = rules[ruleOffset];
      const ruleIndex = recipeValue.rules.indexOf(rule);
      const parameters = clone(rule.parameters);
      const stateRef = previousOutputRef;
      const parameterRef = `input:parameters:${rule.id}`;
      const { output, cacheHit } = await runAtomicEvent({
        pxc,
        cache: activeCache,
        mode: mode === 'uncached' ? 'uncached' : 'atomic',
        state,
        parameters,
        calculation: rule.calculation,
        address: `block5:event:${ordinal}:${ruleIndex}`,
        receipts,
      });
      const event = addEvent({
        events,
        diagnostics: diagnosticEvents,
        ledger,
        previousRun,
        cacheHit,
        tick,
        rule,
        ruleIndex,
        inputs: [state, parameters],
        inputRefs: [stateRef, parameterRef],
        output,
        ordinal,
      });
      state = clone(event.output);
      previousOutputRef = event.outputRef;
      ordinal += 1;
      compositionUsage.push({ tick, firstRuleIndex: ruleIndex, count: 1, programId: composedProgram?.id ?? null, used: false, reason: mode !== 'composed' ? 'mode-not-composed' : composedProgram ? 'no-matching-substructure' : 'no-discovered-program' });
      ruleOffset += 1;
    }
  }

  const stream = {
    format: 'pagerouter.block5.tick-stream.v1',
    source: PROVIDER_IDENTITY,
    initialState: clone(world),
    recipe: recipeValue,
    events,
    finalStateHash: hashState(state),
    diagnosticEvents,
  };
  diagnosticEvents.push({ id: 'diagnostic:simulation:end', tick: Math.max(0, ticks - 1), sequence: events.length * 2 + 1, kind: 'simulation', phase: 'end', finalStateHash: hashState(state), eventCount: events.length });
  validateTickStream(stream);
  const finalStateHash = hashState(state);
  return {
    state: clone(state),
    stream,
    ledger,
    cache: activeCache,
    cacheStats: activeCache.stats?.() ?? null,
    providerIdentity: PROVIDER_IDENTITY,
    receipts,
    hashes: events.map(event => event.stateHash),
    finalStateHash,
    compositionUsage,
    mode,
    program: composedProgram,
    elapsedMs: now() - started,
  };
}

export function runSimulation(options = {}) {
  return runRecipe({
    ...options,
    recipe: options.recipe ?? DEFAULT_RECIPE,
    createInitial: () => createInitialWorld(),
    normalizeInitial: normalizeWorld,
  });
}

export function runGridRecipe(options = {}) {
  return runRecipe({
    ...options,
    recipe: options.recipe ?? DEFAULT_GRID_RECIPE,
    createInitial: () => createGridWorld(),
    normalizeInitial: normalizeGridWorld,
  });
}

export const replayRecipe = options => runSimulation(options);

export function createBlock5Runtime({ initialState = null, recipe = DEFAULT_RECIPE, mode = 'atomic', program = null } = {}) {
  let state = normalizeWorld(initialState ?? createInitialWorld());
  let lastRun = null;
  const cache = createPixelCache();
  return Object.freeze({
    async dispatch({ type = 'simulate', ticks = 1 } = {}) {
      if (type === 'reset') {
        state = normalizeWorld(initialState ?? createInitialWorld());
        lastRun = null;
        cache.clear();
        return { state: clone(state), accepted: true };
      }
      if (type !== 'simulate') throw new TypeError(`Unknown runtime event: ${String(type)}.`);
      lastRun = await runSimulation({ initialState: state, recipe, ticks, mode, cache, previousRun: lastRun, program });
      state = clone(lastRun.state);
      return { state: clone(state), run: lastRun, accepted: true };
    },
    state() { return clone(state); },
    stream() { return lastRun?.stream ?? null; },
    ledger() { return clone(lastRun?.ledger ?? []); },
    inspect() { return { state: clone(state), receipts: lastRun?.receipts ?? [], ledger: clone(lastRun?.ledger ?? []), cacheStats: cache.stats() }; },
    cache,
  });
}
