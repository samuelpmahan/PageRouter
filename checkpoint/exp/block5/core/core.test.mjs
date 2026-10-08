import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CALCULATIONS,
  DEFAULT_GRID_OBJECTS,
  DEFAULT_GRID_RECIPE,
  DEFAULT_RECIPE,
  GRID_ENGINE_SHA256,
  createGridWorld,
  createInitialWorld,
  createPixelCache,
  editGridObject,
  executeComposedCalculation,
  hashState,
  parseGridRules,
  prepareComposedCalculation,
  PROVIDER_IDENTITY,
  PROVIDER_SETUP,
  resolveProvider,
  runGridRecipe,
  runSimulation,
  selectComposedCalculation,
} from './index.mjs';
import { hash as copiedGridHash } from './grid-engine.mjs';
import { discoverCalculations } from '../../compression/index.mjs';

const semantic = run => ({
  state: run.state,
  events: run.stream.events,
});

test('uncached simulation emits deterministic semantic tick events through PxC', async () => {
  const initialState = createInitialWorld({ seed: 19, entityCount: 16 });
  const recipe = structuredClone(DEFAULT_RECIPE);
  const first = await runSimulation({ initialState, recipe, ticks: 3, mode: 'uncached' });
  const second = await runSimulation({ initialState, recipe, ticks: 3, mode: 'uncached' });

  assert.deepEqual(semantic(first), semantic(second));
  assert.equal(first.stream.format, 'pagerouter.block5.tick-stream.v1');
  assert.equal(first.stream.events.length, 9);
  assert.equal(first.stream.events[0].sequence, 0);
  assert.equal(first.stream.events[1].sequence, 2);
  assert.deepEqual(first.stream.events[1].dependencies, [first.stream.events[0].id]);
  assert.equal(first.receipts.length, 9);
  assert.ok(first.receipts.every(receipt => receipt.status === 'produced'));
  assert.equal(first.stream.events.at(-1).stateHash, hashState(first.state));
});

test('atomic cache reuses exact calculations and reports input/output impact separately', async () => {
  const initialState = createInitialWorld({ seed: 23, entityCount: 1 });
  const cache = createPixelCache();
  const recipe = structuredClone(DEFAULT_RECIPE);
  const first = await runSimulation({ initialState, recipe, ticks: 2, mode: 'atomic', cache });
  const same = await runSimulation({ initialState, recipe, ticks: 2, mode: 'atomic', cache, previousRun: first });

  assert.deepEqual(semantic(same), semantic(first));
  assert.ok(same.ledger.every(row => row.cacheHit && !row.firstExecution && !row.mayAffect && !row.didAffect));

  const changedRecipe = structuredClone(recipe);
  changedRecipe.rules[0].parameters.strength += 1;
  const changed = await runSimulation({ initialState, recipe: changedRecipe, ticks: 2, mode: 'atomic', cache, previousRun: first });
  const forceRow = changed.ledger[0];
  assert.equal(forceRow.cacheHit, false);
  assert.equal(forceRow.mayAffect, true);
  assert.equal(forceRow.didAffect, false, 'one entity has no neighbors, so the force output stays equal');
  assert.ok([1, 2, 4, 5].every(index => changed.ledger[index].cacheHit), 'unchanged downstream rule inputs remain reusable');
});

test('composed calculation uses the fixed provider registry and retains every node output', async () => {
  const initialState = createInitialWorld({ seed: 31, entityCount: 8 });
  const recipe = structuredClone(DEFAULT_RECIPE);
  const training = await runSimulation({ initialState, recipe, ticks: 1, mode: 'uncached' });
  const providerIdentity = training.stream.source;
  const program = {
    format: 'pagerouter.composed-calculation.v1',
    id: 'test-composed-stack',
    providerIdentity,
    inputs: [
      { port: 'state', sourceRef: 'input:state', defaultValue: initialState },
      ...recipe.rules.map((rule, index) => ({ port: `parameters-${index}`, sourceRef: `input:parameters:${rule.id}`, defaultValue: rule.parameters })),
    ],
    nodes: recipe.rules.map((rule, index) => ({
      id: `n${index}`,
      calculation: rule.calculation,
      inputs: [
        index === 0 ? { kind: 'input', port: 'state' } : { kind: 'node', nodeId: `n${index - 1}` },
        { kind: 'input', port: `parameters-${index}` },
      ],
    })),
    outputs: recipe.rules.map((_, index) => ({ port: `o${index}`, nodeId: `n${index}` })),
    training: { patternId: 'test-stack', eventIds: training.stream.events.map(event => event.id), occurrenceCount: 1 },
  };

  const composed = await executeComposedCalculation({ program, inputs: { state: initialState } });
  assert.equal(composed.receipt.status, 'produced');
  assert.equal(composed.outputs.length, recipe.rules.length);
  assert.deepEqual(composed.outputs.at(-1).value, training.state);
  assert.throws(() => executeComposedCalculation({ program: { ...program, nodes: [{ ...program.nodes[0], calculation: 'unregistered.rule' }] } }), /provider|calculation/i);

  const shallowFrozen = Object.freeze(structuredClone(program));
  const prepared = prepareComposedCalculation(shallowFrozen);
  shallowFrozen.nodes[0].calculation = 'unregistered.after-prepare';
  assert.equal(prepared.program.nodes[0].calculation, program.nodes[0].calculation, 'prepared execution uses its frozen snapshot');
  assert.throws(() => prepareComposedCalculation(shallowFrozen), /provider|calculation/i, 'mutable nested edits do not reuse a stale plan');
});

