import {DEFAULT_BOUNDS, STYLE_ADDRESSES, STYLE_CSS_PROPERTIES, STYLE_FIELDS, STYLE_LIMITS, STYLE_SAMPLE_COUNT} from '../services/style-playground.mjs';
import fastCheck from './vendor/fast-check-4.10.2.bundle.mjs';
import fastCheckMetadata from './vendor/fast-check-4.10.2.meta.mjs';
import {registerStylePlayground} from '../services/style-playground.mjs';

export const STYLE_STORAGE_KEY = 'hh.style-playground.v1';
const BOUND_LABELS = Object.freeze({
  accentHue: 'Accent hue',
  cardPadding: 'Card padding (px)',
  layoutGap: 'Layout gap (px)',
  cornerRadius: 'Corner radius (px)',
});
const CSS_VALUE_RULES = Object.freeze({
  [STYLE_CSS_PROPERTIES.accentHue]: {field: 'accentHue', suffix: '', pattern: /^(?:0|[1-9]\d{0,2})$/},
  [STYLE_CSS_PROPERTIES.cardPadding]: {field: 'cardPadding', suffix: 'px', pattern: /^(?:0|[1-9]\d{0,2})px$/},
  [STYLE_CSS_PROPERTIES.layoutGap]: {field: 'layoutGap', suffix: 'px', pattern: /^(?:0|[1-9]\d{0,2})px$/},
  [STYLE_CSS_PROPERTIES.cornerRadius]: {field: 'cornerRadius', suffix: 'px', pattern: /^(?:0|[1-9]\d{0,2})px$/},
});

export function registerBrowserStylePlayground(pxc) {
  return registerStylePlayground(pxc, fastCheck, fastCheckMetadata);
}

const STYLE_CALCULATIONS = new Set([STYLE_ADDRESSES.sample, STYLE_ADDRESSES.select, STYLE_ADDRESSES.cssVariables,
  STYLE_ADDRESSES.keep, STYLE_ADDRESSES.restore]);
const STYLE_SOURCES = /^hh\.style\.(?:generator|seed\.[1-9]\d*|bounds\.[1-9]\d*|selection\.[1-9]\d*|saved\.[1-9]\d*)$/;
const STYLE_OUTPUTS = /^hh\.style\.(?:candidates|selected|css-vars|kept)\.[1-9]\d*$/;

function isSafeStyleData(value, seen = new Set()) {
  if (value === null || ['undefined', 'boolean', 'number'].includes(typeof value)) return true;
  if (typeof value === 'string') return value.length <= 10000;
  if (!value || typeof value !== 'object' || !Object.isFrozen(value) || seen.has(value)) return false;
  if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const next = new Set(seen); next.add(value);
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && 'value' in descriptor && !/password|credential|token|secret|authorization|cookie/i.test(key) &&
      isSafeStyleData(descriptor.value, next);
  });
}

function stylePartVisible(part, addressByPart, visiting = new Set()) {
  const address = addressByPart.get(part);
  if (!address) return false;
  if (STYLE_CALCULATIONS.has(address)) return typeof part.value === 'function' && part.composition === null;
  if (STYLE_SOURCES.test(address)) return part.composition === null && isSafeStyleData(part.value);
  if (!STYLE_OUTPUTS.test(address) || !isSafeStyleData(part.value) || !part.composition || visiting.has(part)) return false;
  if (!STYLE_CALCULATIONS.has(addressByPart.get(part.composition.calculation))) return false;
  const next = new Set(visiting); next.add(part);
  return Object.values(part.composition.inputs).every((input) => stylePartVisible(input, addressByPart, next));
}

