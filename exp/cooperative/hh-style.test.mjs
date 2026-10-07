import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PxC, Part} from '../../vendor/hh/services/pxc.mjs';
import {createReadonlyDevToolsBoard} from '../../vendor/hh/services/devtools-board.mjs';
import {createFixtureProvider} from '../../vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '../../vendor/hh/services/runtime.mjs';
import {inspectPart} from '../../vendor/hh/src/pxc-devtools/devtools-data.mjs';
import {registerStylePlayground, DEFAULT_BOUNDS, STYLE_ADDRESSES} from '../../vendor/hh/services/style-playground.mjs';
import {applyStyleVariables, createStyleInspectionBoard} from '../../vendor/hh/src/style-playground.mjs';
import fastCheck from '../../vendor/hh/src/vendor/fast-check-4.10.2.bundle.mjs';
import fastCheckPackage from 'fast-check';
import fastCheckMetadata from '../../vendor/hh/src/vendor/fast-check-4.10.2.meta.mjs';

const metadata = fastCheckMetadata;
const bundleBytes = readFileSync(new URL('../../vendor/hh/src/vendor/fast-check-4.10.2.bundle.mjs', import.meta.url));
const computedPin = `sha256:${createHash('sha256').update(bundleBytes).digest('hex')}`;

test('self-hosted browser bundle matches the exact pinned npm package bytes', () => {
  assert.equal(metadata.name, 'fast-check');
  assert.equal(metadata.version, '4.10.2');
  assert.equal(metadata.sourceCommit, 'c77afa8277a67250d798c52e61343b8ed5fd268b');
  assert.equal(metadata.pin, computedPin);
  const provenance = JSON.parse(readFileSync(new URL('../../vendor/hh/src/vendor/fast-check-4.10.2.provenance.json', import.meta.url), 'utf8'));
  const styleSources = Object.fromEntries(Object.keys(provenance.styleImplementation.files).sort().map((relative) => [
    relative, createHash('sha256').update(readFileSync(new URL(`../../${relative}`, import.meta.url))).digest('hex'),
  ]));
  assert.deepEqual(styleSources, provenance.styleImplementation.files);
  assert.equal(metadata.stylePin, provenance.styleImplementation.pin);
  assert.equal(metadata.stylePin, `sha256:${createHash('sha256').update(JSON.stringify(styleSources)).digest('hex')}`);
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/fast-check'].version, metadata.version);
  const arbitrary = fastCheckPackage.record({n: fastCheckPackage.integer({min: 1, max: 999})});
  assert.deepEqual(fastCheck.sample(arbitrary, {seed: 9, numRuns: 6}),
    fastCheckPackage.sample(arbitrary, {seed: 9, numRuns: 6}));
});

test('six seeded style candidates stay within explicit bounds and retain real PxC source receipts', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, fastCheck, metadata);
  const bounds = structuredClone(DEFAULT_BOUNDS);
  const first = await playground.generate({seed: 42, bounds});
  const second = await playground.generate({seed: 42, bounds});

  assert.equal(first.candidates.value.candidates.length, 6);
  assert.deepEqual(first.candidates.value.candidates, second.candidates.value.candidates);
  assert.equal(first.candidates.value.port, 'Style.sample');
  const packageValues = fastCheckPackage.sample(fastCheckPackage.record(Object.fromEntries(
    Object.entries(bounds).map(([key, range]) => [key, fastCheckPackage.integer({min: range.min, max: range.max})]),
  )), {seed: 42, numRuns: 6});
  assert.deepEqual(JSON.parse(JSON.stringify(first.candidates.value.candidates)), JSON.parse(JSON.stringify(packageValues)));
  for (const candidate of first.candidates.value.candidates) {
    for (const [key, range] of Object.entries(bounds)) {
      assert.ok(candidate[key] >= range.min && candidate[key] <= range.max, `${key} must be bounded`);
    }
  }

  const serviceBoard = createReadonlyDevToolsBoard(pxc, {fixture: true});
  const board = createStyleInspectionBoard(pxc, serviceBoard);
  assert.equal(board.get(first.candidatesAddress), first.candidates);
  assert.equal(board.receipts().length, 2);
  assert.equal(board.receipts()[0].output, first.candidates);
  assert.equal(board.receipts()[0].composition.inputs.seed, pxc.get(first.seedAddress));
  assert.equal(board.receipts()[0].composition.inputs.bounds, pxc.get(first.boundsAddress));
  assert.deepEqual(inspectPart(board, first.candidates).edges.map((edge) => edge.role), ['Calculation', 'seed', 'bounds', 'source']);
  assert.throws(() => board.set('hh.style.userCode', new Part('anything')), /read-only/i);
  await assert.rejects(board.compose({into: 'hh.style.userCode', calculation: first.candidates}), /read-only/i);
  assert.ok(Object.keys(STYLE_ADDRESSES).length >= 3);
});

