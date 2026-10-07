import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import fastCheck from 'fast-check';
import bundledFastCheck from '../../vendor/hh/src/vendor/fast-check-4.10.2.bundle.mjs';
import fastCheckMetadata from '../../vendor/hh/src/vendor/fast-check-4.10.2.meta.mjs';
import {PxC, Part} from '../../vendor/hh/services/pxc.mjs';
import {createReadonlyDevToolsBoard} from '../../vendor/hh/services/devtools-board.mjs';
import {
  DEFAULT_BOUNDS, STYLE_ADDRESSES, STYLE_CSS_PROPERTIES, STYLE_FIELDS, STYLE_LIMITS,
  STYLE_SAMPLE_COUNT, registerStylePlayground,
} from '../../vendor/hh/services/style-playground.mjs';
import {applyStyleVariables, createStyleInspectionBoard, resetStyleVariables} from '../../vendor/hh/src/style-playground.mjs';

const bundleURL = new URL('../../vendor/hh/src/vendor/fast-check-4.10.2.bundle.mjs', import.meta.url);
const sourceBundle = readFileSync(bundleURL);
const calculatedPin = `sha256:${createHash('sha256').update(sourceBundle).digest('hex')}`;
const clone = value => structuredClone(value);
const plainBounds = bounds => Object.fromEntries(STYLE_FIELDS.map(key => [
  key, {min: bounds[key].min, max: bounds[key].max},
]));

function styleArbitrary(bounds) {
  return fastCheck.record(Object.fromEntries(STYLE_FIELDS.map(key => [
    key, fastCheck.integer({min: bounds[key].min, max: bounds[key].max}),
  ])));
}

function boundsArbitrary() {
  return fastCheck.record(Object.fromEntries(STYLE_FIELDS.map(key => {
    const {min: floor, max: ceiling} = STYLE_LIMITS[key];
    return [key, fastCheck.tuple(
      fastCheck.integer({min: floor, max: ceiling}),
      fastCheck.integer({min: floor, max: ceiling}),
    ).map(([left, right]) => ({min: Math.min(left, right), max: Math.max(left, right)}))];
  })));
}

test('seeded adversarial requests replay exactly through real fast-check and stay in each supplied range', async () => {
  const validBounds = boundsArbitrary();
  await fastCheck.assert(fastCheck.asyncProperty(
    fastCheck.integer({min: 0, max: 2147483647}), validBounds,
    async (seed, bounds) => {
      const originalBounds = plainBounds(bounds);
      const serializedInput = JSON.stringify(bounds);
      const pxc = new PxC();
      const playground = registerStylePlayground(pxc, bundledFastCheck, fastCheckMetadata);
      const first = await playground.generate({seed, bounds});
      const replay = await playground.generate({seed, bounds: clone(bounds)});
      const actual = first.candidates.value.candidates;
      const expected = fastCheck.sample(styleArbitrary(bounds), {seed, numRuns: STYLE_SAMPLE_COUNT})
        .map(style => Object.fromEntries(STYLE_FIELDS.map(key => [key, style[key]])));

      assert.equal(actual.length, 6);
      assert.deepEqual(actual, replay.candidates.value.candidates);
      assert.deepEqual(actual, expected);
      assert.equal(JSON.stringify(bounds), serializedInput, 'generation must not mutate its caller-owned bounds');
      assert.deepEqual(plainBounds(first.bounds), originalBounds);
      assert.ok(Object.isFrozen(first.bounds));
      assert.ok(Object.isFrozen(first.candidates.value));
      assert.ok(Object.isFrozen(actual));
      for (const style of actual) {
        assert.deepEqual(Object.keys(style).sort(), [...STYLE_FIELDS].sort());
        for (const key of STYLE_FIELDS) {
          assert.ok(Number.isSafeInteger(style[key]));
          assert.ok(style[key] >= bounds[key].min && style[key] <= bounds[key].max,
            `${key}=${style[key]} must stay within ${bounds[key].min}..${bounds[key].max}`);
        }
      }
    },
  ), {seed: 20261003, numRuns: 24, endOnFailure: true});
});

test('a raw select Calculation rejects a candidate Part paired with different bounds', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, bundledFastCheck, fastCheckMetadata);
  const generation = await playground.generate({seed: 42, bounds: clone(DEFAULT_BOUNDS)});
  const mismatchedBounds = clone(DEFAULT_BOUNDS);
  mismatchedBounds.cardPadding.min--;
  mismatchedBounds.cardPadding.max++;

  await assert.rejects(pxc.compose({
    into: 'hh.style.adversarial.mismatched-bounds',
    calculation: STYLE_ADDRESSES.select,
    inputs: {
      candidates: generation.candidatesAddress,
      index: new Part(0),
      seed: generation.seedAddress,
      bounds: new Part(mismatchedBounds),
      source: STYLE_ADDRESSES.generator,
    },
  }), /same pinned seed and style inputs/i);
});