/** Merge the existing service inspector with the style-only, read-only view. */
export function createStyleInspectionBoard(pxc, serviceBoard) {
  if (!pxc || typeof pxc.entries !== 'function' || typeof pxc.receipts !== 'function' ||
      !serviceBoard || typeof serviceBoard.entries !== 'function' || typeof serviceBoard.receipts !== 'function') {
    throw new TypeError('The owning PxC and existing read-only service board are required.');
  }
  const styleBoard = Object.freeze({
    entries() {
      const all = pxc.entries();
      const addressByPart = new Map(all.map(([address, part]) => [part, address]));
      return Object.freeze(all.filter(([address, part]) =>
        (STYLE_CALCULATIONS.has(address) || STYLE_SOURCES.test(address) || STYLE_OUTPUTS.test(address)) &&
        stylePartVisible(part, addressByPart)).map((entry) => Object.freeze(entry)));
    },
    get(address) {
      const entry = this.entries().find(([name]) => name === address);
      if (!entry) throw new Error('Missing visible HH style Part.');
      return entry[1];
    },
    receipts() {
      const entries = this.entries();
      const byAddress = new Map(entries);
      const parts = new Set(byAddress.values());
      return Object.freeze(pxc.receipts().filter((receipt) => receipt.status === 'produced' &&
        STYLE_OUTPUTS.test(receipt.into) && byAddress.get(receipt.into) === receipt.output &&
        parts.has(receipt.composition.calculation) &&
        Object.values(receipt.composition.inputs).every((part) => parts.has(part))));
    },
    set() { throw new TypeError('HH style inspection is read-only.'); },
    async compose() { throw new TypeError('HH style inspection is read-only.'); },
  });
  const denied = () => { throw new TypeError('HH DevTools inspection is read-only.'); };
  return Object.freeze({
    entries() {
      const allowed = new Map([...serviceBoard.entries(), ...styleBoard.entries()]);
      return Object.freeze(pxc.entries().filter(([address, part]) => allowed.get(address) === part).map((entry) => Object.freeze(entry)));
    },
    get(address) {
      if (serviceBoard.entries().some(([name]) => name === address)) return serviceBoard.get(address);
      return styleBoard.get(address);
    },
    receipts() {
      const visible = new Set([...serviceBoard.receipts(), ...styleBoard.receipts()]);
      return Object.freeze(pxc.receipts().filter((receipt) => visible.has(receipt)));
    },
    set: denied,
    async compose() { denied(); },
  });
}

/** Apply only the four numeric style outputs produced by the shipped Calculation chain. */
export function applyStyleVariables(target, variablesPart) {
  const variables = variablesPart?.value?.cssVariables;
  if (!target?.style || typeof target.style.setProperty !== 'function' || typeof target.style.removeProperty !== 'function') {
    throw new TypeError('A fixed HH app element is required for the style boundary.');
  }
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    throw new TypeError('A CSS-variable Calculation Part is required.');
  }
  const keys = Object.keys(variables);
  const allowed = Object.keys(CSS_VALUE_RULES);
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(variables, key))) {
    throw new TypeError('Only the four declared HH style properties may be applied.');
  }
  const safe = {};
  for (const property of allowed) {
    const {field, pattern} = CSS_VALUE_RULES[property];
    const value = variables[property];
    if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`Invalid value for ${property}.`);
    const number = Number(value.endsWith('px') ? value.slice(0, -2) : value);
    if (!Number.isSafeInteger(number) || number < STYLE_LIMITS[field].min || number > STYLE_LIMITS[field].max) {
      throw new RangeError(`Value for ${property} exceeds its declared bound.`);
    }
    safe[property] = value;
  }
  for (const property of allowed) target.style.setProperty(property, safe[property]);
  return Object.freeze({...safe});
}

export function resetStyleVariables(target) {
  if (!target?.style || typeof target.style.removeProperty !== 'function') {
    throw new TypeError('A fixed HH app element is required for the style boundary.');
  }
  for (const property of Object.keys(CSS_VALUE_RULES)) target.style.removeProperty(property);
}

