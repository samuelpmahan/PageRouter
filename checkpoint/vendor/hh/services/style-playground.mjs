import {Part} from './pxc.mjs';
import {deepFreeze} from './contract.mjs';

export const STYLE_FIELDS = Object.freeze(['accentHue', 'cardPadding', 'layoutGap', 'cornerRadius']);
export const STYLE_LIMITS = deepFreeze({
  accentHue: {min: 0, max: 359},
  cardPadding: {min: 18, max: 40},
  layoutGap: {min: 8, max: 36},
  cornerRadius: {min: 0, max: 24},
});
export const DEFAULT_BOUNDS = deepFreeze({
  accentHue: {min: 0, max: 359},
  cardPadding: {min: 22, max: 36},
  layoutGap: {min: 14, max: 32},
  cornerRadius: {min: 4, max: 20},
});
export const STYLE_ADDRESSES = Object.freeze({
  generator: 'hh.style.generator',
  sample: 'hh.style.calculation.sample',
  select: 'hh.style.calculation.select',
  cssVariables: 'hh.style.calculation.css-variables',
  keep: 'hh.style.calculation.keep',
  restore: 'hh.style.calculation.restore',
});
export const STYLE_CSS_PROPERTIES = Object.freeze({
  accentHue: '--hh-style-accent-hue',
  cardPadding: '--hh-style-card-padding',
  layoutGap: '--hh-style-layout-gap',
  cornerRadius: '--hh-style-radius',
});
export const STYLE_SAMPLE_COUNT = 6;
const BUNDLE_SCHEMA = 'hh-style-playground@1';

function requireRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object.`);
  }
}

export function validateStyleInputs({seed, bounds} = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) {
    throw new RangeError('Seed must be a whole number from 0 to 2147483647.');
  }
  requireRecord(bounds, 'Bounds');
  if (Object.keys(bounds).length !== STYLE_FIELDS.length ||
      STYLE_FIELDS.some((key) => !Object.hasOwn(bounds, key))) {
    throw new TypeError('Bounds must contain exactly accentHue, cardPadding, layoutGap, and cornerRadius.');
  }
  const normalized = {};
  for (const key of STYLE_FIELDS) {
    const range = bounds[key];
    requireRecord(range, `${key} bound`);
    if (Object.keys(range).length !== 2 || !Object.hasOwn(range, 'min') || !Object.hasOwn(range, 'max') ||
        !Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max)) {
      throw new TypeError(`${key} bounds must have whole-number min and max values.`);
    }
    const {min, max} = range;
    if (min < STYLE_LIMITS[key].min || max > STYLE_LIMITS[key].max || min > max) {
      throw new RangeError(`${key} bounds must stay from ${STYLE_LIMITS[key].min} to ${STYLE_LIMITS[key].max}, with min no greater than max.`);
    }
    normalized[key] = {min, max};
  }
  return deepFreeze(normalized);
}

function validateStyle(value, bounds) {
  requireRecord(value, 'Generated style');
  if (Object.keys(value).length !== STYLE_FIELDS.length || STYLE_FIELDS.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('Generated style contains unexpected fields.');
  }
  const result = {};
  for (const key of STYLE_FIELDS) {
    const number = value[key];
    if (!Number.isSafeInteger(number) || number < bounds[key].min || number > bounds[key].max) {
      throw new RangeError(`Generated ${key} fell outside its supplied bounds.`);
    }
    result[key] = number;
  }
  return deepFreeze(result);
}

function cssVariablesOf(style) {
  return deepFreeze({
    [STYLE_CSS_PROPERTIES.accentHue]: String(style.accentHue),
    [STYLE_CSS_PROPERTIES.cardPadding]: `${style.cardPadding}px`,
    [STYLE_CSS_PROPERTIES.layoutGap]: `${style.layoutGap}px`,
    [STYLE_CSS_PROPERTIES.cornerRadius]: `${style.cornerRadius}px`,
  });
}

function validateKeptRecord(value, generator) {
  requireRecord(value, 'Saved style');
  const keys = ['schema', 'generator', 'seed', 'bounds', 'selectedIndex', 'style', 'cssVariables'];
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)) || value.schema !== BUNDLE_SCHEMA) {
    throw new TypeError('Saved style has an unsupported format.');
  }
  verifyGenerator(value.generator, generator);
  const bounds = validateStyleInputs({seed: value.seed, bounds: value.bounds});
  if (!Number.isSafeInteger(value.selectedIndex) || value.selectedIndex < 0 || value.selectedIndex >= STYLE_SAMPLE_COUNT) {
    throw new RangeError('Saved style selection must be one of the six candidates.');
  }
  const style = validateStyle(value.style, bounds);
  const expectedCss = cssVariablesOf(style);
  requireRecord(value.cssVariables, 'Saved CSS variables');
  if (Object.keys(value.cssVariables).length !== Object.keys(expectedCss).length ||
      Object.entries(expectedCss).some(([key, expected]) => value.cssVariables[key] !== expected)) {
    throw new TypeError('Saved CSS variables do not match the kept style values.');
  }
  return deepFreeze({schema: BUNDLE_SCHEMA, generator, seed: value.seed, bounds,
    selectedIndex: value.selectedIndex, style, cssVariables: expectedCss});
}

function validateMetadata(fastCheck, {version, pin, sourceCommit, stylePin} = {}) {
  if (!fastCheck || typeof fastCheck.record !== 'function' || typeof fastCheck.integer !== 'function' || typeof fastCheck.sample !== 'function') {
    throw new TypeError('A pinned fast-check module with record, integer, and sample is required.');
  }
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
    throw new TypeError('Pinned fast-check version is required.');
  }
  if (typeof pin !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(pin)) {
    throw new TypeError('Pinned fast-check SHA-256 is required.');
  }
  if (typeof stylePin !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(stylePin)) {
    throw new TypeError('Pinned style-playground implementation SHA-256 is required.');
  }
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new TypeError('Pinned fast-check source commit is required.');
  }
  if (fastCheck.__version !== version || fastCheck.__commitHash !== sourceCommit) {
    throw new TypeError('Pinned fast-check version and source commit do not match the supplied runtime.');
  }
  return deepFreeze({name: 'fast-check', version, pin, sourceCommit, stylePin});
}

function verifyGenerator(value, expected) {
  if (!value || value.name !== expected.name || value.version !== expected.version ||
      value.pin !== expected.pin || value.sourceCommit !== expected.sourceCommit || value.stylePin !== expected.stylePin) {
    throw new TypeError('Style generator metadata does not match the pinned fast-check source.');
  }
}

function sameBounds(left, right) {
  return !!left && !!right && STYLE_FIELDS.every((key) => left[key]?.min === right[key]?.min && left[key]?.max === right[key]?.max);
}

/** Register a small, fixed Calculation set in the HH-owned PxC. */
export function registerStylePlayground(pxc, fastCheck, rawMetadata) {
  if (!pxc || typeof pxc.set !== 'function' || typeof pxc.compose !== 'function' || typeof pxc.entries !== 'function') {
    throw new TypeError('An owning PxC is required.');
  }
  const generator = validateMetadata(fastCheck, rawMetadata);
  if (pxc.entries().some(([address]) => address.startsWith('hh.style.'))) {
    throw new Error('HH style-playground Parts are already registered in this PxC.');
  }

  pxc.set(STYLE_ADDRESSES.generator, new Part(generator));
  const sampleCalculation = new Part(({seed, bounds, source}) => {
    verifyGenerator(source, generator);
    const validated = validateStyleInputs({seed, bounds});
    const arbitrary = fastCheck.record(Object.fromEntries(STYLE_FIELDS.map((key) => [
      key, fastCheck.integer({min: validated[key].min, max: validated[key].max}),
    ])));
    const values = fastCheck.sample(arbitrary, {seed, numRuns: STYLE_SAMPLE_COUNT});
    if (!Array.isArray(values) || values.length !== STYLE_SAMPLE_COUNT) {
      throw new TypeError('fast-check did not return the expected six style candidates.');
    }
    return deepFreeze({kind: 'HHStyleCandidates', port: 'Style.sample', outcome: 'variants_generated', ok: true,
      seed, bounds: validated, generator, candidates: values.map((value) => validateStyle(value, validated))});
  });
  const selectCalculation = new Part(({candidates, index, seed, bounds, source}) => {
    verifyGenerator(source, generator);
    const validatedBounds = validateStyleInputs({seed, bounds});
    if (!candidates || candidates.seed !== seed || !sameBounds(candidates.bounds, validatedBounds) ||
        !Array.isArray(candidates.candidates) || candidates.candidates.length !== STYLE_SAMPLE_COUNT ||
        candidates.generator?.pin !== generator.pin) {
      throw new TypeError('Candidates must come from the same pinned seed and style inputs.');
    }
    verifyGenerator(candidates.generator, generator);
    if (!Number.isSafeInteger(index) || index < 0 || index >= STYLE_SAMPLE_COUNT) {
      throw new RangeError('Selection must be one of the six generated candidates.');
    }
    const style = validateStyle(candidates.candidates[index], validatedBounds);
    return deepFreeze({kind: 'HHStyleSelection', port: 'Style.select', outcome: 'style_selected', ok: true,
      index, style, seed, bounds: validatedBounds, generator});
  });
  const variablesCalculation = new Part(({selected}) => {
    const bounds = validateStyleInputs({seed: selected?.seed, bounds: selected?.bounds});
    const style = validateStyle(selected?.style, bounds);
    const cssVariables = cssVariablesOf(style);
    return deepFreeze({kind: 'HHStyleVariables', port: 'Style.cssVariables', outcome: 'css_variables_ready', ok: true,
      style, seed: selected.seed, bounds, index: selected.index, generator, cssVariables});
  });
  const keepCalculation = new Part(({selected, variables}) => {
    if (!selected || !variables || selected.index !== variables.index || selected.seed !== variables.seed ||
        selected.generator?.pin !== generator.pin || variables.generator?.pin !== generator.pin) {
      throw new TypeError('Only matching values from this pinned style playground can be kept.');
    }
    verifyGenerator(selected.generator, generator);
    verifyGenerator(variables.generator, generator);
    return deepFreeze({schema: BUNDLE_SCHEMA, generator, seed: selected.seed, bounds: selected.bounds,
      selectedIndex: selected.index, style: selected.style, cssVariables: variables.cssVariables});
  });
  const restoreCalculation = new Part(({saved}) => {
    const kept = validateKeptRecord(saved, generator);
    return deepFreeze({kind: 'HHStyleSelection', port: 'Style.restore', outcome: 'style_restored', ok: true,
      index: kept.selectedIndex, style: kept.style, seed: kept.seed, bounds: kept.bounds, generator});
  });
  pxc.set(STYLE_ADDRESSES.sample, sampleCalculation);
  pxc.set(STYLE_ADDRESSES.select, selectCalculation);
  pxc.set(STYLE_ADDRESSES.cssVariables, variablesCalculation);
  pxc.set(STYLE_ADDRESSES.keep, keepCalculation);
  pxc.set(STYLE_ADDRESSES.restore, restoreCalculation);

  const generations = new WeakSet();
  const selections = new WeakSet();
  const variableInputs = new WeakMap();
  let serial = 0;
  function id() { return ++serial; }
  return Object.freeze({
    metadata: generator,
    addressOf(part) { return pxc.entries().find(([, candidate]) => candidate === part)?.[0] ?? null; },
    async generate({seed, bounds}) {
      const safeBounds = validateStyleInputs({seed, bounds});
      const run = id();
      const seedAddress = `hh.style.seed.${run}`;
      const boundsAddress = `hh.style.bounds.${run}`;
      const candidatesAddress = `hh.style.candidates.${run}`;
      pxc.set(seedAddress, new Part(seed));
      pxc.set(boundsAddress, new Part(safeBounds));
      const candidates = await pxc.compose({into: candidatesAddress, calculation: STYLE_ADDRESSES.sample,
        inputs: {seed: seedAddress, bounds: boundsAddress, source: STYLE_ADDRESSES.generator}});
      const generation = Object.freeze({run, seed, bounds: safeBounds, seedAddress, boundsAddress, candidatesAddress, candidates});
      generations.add(generation);
      return generation;
    },
    async select(generation, index) {
      if (!generations.has(generation)) throw new TypeError('Select a candidate from a generated set.');
      if (!Number.isSafeInteger(index) || index < 0 || index >= STYLE_SAMPLE_COUNT) {
        throw new RangeError('Selection must be one of the six generated candidates.');
      }
      const run = id();
      const selectionAddress = `hh.style.selection.${run}`;
      const selectedAddress = `hh.style.selected.${run}`;
      pxc.set(selectionAddress, new Part(index));
      const selected = await pxc.compose({into: selectedAddress, calculation: STYLE_ADDRESSES.select,
        inputs: {candidates: generation.candidatesAddress, index: selectionAddress,
          seed: generation.seedAddress, bounds: generation.boundsAddress, source: STYLE_ADDRESSES.generator}});
      const selection = Object.freeze({run, address: selectedAddress, generation, index, style: selected});
      selections.add(selection);
      return selection;
    },
    async cssVariables(selection) {
      if (!selections.has(selection)) throw new TypeError('Select a generated style before preparing CSS variables.');
      const run = id();
      const address = `hh.style.css-vars.${run}`;
      const variables = await pxc.compose({into: address, calculation: STYLE_ADDRESSES.cssVariables,
        inputs: {selected: selection.address}});
      variableInputs.set(selection, variables);
      return variables;
    },
    async keep(selection, variables = variableInputs.get(selection)) {
      if (!selections.has(selection) || !variables || variableInputs.get(selection) !== variables) {
        throw new TypeError('Keep requires the CSS-variable result for the selected style.');
      }
      const address = `hh.style.kept.${id()}`;
      return pxc.compose({into: address, calculation: STYLE_ADDRESSES.keep,
        inputs: {selected: selection.address, variables}});
    },
    async restore(record) {
      const validated = validateKeptRecord(record, generator);
      const run = id();
      const savedAddress = `hh.style.saved.${run}`;
      const selectedAddress = `hh.style.selected.${run}`;
      pxc.set(savedAddress, new Part(validated));
      const style = await pxc.compose({into: selectedAddress, calculation: STYLE_ADDRESSES.restore,
        inputs: {saved: savedAddress}});
      const selection = Object.freeze({run, address: selectedAddress, generation: null,
        index: validated.selectedIndex, style});
      selections.add(selection);
      return selection;
    },
  });
}