test('candidate, selection, CSS, and kept outputs stay attached to exact visible PxC receipts', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, bundledFastCheck, fastCheckMetadata);
  const generation = await playground.generate({seed: 9, bounds: clone(DEFAULT_BOUNDS)});
  const selection = await playground.select(generation, 4);
  const variables = await playground.cssVariables(selection);
  const kept = await playground.keep(selection, variables);
  const serviceBoard = createReadonlyDevToolsBoard(pxc, {fixture: true});
  const board = createStyleInspectionBoard(pxc, serviceBoard);

  assert.equal(board.get(generation.candidatesAddress), generation.candidates);
  assert.equal(board.get(selection.address), selection.style);
  assert.equal(board.get(playground.addressOf(variables)), variables);
  assert.equal(board.get(playground.addressOf(kept)), kept);
  assert.equal(generation.candidates.composition.calculation, pxc.get(STYLE_ADDRESSES.sample));
  assert.equal(selection.style.composition.calculation, pxc.get(STYLE_ADDRESSES.select));
  assert.equal(selection.style.composition.inputs.candidates, generation.candidates);
  assert.equal(variables.composition.calculation, pxc.get(STYLE_ADDRESSES.cssVariables));
  assert.equal(variables.composition.inputs.selected, selection.style);
  assert.equal(kept.composition.calculation, pxc.get(STYLE_ADDRESSES.keep));
  assert.equal(kept.composition.inputs.selected, selection.style);
  assert.equal(kept.composition.inputs.variables, variables);
  assert.deepEqual(board.receipts().map(receipt => receipt.output), [
    generation.candidates, selection.style, variables, kept,
  ]);
  assert.deepEqual(Object.keys(variables.value.cssVariables).sort(), Object.values(STYLE_CSS_PROPERTIES).sort());
  assert.equal(selection.style.value.index, 4);
  assert.equal(selection.style.value.outcome, 'style_selected');
  assert.equal(variables.value.outcome, 'css_variables_ready');
  assert.equal(kept.value.selectedIndex, 4);
  assert.throws(() => board.set('hh.style.injected', new Part('text')), /read-only/i);
  await assert.rejects(board.compose({into: 'hh.style.injected', calculation: pxc.get(STYLE_ADDRESSES.select)}), /read-only/i);
});

test('invalid seeds, bounds, selections, and forged saved records reject without adding outputs', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, bundledFastCheck, fastCheckMetadata);
  const startCount = pxc.entries().length;
  const validBounds = clone(DEFAULT_BOUNDS);
  for (const seed of [-1, 2147483648, 1.5, Number.NaN, '42', null]) {
    await assert.rejects(playground.generate({seed, bounds: clone(validBounds)}), /seed/i);
  }
  const invalidBounds = [
    null,
    [],
    {...validBounds, extra: {min: 0, max: 1}},
    {...validBounds, accentHue: {min: 10.5, max: 40}},
    {...validBounds, accentHue: {min: 40, max: 10}},
    {...validBounds, accentHue: {min: -1, max: 40}},
    {...validBounds, accentHue: {min: 0, max: 360}},
    Object.assign(Object.create({inherited: true}), validBounds),
  ];
  for (const bounds of invalidBounds) {
    await assert.rejects(playground.generate({seed: 7, bounds}), /bounds|bound/i);
  }
  assert.equal(pxc.entries().length, startCount, 'rejected generate calls must leave the PxC untouched');

  const generation = await playground.generate({seed: 7, bounds: validBounds});
  const afterGeneration = pxc.entries().length;
  for (const index of [-1, 6, 1.25, Number.NaN, '0', null]) {
    await assert.rejects(playground.select(generation, index), /selection/i);
  }
  await assert.rejects(playground.select({candidates: generation.candidates}, 0), /generated set/i);
  assert.equal(pxc.entries().length, afterGeneration, 'rejected selects must not leave selection Parts');

  const selected = await playground.select(generation, 0);
  const variables = await playground.cssVariables(selected);
  const kept = await playground.keep(selected, variables);
  const base = JSON.parse(JSON.stringify(kept.value));
  for (const mutate of [
    value => { value.selectedIndex = 6; },
    value => { value.generator.pin = `sha256:${'0'.repeat(64)}`; },
    value => { value.generator.stylePin = `sha256:${'0'.repeat(64)}`; },
    value => { value.style.cardPadding = 999; },
    value => { value.extra = 'unexpected'; },
  ]) {
    const tampered = clone(base);
    mutate(tampered);
    await assert.rejects(playground.restore(tampered));
  }
});