function element(tag, text = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function validStorage(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function' ? storage : null;
}

/** Reusable control surface; all operations are fixed HH style methods, never source-code execution. */
export function mountStylePlayground(host, {playground, target, storage = globalThis.sessionStorage, onInspect = () => {}} = {}) {
  if (!host || !playground || typeof playground.generate !== 'function' || typeof playground.select !== 'function' ||
      typeof playground.cssVariables !== 'function' || typeof playground.keep !== 'function' ||
      typeof playground.restore !== 'function') throw new TypeError('The bounded HH style-playground API is required.');
  if (!target) throw new TypeError('The HH app root is the only supported styling target.');
  const tabStorage = validStorage(storage);
  host.replaceChildren();
  const intro = element('p', 'Six reproducible style variants from bounded Parts. Only the accent hue, card padding, layout gap, and corner radius can change. Teacher content stays unchanged, and accent text and controls remain high-contrast.');
  intro.className = 'pxdt-style-intro';
  const seedLabel = element('label', 'Repeatable seed');
  const seedInput = element('input');
  seedInput.type = 'number'; seedInput.min = '0'; seedInput.max = '2147483647'; seedInput.step = '1'; seedInput.value = '20261003';
  seedInput.inputMode = 'numeric'; seedLabel.append(seedInput);
  const bounds = element('fieldset'); bounds.className = 'pxdt-style-bounds';
  bounds.append(element('legend', 'Allowed ranges'));
  const boundInputs = {};
  for (const key of STYLE_FIELDS) {
    const row = element('div'); row.className = 'pxdt-style-range';
    row.append(element('span', BOUND_LABELS[key]));
    const range = {};
    for (const edge of ['min', 'max']) {
      const label = element('label', edge === 'min' ? 'Min' : 'Max');
      const input = element('input'); input.type = 'number'; input.step = '1';
      input.setAttribute('aria-label', `${BOUND_LABELS[key]} ${edge === 'min' ? 'minimum' : 'maximum'}`);
      input.min = String(STYLE_LIMITS[key].min); input.max = String(STYLE_LIMITS[key].max);
      input.value = String(DEFAULT_BOUNDS[key][edge]);
      label.append(input); row.append(label); range[edge] = input;
    }
    boundInputs[key] = range;
    bounds.append(row);
  }
  const actions = element('div'); actions.className = 'pxdt-style-actions';
  const generateButton = element('button', 'Generate six styles'); generateButton.type = 'button';
  const replayButton = element('button', 'Replay same seed'); replayButton.type = 'button'; replayButton.disabled = true;
  const keepButton = element('button', 'Keep selected style'); keepButton.type = 'button'; keepButton.disabled = true;
  const resetButton = element('button', 'Reset style'); resetButton.type = 'button';
  const exportButton = element('button', 'Export kept values'); exportButton.type = 'button'; exportButton.disabled = true;
  actions.append(generateButton, replayButton, keepButton, resetButton, exportButton);
  const partLinks = element('div'); partLinks.className = 'pxdt-style-parts';
  const candidates = element('div'); candidates.className = 'pxdt-style-candidates'; candidates.setAttribute('role', 'group'); candidates.setAttribute('aria-label', 'Six bounded style variants');
  const status = element('p'); status.className = 'pxdt-style-status'; status.setAttribute('role', 'status'); status.textContent = 'No style experiment has run.';
  const output = element('details'); output.className = 'pxdt-style-export';
  const outputSummary = element('summary', 'Kept values · portable JSON');
  const outputPre = element('pre', 'No style saved for this tab yet.');
  output.append(outputSummary, outputPre);
  host.append(intro, seedLabel, bounds, actions, partLinks, candidates, status, output);

  let lastRequest = null;
  let generation = null;
  let selection = null;
  let variables = null;
  let keptPart = null;
  let latestKeptValue = null;
  function setStatus(message) { status.textContent = message; }
  function readInteger(input, label) {
    const raw = input.value.trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new RangeError(`${label} must be a non-negative whole number.`);
    const number = Number(raw);
    if (!Number.isSafeInteger(number)) throw new RangeError(`${label} is outside the supported range.`);
    return number;
  }
  function readRequest() {
    const safeBounds = Object.fromEntries(STYLE_FIELDS.map((key) => [key, {
      min: readInteger(boundInputs[key].min, `${BOUND_LABELS[key]} minimum`),
      max: readInteger(boundInputs[key].max, `${BOUND_LABELS[key]} maximum`),
    }]));
    return {seed: readInteger(seedInput, 'Seed'), bounds: safeBounds};
  }
  function renderLinks(current) {
    const links = [
      ['Seed Part', current.seedAddress], ['Bounds Part', current.boundsAddress], ['Six variants Part', current.candidatesAddress],
    ].map(([label, address]) => {
      const link = element('button', label); link.type = 'button'; link.dataset.partAddress = address;
      link.addEventListener('click', () => onInspect(address));
      return link;
    });
    partLinks.replaceChildren(...links);
  }
  function renderCandidates(current) {
    candidates.replaceChildren(...current.candidates.value.candidates.map((style, index) => {
      const button = element('button'); button.type = 'button'; button.className = 'pxdt-style-choice';
      button.setAttribute('aria-pressed', 'false'); button.dataset.styleIndex = String(index);
      const swatch = element('span'); swatch.className = 'pxdt-style-swatch';
      swatch.style.setProperty(STYLE_CSS_PROPERTIES.accentHue, String(style.accentHue));
      const name = element('strong', `Style ${index + 1}`);
      const values = element('small', `Hue ${style.accentHue} · Card ${style.cardPadding}px · Gap ${style.layoutGap}px · Radius ${style.cornerRadius}px`);
      const preview = element('span'); preview.className = 'pxdt-style-preview';
      preview.style.setProperty(STYLE_CSS_PROPERTIES.accentHue, String(style.accentHue));
      preview.style.setProperty(STYLE_CSS_PROPERTIES.cardPadding, `${style.cardPadding}px`);
      preview.style.setProperty(STYLE_CSS_PROPERTIES.layoutGap, `${style.layoutGap}px`);
      preview.style.setProperty(STYLE_CSS_PROPERTIES.cornerRadius, `${style.cornerRadius}px`);
      preview.append(element('span'), element('span'));
      button.append(swatch, name, values, preview);
      button.addEventListener('click', () => { void selectCandidate(index); });
      return button;
    }));
  }
  async function selectCandidate(index) {
    if (!generation) return;
    for (const button of candidates.querySelectorAll('button')) button.disabled = true;
    try {
      selection = await playground.select(generation, index);
      variables = await playground.cssVariables(selection);
      applyStyleVariables(target, variables);
      for (const button of candidates.querySelectorAll('button')) button.setAttribute('aria-pressed', String(Number(button.dataset.styleIndex) === index));
      keepButton.disabled = false; exportButton.disabled = !latestKeptValue;
      setStatus(`Style ${index + 1} is applied to the HH page. This is a reversible CSS-variable change; no teacher-state Calculation ran.`);
      onInspect(selection.address);
    } catch (error) {
      setStatus(`Style could not be applied: ${String(error)}`);
    } finally {
      for (const button of candidates.querySelectorAll('button')) button.disabled = false;
    }
  }
  async function generate(request, {replay = false} = {}) {
    generateButton.disabled = true; replayButton.disabled = true;
    try {
      generation = await playground.generate(request);
      lastRequest = {seed: request.seed, bounds: request.bounds};
      selection = null; variables = null; keptPart = null;
      renderLinks(generation); renderCandidates(generation);
      keepButton.disabled = true; replayButton.disabled = false; exportButton.disabled = !latestKeptValue;
      setStatus(`${replay ? 'Replayed' : 'Generated'} six deterministic variants with seed ${request.seed}. Choose one to apply it.`);
      onInspect(generation.candidatesAddress);
    } catch (error) {
      setStatus(`No variants generated: ${String(error)}`);
    } finally {
      generateButton.disabled = false; replayButton.disabled = !lastRequest;
    }
  }
  generateButton.addEventListener('click', () => {
    try { void generate(readRequest()); } catch (error) { setStatus(`Check the seed and bounds: ${String(error)}`); }
  });
  replayButton.addEventListener('click', () => { if (lastRequest) void generate(lastRequest, {replay: true}); });
  keepButton.addEventListener('click', async () => {
    if (!selection || !variables) return;
    keepButton.disabled = true;
    try {
      keptPart = await playground.keep(selection, variables);
      latestKeptValue = keptPart.value;
      outputPre.textContent = JSON.stringify(latestKeptValue, null, 2);
      output.open = true;
      let saved = false;
      try { if (tabStorage) { tabStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(latestKeptValue)); saved = true; } }
      catch { /* Keep remains available in this mounted tab and can still be exported. */ }
      exportButton.disabled = false;
      setStatus(saved ? 'Kept for this tab. The selected style will return after a page reload.' : 'Kept for this page. Session storage is unavailable; export the values to carry them forward.');
      const address = pxcAddressFor(keptPart);
      if (address) onInspect(address);
    } catch (error) { setStatus(`Style was not kept: ${String(error)}`); }
    finally { keepButton.disabled = false; }
  });
  function pxcAddressFor(part) { return part && playground.addressOf?.(part) || null; }
  function download() {
    if (!latestKeptValue) return;
    const blob = new Blob([JSON.stringify(latestKeptValue, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = element('a', 'Download JSON'); link.href = url; link.download = 'hh-style-playground.json';
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  exportButton.addEventListener('click', download);
  resetButton.addEventListener('click', () => {
    try { resetStyleVariables(target); }
    catch (error) { setStatus(`Style reset failed: ${String(error)}`); return; }
    let cleared = true;
    try { if (tabStorage) tabStorage.removeItem(STYLE_STORAGE_KEY); }
    catch { cleared = false; }
    generation = null; selection = null; variables = null; keptPart = null; latestKeptValue = null;
    lastRequest = null; candidates.replaceChildren(); partLinks.replaceChildren();
    replayButton.disabled = true; keepButton.disabled = true; exportButton.disabled = true;
    outputPre.textContent = 'No style saved for this tab yet.';
    setStatus(cleared ? 'Style reset to the HH defaults. Teacher journey state and PxC receipts are unchanged.' : 'Style reset to the HH defaults. Session storage could not be cleared; the saved style may return after reload.');
  });

  try {
    const raw = tabStorage?.getItem(STYLE_STORAGE_KEY);
    if (raw) {
      const record = JSON.parse(raw);
      void (async () => {
        try {
          const restored = await playground.restore(record);
          const restoredVariables = await playground.cssVariables(restored);
          applyStyleVariables(target, restoredVariables);
          latestKeptValue = record;
          outputPre.textContent = JSON.stringify(record, null, 2);
          output.open = true; exportButton.disabled = false;
          setStatus(`Restored the kept style from seed ${record.seed}. Replay it to see the six variants again.`);
          onInspect(restored.address);
        } catch (error) { setStatus(`Saved style was not restored: ${String(error)}`); }
      })();
    }
  } catch (error) { setStatus(`Saved style could not be read: ${String(error)}`); }
  return Object.freeze({
    reset() { resetButton.click(); },
    getState() { return Object.freeze({generation, selection, variables, keptPart, latestKeptValue}); },
  });
}