test('grid card stack executes real movable text rules through copied rule-engine semantics', async () => {
  const initialState = createGridWorld();
  assert.deepEqual(initialState.rules, ['BABA IS YOU', 'FLAG IS WIN', 'ROCK IS PUSH', 'WALL IS STOP']);
  assert.equal(DEFAULT_GRID_OBJECTS.find(object => object.id === 'text-win').x, 3);
  assert.deepEqual(DEFAULT_GRID_RECIPE.rules.map(rule => rule.parameters.direction), ['R', 'R', 'U', 'R']);
  assert.equal(new Set(DEFAULT_GRID_RECIPE.rules.map(rule => rule.id)).size, 4);

  const run = await runGridRecipe({ initialState, recipe: DEFAULT_GRID_RECIPE, mode: 'uncached' });
  assert.equal(run.stream.events.length, 4);
  assert.ok(run.receipts.every(receipt => receipt.status === 'produced'));
  assert.equal(run.state.objects.find(object => object.id === 'text-win').y, 4);
  assert.ok(!run.state.rules.includes('FLAG IS WIN'), 'the final state reflects the pushed WIN breaking the text rule');
  assert.equal(run.stream.events[2].inputs[1].direction, 'U');
  assert.equal(run.stream.events[2].provider.implementationId, run.providerIdentity.implementationId);
  assert.equal(hashState(run.state), copiedGridHash(run.state), 'the public engine FNV hash is preserved');

  const edited = editGridObject(initialState, 'text-win', { word: 'STOP' });
  assert.ok(edited.rules.includes('FLAG IS STOP'));
  assert.ok(!edited.rules.includes('FLAG IS WIN'));
});

test('B-discovered partial grid composition binds current cards by position and preserves outputs', async () => {
  const initialState = createGridWorld();
  const recipe = structuredClone(DEFAULT_GRID_RECIPE);
  const training = await runGridRecipe({ initialState, recipe, mode: 'uncached' });
  const rules = recipe.rules.slice(0, 2);
  const program = {
    format: 'pagerouter.composed-calculation.v1',
    id: 'discovered-two-grid-steps',
    providerIdentity: training.providerIdentity,
    inputs: [
      { port: 'prior-state', sourceRef: 'event:training:previous:output', defaultValue: initialState },
      ...rules.map((rule, index) => ({ port: `card-${index}`, sourceRef: `input:parameters:${rule.id}`, defaultValue: rule.parameters })),
    ],
    nodes: rules.map((rule, index) => ({
      id: `step-${index}`,
      calculation: CALCULATIONS.gridStep,
      inputs: [
        index === 0 ? { kind: 'input', port: 'prior-state' } : { kind: 'node', nodeId: `step-${index - 1}` },
        { kind: 'input', port: `card-${index}` },
      ],
    })),
    outputs: rules.map((_, index) => ({ port: `out-${index}`, nodeId: `step-${index}` })),
    training: { patternId: 'two-grid-steps', eventIds: training.stream.events.slice(0, 2).map(event => event.id), occurrenceCount: 2 },
  };
  const cache = createPixelCache();
  const atomic = await runGridRecipe({ initialState, recipe, mode: 'atomic', cache: createPixelCache() });
  const composed = await runGridRecipe({ initialState, recipe, mode: 'composed', cache, program });
  assert.deepEqual(semantic(composed), semantic(atomic));
  assert.equal(composed.compositionUsage[0].used, true);
  assert.equal(composed.compositionUsage[0].count, 2);
  assert.equal(composed.receipts.length, 2, 'the two-card discovered motif is reused twice');
  assert.ok(composed.compositionUsage.every(row => row.used));

  const same = await runGridRecipe({ initialState, recipe, mode: 'composed', cache, previousRun: composed, program });
  assert.deepEqual(semantic(same), semantic(composed));
  assert.ok(same.ledger.every(row => row.cacheHit));

  const changedRecipe = structuredClone(recipe);
  changedRecipe.rules[0].parameters.direction = 'L';
  const changedCached = await runGridRecipe({ initialState, recipe: changedRecipe, mode: 'composed', cache, program });
  const changedBaseline = await runGridRecipe({ initialState, recipe: changedRecipe, mode: 'uncached' });
  assert.deepEqual(semantic(changedCached), semantic(changedBaseline));
  assert.equal(changedCached.compositionUsage[0].used, true);
  assert.equal(changedCached.ledger[0].cacheHit, false);
});