test('select, CSS-variable, and keep Calculations form a fixed inspectable chain', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, fastCheck, metadata);
  const generation = await playground.generate({seed: 7, bounds: structuredClone(DEFAULT_BOUNDS)});
  const selection = await playground.select(generation, 2);
  const variables = await playground.cssVariables(selection);
  const kept = await playground.keep(selection, variables);

  assert.equal(selection.style.value.index, 2);
  assert.equal(selection.style.composition.calculation, pxc.get(STYLE_ADDRESSES.select));
  assert.equal(selection.style.composition.inputs.candidates, generation.candidates);
  assert.equal(variables.composition.calculation, pxc.get(STYLE_ADDRESSES.cssVariables));
  assert.equal(variables.composition.inputs.selected, selection.style);
  assert.equal(kept.composition.calculation, pxc.get(STYLE_ADDRESSES.keep));
  assert.equal(kept.composition.inputs.variables, variables);
  assert.deepEqual(Object.keys(variables.value.cssVariables).sort(), [
    '--hh-style-accent-hue', '--hh-style-card-padding', '--hh-style-layout-gap', '--hh-style-radius',
  ].sort());
  assert.deepEqual(kept.value, {
    schema: 'hh-style-playground@1',
    generator: {name: 'fast-check', ...metadata},
    seed: 7,
    bounds: DEFAULT_BOUNDS,
    selectedIndex: 2,
    style: selection.style.value.style,
    cssVariables: variables.value.cssVariables,
  });
  const staleImplementation = structuredClone(kept.value);
  staleImplementation.generator.stylePin = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(playground.restore(staleImplementation), /metadata/i);
});

test('rejects unsafe seeds, bounds, selections, and CSS values without changing the target', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, fastCheck, metadata);
  const initialEntries = pxc.entries().length;
  await assert.rejects(playground.generate({seed: -1, bounds: structuredClone(DEFAULT_BOUNDS)}), /seed/i);
  const badBounds = structuredClone(DEFAULT_BOUNDS);
  badBounds.accentHue.max = 900;
  await assert.rejects(playground.generate({seed: 1, bounds: badBounds}), /bound/i);
  assert.equal(pxc.entries().length, initialEntries);

  const generation = await playground.generate({seed: 1, bounds: structuredClone(DEFAULT_BOUNDS)});
  await assert.rejects(playground.select(generation, 6), /selection/i);
  await assert.rejects(playground.select({candidates: new Part([])}, 0), /generated|candidate/i);

  const applied = new Map();
  const target = {style: {setProperty(name, value) { applied.set(name, value); }, removeProperty(name) { applied.delete(name); }}};
  const validCss = {'--hh-style-accent-hue': '22', '--hh-style-card-padding': '24px', '--hh-style-layout-gap': '18px', '--hh-style-radius': '12px'};
  applyStyleVariables(target, new Part({cssVariables: validCss}));
  assert.deepEqual([...applied], Object.entries(validCss));
  assert.throws(() => applyStyleVariables(target, new Part({cssVariables: {...validCss, '--hh-style-accent-hue': 'url(https://bad.invalid)'}})), /value/i);
  assert.throws(() => applyStyleVariables(target, new Part({cssVariables: {...validCss, '--user-rule': 'all:initial'}})), /propert/i);
  assert.deepEqual([...applied], Object.entries(validCss));
});

test('style experiments preserve fixture teacher state and do not call any HH service', async () => {
  const storage = new Map();
  const provider = createFixtureProvider({fixture: true, storage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  }});
  const runtime = createServiceRuntime(provider);
  await runtime.ready;
  const before = await runtime.snapshot();
  const serviceReceipts = runtime.pxc.receipts().filter((receipt) => receipt.into.startsWith('hh.result.')).length;
  const playground = registerStylePlayground(runtime.pxc, fastCheck, metadata);
  const generated = await playground.generate({seed: 123, bounds: structuredClone(DEFAULT_BOUNDS)});
  const selection = await playground.select(generated, 0);
  const variables = await playground.cssVariables(selection);
  await playground.keep(selection, variables);

  assert.deepEqual(await runtime.snapshot(), before);
  assert.equal(runtime.pxc.receipts().filter((receipt) => receipt.into.startsWith('hh.result.')).length, serviceReceipts);
  assert.deepEqual([...storage], []);
});