test('keep/export/JSON restore re-derives CSS from the selected style and reset clears only HH style variables', async () => {
  const pxc = new PxC();
  const playground = registerStylePlayground(pxc, bundledFastCheck, fastCheckMetadata);
  const generation = await playground.generate({seed: 81, bounds: clone(DEFAULT_BOUNDS)});
  const selection = await playground.select(generation, 2);
  const variables = await playground.cssVariables(selection);
  const kept = await playground.keep(selection, variables);
  const exportedJSON = JSON.stringify(kept.value);
  const importedRecord = JSON.parse(exportedJSON);
  const restored = await playground.restore(importedRecord);
  const restoredVariables = await playground.cssVariables(restored);

  assert.deepEqual(restored.style.value.style, selection.style.value.style);
  assert.deepEqual(restoredVariables.value.cssVariables, variables.value.cssVariables);
  assert.equal(restored.style.value.index, selection.style.value.index);
  assert.equal(restored.style.value.generator.pin, fastCheckMetadata.pin);
  assert.equal(restored.style.value.generator.stylePin, fastCheckMetadata.stylePin);

  const properties = Object.values(STYLE_CSS_PROPERTIES);
  const applied = new Map([['--hh-teacher-text-color', '#345678']]);
  const target = {style: {
    setProperty(name, value) { applied.set(name, value); },
    removeProperty(name) { applied.delete(name); },
  }};
  applyStyleVariables(target, restoredVariables);
  assert.deepEqual([...applied].filter(([name]) => properties.includes(name)),
    properties.map(property => [property, restoredVariables.value.cssVariables[property]]));
  const beforeUnsafe = new Map(applied);
  assert.throws(() => applyStyleVariables(target, {
    value: {cssVariables: {...restoredVariables.value.cssVariables, '--hh-style-radius': 'url(https://bad.invalid)'}},
  }), /value/i);
  assert.deepEqual(applied, beforeUnsafe, 'unsafe CSS must not partially apply');
  resetStyleVariables(target);
  assert.deepEqual([...applied], [['--hh-teacher-text-color', '#345678']]);
});

test('pinned generator metadata matches the supplied real fast-check module and artifact bytes', () => {
  assert.equal(fastCheck.__version, '4.10.2');
  assert.equal(fastCheck.__commitHash, 'c77afa8277a67250d798c52e61343b8ed5fd268b');
  assert.equal(bundledFastCheck.__version, fastCheck.__version);
  assert.equal(bundledFastCheck.__commitHash, fastCheck.__commitHash);
  assert.equal(fastCheckMetadata.version, fastCheck.__version);
  assert.equal(fastCheckMetadata.sourceCommit, fastCheck.__commitHash);
  assert.equal(fastCheckMetadata.pin, calculatedPin);

  const provenance = JSON.parse(readFileSync(new URL('../../vendor/hh/src/vendor/fast-check-4.10.2.provenance.json', import.meta.url), 'utf8'));
  const expectedStyleFiles = [
    'vendor/hh/services/style-playground.mjs',
    'vendor/hh/src/app.mjs',
    'vendor/hh/src/pxc-devtools/devtools.css',
    'vendor/hh/src/pxc-devtools/devtools.mjs',
    'vendor/hh/src/style-playground.mjs',
    'vendor/hh/src/styles.css',
  ];
  const styleSourceNames = Object.keys(provenance.styleImplementation.files).sort();
  assert.deepEqual(styleSourceNames, [...expectedStyleFiles].sort(), 'the style pin must cover the whole fixed browser integration');
  const styleSourceHashes = Object.fromEntries(styleSourceNames.map(relative => [
    relative,
    createHash('sha256').update(readFileSync(new URL(`../../${relative}`, import.meta.url))).digest('hex'),
  ]));
  const calculatedStylePin = `sha256:${createHash('sha256').update(JSON.stringify(styleSourceHashes)).digest('hex')}`;
  assert.deepEqual(styleSourceHashes, provenance.styleImplementation.files);
  assert.equal(provenance.styleImplementation.pin, calculatedStylePin);
  assert.equal(fastCheckMetadata.stylePin, calculatedStylePin);

  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/fast-check'].version, fastCheckMetadata.version);

  for (const invalidMetadata of [
    {...fastCheckMetadata, version: '4.10.1'},
    {...fastCheckMetadata, sourceCommit: '0000000000000000000000000000000000000000'},
  ]) {
    assert.throws(() => registerStylePlayground(new PxC(), bundledFastCheck, invalidMetadata),
      /runtime|identity|match|version|commit/i,
      'metadata that disagrees with the actual runtime must fail closed');
  }
});

test('style entry points do not expose dynamic source execution', () => {
  const sources = [
    readFileSync(new URL('../../vendor/hh/services/style-playground.mjs', import.meta.url), 'utf8'),
    readFileSync(new URL('../../vendor/hh/src/style-playground.mjs', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(sources, /\beval\s*\(|\bnew\s+Function\s*\(/);
});