test('actual Block B discovery program composes inside the Block A grid runtime', async () => {
  const initialState = createGridWorld();
  const recipe = structuredClone(DEFAULT_GRID_RECIPE);
  const training = await runGridRecipe({ initialState, recipe, ticks: 4, mode: 'uncached' });
  const candidates = discoverCalculations(training.stream);
  const program = selectComposedCalculation(candidates, recipe);
  assert.ok(program, 'Block B should mine a repeated motif applicable to the ordered recipe');
  assert.ok(candidates.includes(program), 'selection returns the original Block B descriptor');
  const applicableLengths = candidates.filter(candidate => {
    try { return selectComposedCalculation([candidate], recipe) === candidate; } catch { return false; }
  }).map(candidate => candidate.nodes.length);
  assert.equal(program.nodes.length, Math.max(...applicableLengths), 'selection prefers the longest applicable mined chain');
  const lexicalA = { ...structuredClone(program), id: 'alpha-program' };
  const lexicalZ = { ...structuredClone(program), id: 'zeta-program' };
  assert.equal(selectComposedCalculation([lexicalZ, lexicalA], recipe), lexicalA, 'equal-length candidates use lexical ID order');
  const baseline = await runGridRecipe({ initialState, recipe, ticks: 4, mode: 'uncached' });
  const cache = createPixelCache();
  const composed = await runGridRecipe({ initialState, recipe, ticks: 4, mode: 'composed', cache, program });
  assert.deepEqual(semantic(composed), semantic(baseline));
  assert.ok(composed.compositionUsage.some(row => row.used && row.programId === program.id));

  const changedRecipe = structuredClone(recipe);
  changedRecipe.rules[0].parameters.direction = 'L';
  const changedComposed = await runGridRecipe({ initialState, recipe: changedRecipe, ticks: 4, mode: 'composed', cache, program });
  const changedBaseline = await runGridRecipe({ initialState, recipe: changedRecipe, ticks: 4, mode: 'uncached' });
  assert.deepEqual(semantic(changedComposed), semantic(changedBaseline));
  assert.equal(changedComposed.stream.events[0].inputs[1].direction, 'L');
});

test('grid engine source digest pins the exact preserved public rule engine copy', () => {
  const source = readFileSync(new URL('./grid-engine.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), GRID_ENGINE_SHA256);
  assert.equal(PROVIDER_SETUP.sourceBytes, source.byteLength);
  assert.equal(PROVIDER_SETUP.method, 'node-file');
  assert.ok(Number.isFinite(PROVIDER_SETUP.elapsedMs) && PROVIDER_SETUP.elapsedMs >= 0);
});

test('provider identity changes when only a copied grid-engine lexical helper changes', async () => {
  const sourceDir = fileURLToPath(new URL('.', import.meta.url));
  const temporaryDir = mkdtempSync(join(tmpdir(), 'block5-provider-pin-'));
  try {
    for (const filename of ['canonical.mjs', 'world.mjs', 'providers.mjs']) {
      writeFileSync(join(temporaryDir, filename), readFileSync(join(sourceDir, filename)));
    }
    const originalEngine = readFileSync(join(sourceDir, 'grid-engine.mjs'), 'utf8');
    const helperOnlyEdit = originalEngine.replace("const nouns = new Set(['BABA', 'WALL', 'ROCK', 'FLAG']);", "const nouns = new Set(['BABA', 'WALL', 'ROCK', 'FLAG', 'DOOR']);");
    assert.notEqual(helperOnlyEdit, originalEngine, 'probe must change only the lexical noun helper');
    writeFileSync(join(temporaryDir, 'grid-engine.mjs'), helperOnlyEdit);
    const changed = await import(pathToFileURL(join(temporaryDir, 'providers.mjs')).href);

    assert.notEqual(changed.PROVIDER_IDENTITY.implementationId, PROVIDER_IDENTITY.implementationId);
    assert.throws(() => changed.resolveProvider(changed.CALCULATIONS.gridStep, PROVIDER_IDENTITY), /identity mismatch/i);
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
});

test('borrowed cache values are frozen and cannot poison a later exact lookup', () => {
  const cache = createPixelCache();
  const input = { direction: 'R' };
  const retained = { state: { objects: [{ id: 'baba', x: 2, y: 3 }] } };
  cache.storeScoped('test-scope', input, retained);
  const borrowed = cache.lookupScoped('test-scope', input, { borrowed: true });
  assert.ok(borrowed.hit);
  assert.throws(() => { borrowed.value.state.objects[0].x = 99; }, TypeError);
  assert.deepEqual(cache.lookupScoped('test-scope', input).value, retained);
});
