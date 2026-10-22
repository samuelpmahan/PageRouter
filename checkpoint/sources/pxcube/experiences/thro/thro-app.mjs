import { openWorkspace } from './workspace.mjs';
import { nativeStudies, isNativeStudy, nativeStudy, nativeDesign, nativeControlDesign } from './native-cards.mjs';
import { alphaBounds, fitArtwork } from './preview-frame.mjs';
import { loadFixture } from './prepared-fixture.mjs';
import { defaultDesign, compositionStudies, compositionSizeStudies } from './graphics.mjs';
import { esc } from './renderer/src/presentation.js';
import { pngFromSvg, sha256, downloadBlob } from './renderer/src/media.js';

const $ = id => document.getElementById(id);
const debug = new URLSearchParams(location.search).get('debug') === '1';
const root = $('workspace');
let workspace, rows = [], currentResult = null, capturedPreview = null;
let queue = Promise.resolve(), busy = false, failedIntent = null, recoveredDraft = null, buildInfo = null;
let ui = { mode: 'single', selectedDisc: null, selection: [], design: { ...defaultDesign }, bagName: '', background: 'checker', view: 'closeup' };
const keptResults = new Map();
const remembered = (() => { try { return JSON.parse(localStorage.getItem('thro-preview') || '{}'); } catch { return {}; } })();
if (['checker', 'light', 'dark'].includes(remembered.background)) ui.background = remembered.background;
if (['closeup', 'frame'].includes(remembered.view)) ui.view = remembered.view;
const rememberPreview = () => { try { localStorage.setItem('thro-preview', JSON.stringify({ background: ui.background, view: ui.view })); } catch { /* storage unavailable: the choice lasts until reload */ } };
let lastDownload = null; // the confirmation shown inside the export bar after a download or keep
let portraitDetail = true, portraitFrameRequest = 0, portraitBoundsCache = null, portraitReflowFrame = 0;
const text = value => esc(String(value ?? ''));
const message = (value, error = false) => { $('status').textContent = value; $('status').classList.toggle('is-error', error); };
const context = () => workspace.model.context;
const value = address => workspace.model.value(address);
const currentGraphic = () => capturedPreview?.capture.graphic ?? currentResult?.graphic;
const hasConflict = () => Boolean(workspace?.conflict);
const option = (v, label, chosen) => `<option value="${text(v)}" ${v === chosen ? 'selected' : ''}>${text(label)}</option>`;
const facts = row => [row.disc.plastic, row.disc.weight == null ? null : `${row.disc.weight} g`].filter(Boolean).join(' · ');
const rowName = row => row?.seed?.name ?? row?.disc?.nickname ?? 'Prepared disc';
const resultKey = result => result?.address ?? result?.graphic?.svg;

function setBusy(next) {
  busy = next;
  root.setAttribute('aria-busy', String(next));
  // Busy does not disable these: run() queues actions, so a tap during a save waits its turn instead of being lost.
  document.querySelectorAll('[data-needs-ready]').forEach(button => { button.disabled = hasConflict() || !currentGraphic(); });
  if ($('retry-export')) $('retry-export').disabled = next || hasConflict();
  $('reload-latest').disabled = next;
  if (hasConflict()) root.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
}

function diagnostics() {
  if (!debug || !workspace) return;
  $('diagnostics').hidden = false;
  let model;
  try { model = workspace.model.inspect(); } catch (error) { model = { error: String(error) }; }
  $('diagnostic-values').textContent = JSON.stringify({ build: buildInfo, conflict: workspace.conflict, pendingDraft: workspace.draft, ui, model }, (_key, item) => typeof item === 'function' ? '[Calculation]' : item, 2);
}

function showConflict(error) {
  const conflict = workspace?.conflict;
  if (!conflict) return;
  const headings = {
    THRO_STORAGE_CONFLICT: 'A newer tab saved first. Your pending draft is retained.',
    THRO_STORAGE_UNAVAILABLE: 'Saving is unavailable. Your pending draft is retained.',
    THRO_STORAGE_UNCERTAIN: 'The save outcome is uncertain. Your pending draft is retained.',
    THRO_STORAGE_CHANGED: 'The draft changed before saving. Your pending draft is retained.',
  };
  $('conflict').hidden = false;
  document.body.classList.add('has-conflict'); // the fixed export bar must not cover the recovery actions
  $('conflict').classList.remove('is-recovered');
  $('conflict-title').textContent = headings[conflict.code] ?? 'This save stopped. Your pending draft is retained.';
  $('reload-latest').hidden = false;
  $('conflict-copy').textContent = `${conflict.message || error?.message || 'The save could not be completed.'} Your controls are preserved. Download the pending draft before reloading; reload replaces this view with the stored workspace.`;
  message(conflict.code === 'THRO_STORAGE_UNCERTAIN' ? 'Save not confirmed. Your pending draft is retained below.' : 'Not saved. Your pending draft is retained below.', true);
  root.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
  $('conflict').setAttribute('tabindex', '-1');
  $('conflict').scrollIntoView({ block: 'center' });
  $('conflict').focus({ preventScroll: true });
  diagnostics();
}

function run(action, intent = null) {
  const request = intent == null ? null : structuredClone(intent);
  queue = queue.then(async () => {
    setBusy(true);
    try {
      if (hasConflict()) throw workspace.conflict;
      await action();
      failedIntent = null;
    } catch (error) {
      failedIntent = request ?? failedIntent;
      if (hasConflict()) showConflict(error);
      else message(error?.message || String(error), true);
    } finally { setBusy(false); diagnostics(); }
  });
  return queue;
}

function adoptContext() {
  const saved = context();
  ui.mode = ['single', 'battle', 'bag'].includes(saved.throMode) ? saved.throMode : saved.graphicsPurpose === 'competition' ? 'battle' : 'single';
  ui.selectedDisc = rows.some(row => row.address === saved.selectedDisc) ? saved.selectedDisc : rows[0]?.address;
  ui.selection = [...(saved.selection ?? [])].filter(address => rows.some(row => row.address === address));
  ui.design = { ...defaultDesign, ...saved.design };
  ui.bagName = saved.name ?? '';
}

function shelfMarkup() {
  const multiple = ui.mode !== 'single';
  return `<aside class="shelf panel" aria-labelledby="shelf-title"><div class="section-heading"><div><span class="eyebrow">STEP 1 · PICK</span><h2 id="shelf-title">Your discs</h2></div><span class="count">${rows.length}</span></div><p class="subtle">${multiple ? 'Choose 2–4 exact copies for this image.' : 'Pick the disc you want on screen.'}</p><div class="disc-shelf" data-testid="prepared-shelf">${rows.map((row, index) => {
    const selected = multiple ? ui.selection.includes(row.address) : ui.selectedDisc === row.address;
    return `<button type="button" class="disc-choice ${selected ? 'is-selected' : ''}" data-disc="${text(row.address)}" aria-pressed="${selected}" aria-label="${text(row.seed.manufacturer)} ${text(rowName(row))}${facts(row) ? `, ${text(facts(row))}` : ''}"><span class="disc-thumb"><img src="${text(row.art)}" alt="" loading="${index < 4 ? 'eager' : 'lazy'}"><span class="selection-mark" aria-hidden="true">${selected ? '✓' : '+'}</span></span><span class="disc-copy"><span class="disc-maker">${text(row.seed.manufacturer)}</span><strong>${text(rowName(row))}</strong>${facts(row) ? `<span>${text(facts(row))}</span>` : ''}</span></button>`;
  }).join('')}</div>${multiple ? `<div class="lineup-total"><strong>${ui.selection.length} selected</strong><span>2–4-disc graphic</span></div>` : ''}</aside>`;
}

function battleMarkup() {
  if (ui.mode === 'single' || !context().competitionAddress) return '';
  const material = value(context().competitionAddress), state = material.states[0];
  return `<section class="battle-controls"><div class="section-heading"><h3>${ui.mode === 'bag' ? 'Lineup treatment' : 'Turn & points'}</h3><button type="button" class="text-button" data-battle-equal>Equal sizes</button></div><label>Whose turn?<select id="battle-turn">${option('', 'Show the lineup', state.highlight ?? '')}${material.entries.map(entry => option(entry.id, entry.name, state.highlight)).join('')}</select></label>${material.entries.map(entry => {
    const appearance = material.styles?.[entry.id], scale = appearance?.scale ?? (material.emphasizeTurn && state.highlight && state.highlight !== entry.id ? .65 : 1);
    return `<div class="battle-entry"><strong>${text(entry.name)}</strong><div class="entry-fields"><label>Points<input type="number" data-points="${text(entry.id)}" min="-9999" max="9999" step="1" value="${state.scores[entry.id] ?? 0}"></label><label>Size<select data-entry-size="${text(entry.id)}">${[.45, .65, .8, 1, 1.2, 1.5, scale].filter((v, i, all) => all.indexOf(v) === i).sort((a, b) => a - b).map(v => option(String(v), `${Math.round(v * 100)}%`, String(scale))).join('')}</select></label><label class="entry-accent">Accent<input type="color" data-entry-color="${text(entry.id)}" value="${text(appearance?.accent ?? (state.highlight === entry.id && material.emphasizeTurn ? '#ffd166' : ui.design.accent))}"></label></div></div>`;
  }).join('')}</section>`;
}

function bagMarkup() {
  if (ui.mode !== 'bag') return '';
  const bags = workspace.model.experience.bags();
  return `<section class="bag-controls"><h3>Keep this named bag</h3><p class="subtle">This image shows a selected 2–4-disc lineup. Saved bags retain their exact copies and order.</p><label>Bag name<input id="bag-name" maxlength="80" value="${text(ui.bagName)}" placeholder="My video lineup"></label><button type="button" id="save-bag" class="button-secondary">Save bag</button>${bags.length ? `<label>Open saved bag<select id="saved-bag"><option value="">Choose a bag</option>${bags.map(({ address, bag }) => option(address, `${bag.name} · ${bag.discIds.length} copies`, '')).join('')}</select></label>` : ''}</section>`;
}

// ---- Layout names ----
const allStudies = () => [...nativeStudies, ...compositionStudies];
const studyName = id => allStudies().find(study => study.id === id)?.name;
// "DiscStudio B01 - Hero rail" reads as "B01 Hero rail" under its "DiscStudio cards" heading.
const shortStudyName = study => isNativeStudy(study.id) ? study.name.replace(/^DiscStudio\s+/, '').replace(/\s+-\s+/, ' ') : study.name;
function keptDetail(capture) {
  const design = capture.design ?? {}, study = allStudies().find(item => item.id === design.study), parts = [study ? shortStudyName(study) : null, design.title ? `“${design.title}”` : null, `${capture.graphic.width} × ${capture.graphic.height}`];
  return parts.filter(Boolean).join(' · ');
}

// ---- Close-up framing ----
// Frames the on-screen preview on the graphic itself instead of the whole canvas.
// Only the preview changes; downloads always use the exact full canvas.
// Vector graphics are measured from their laid-out SVG groups; DiscStudio's raster
// cards are measured from their transparent pixels with Dab's alphaBounds.
const rasterBoundsCache = new Map();
function rasterBounds(svg) {
  if (rasterBoundsCache.has(svg)) return rasterBoundsCache.get(svg);
  const promise = (async () => {
    const source = /href="(data:image\/png;base64,[^"]+)"/.exec(svg)?.[1];
    if (!source) return null;
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const pixels = canvas.getContext('2d', { willReadFrequently: true }); pixels.drawImage(image, 0, 0);
    return alphaBounds(pixels.getImageData(0, 0, canvas.width, canvas.height));
  })().catch(() => null);
  if (rasterBoundsCache.size > 40) rasterBoundsCache.delete(rasterBoundsCache.keys().next().value);
  rasterBoundsCache.set(svg, promise);
  return promise;
}
function applyCrop(holder, graphic, box, force) {
  const svg = holder.querySelector('svg');
  if (!svg) return;
  let { x, y, w, h } = box;
  if (w > graphic.width * .9 && h > graphic.height * .9) { if (force) holder.style.aspectRatio = ''; return; } // already fills the canvas
  const pad = Math.max(w, h) * .06;
  x = Math.max(0, x - pad); y = Math.max(0, y - pad);
  w = Math.min(graphic.width - x, w + pad * 2); h = Math.min(graphic.height - y, h + pad * 2);
  svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  if (force) { holder.style.aspectRatio = ''; return; } // thumbnails keep their fixed box; the cropped view is centred inside it
  holder.style.aspectRatio = `${w.toFixed(1)} / ${h.toFixed(1)}`;
  holder.classList.add('is-closeup');
}
const compactPortrait = graphic => Boolean(graphic?.provenance?.rasterOnly && graphic.width === 1080 && graphic.height === 1920 && matchMedia('(max-width:760px)').matches);
function closeUp(holder, graphic, force = false) {
  const svg = holder.querySelector('svg');
  if (!svg || (!force && ui.view !== 'closeup')) return;
  if (graphic.provenance?.rasterOnly) {
    if (!force && compactPortrait(graphic)) return; // Dab's portrait framing handles phones (framePortraitPreview)
    return rasterBounds(graphic.svg).then(bounds => {
      if (!bounds || holder.querySelector('svg') !== svg) return;
      applyCrop(holder, graphic, { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }, force);
    });
  }
  const frame = svg.getBoundingClientRect();
  if (!frame.width || !frame.height) return;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const child of svg.children) {
    if (['defs', 'style', 'title', 'desc'].includes(child.tagName.toLowerCase())) continue;
    const box = child.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    left = Math.min(left, box.left); top = Math.min(top, box.top); right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  }
  if (!Number.isFinite(left)) return;
  const scale = graphic.width / frame.width;
  applyCrop(holder, graphic, { x: (left - frame.left) * scale, y: (top - frame.top) * scale, w: (right - left) * scale, h: (bottom - top) * scale }, force);
}

// ---- Composition thumbnails: each layout rendered with the disc on screen ----
// Several inline SVGs share one document, so their clip-path and mask ids must not collide.
const uniqueIds = (svg, prefix) => svg
  .replace(/\bid="([^"]+)"/g, (_m, id) => `id="${prefix}${id}"`)
  .replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${prefix}${id})`)
  .replace(/\b(xlink:href|href)="#([^"]+)"/g, (_m, attr, id) => `${attr}="#${prefix}${id}"`);
let thumbToken = 0;
function thumbDesign(id) {
  if (isNativeStudy(id)) return nativeDesign(ui.design, id);
  const base = isNativeStudy(ui.design.study) ? { ...defaultDesign, ...context().legacyDesign } : ui.design;
  return { ...base, study: id, frame: 'none', title: '', placement: 'bottom-left', compositionOffsetX: 0, compositionOffsetY: 0, compositionSize: 'balanced' };
}
// Rendered thumbnails are cached by everything that changes how they look, so a repaint
// never blanks the picker; a stale thumbnail stays visible (dimmed) while its new one renders.
const thumbCache = new Map(), lastThumb = new Map();
const thumbKey = (disc, id) => { const d = thumbDesign(id); return JSON.stringify([disc, id, d.accent, d.foreground, d.background, d.nativeSide ?? null, d.nativeHighlight ?? null, d.nativeScale ?? null]); };
async function paintCompositionThumbs() {
  const token = ++thumbToken, disc = ui.mode === 'single' ? ui.selectedDisc : (ui.selection[0] ?? ui.selectedDisc);
  if (!disc) return;
  const studies = ui.mode === 'single' ? allStudies() : compositionStudies, misses = [];
  for (const study of studies) { // instant pass: cached, else the last version dimmed
    const slot = document.querySelector(`[data-study-thumb="${CSS.escape(study.id)}"]`);
    if (!slot) continue;
    const key = thumbKey(disc, study.id), hit = thumbCache.get(key);
    if (hit) { slot.innerHTML = hit; continue; }
    if (lastThumb.has(study.id)) { slot.innerHTML = lastThumb.get(study.id); slot.classList.add('is-stale'); }
    misses.push({ study, slot, key });
  }
  // The chosen layout first, then the fast vector compositions, then the DiscStudio raster cards.
  misses.sort((a, b) => (b.study.id === ui.design.study) - (a.study.id === ui.design.study) || isNativeStudy(a.study.id) - isNativeStudy(b.study.id));
  for (const { study, slot, key } of misses) {
    try {
      const result = await workspace.single(disc, thumbDesign(study.id));
      if (token !== thumbToken || !slot.isConnected) return;
      slot.innerHTML = uniqueIds(result.graphic.svg, `thumb-${study.id.replace(/[^a-z0-9-]/gi, '-')}-`);
      slot.style.aspectRatio = `${result.graphic.width} / ${result.graphic.height}`;
      await closeUp(slot, result.graphic, true);
      if (!slot.isConnected) return;
      thumbCache.set(key, slot.innerHTML); lastThumb.set(study.id, slot.innerHTML);
      if (thumbCache.size > 200) thumbCache.delete(thumbCache.keys().next().value);
      slot.classList.remove('is-stale', 'is-unavailable');
    } catch { slot.classList.add('is-unavailable'); }
  }
}

// ---- Accent swatches: one sampled from the disc, then a fixed palette ----
const palette = [['#a6edda', 'Mint'], ['#c8f49d', 'Lime'], ['#ffd166', 'Gold'], ['#ff7a45', 'Orange'], ['#ff4d6d', 'Red'], ['#c77dff', 'Violet'], ['#4cc9f0', 'Sky'], ['#f6f3e9', 'Chalk']];
let discColour = null; // { disc, colour }
function swatchMarkup(chosen) {
  const sampled = discColour && discColour.disc === (ui.mode === 'single' ? ui.selectedDisc : ui.selection[0]) ? discColour.colour : null;
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  return `<button type="button" class="swatch-choice swatch-match" data-accent="${text(sampled ?? '')}" aria-pressed="${Boolean(sampled && same(sampled, chosen))}" ${sampled ? '' : 'disabled'} title="Match the disc colour"><span style="background:${text(sampled ?? '#556052')}"></span>Match disc</button>${palette.map(([value, name]) => `<button type="button" class="swatch-choice" data-accent="${value}" aria-pressed="${same(value, chosen)}" aria-label="${name}" title="${name}"><span style="background:${value}"></span></button>`).join('')}`;
}
function sampleDiscColour() {
  const disc = ui.mode === 'single' ? ui.selectedDisc : ui.selection[0];
  const img = document.querySelector(`[data-disc="${CSS.escape(disc ?? '')}"] img`);
  if (!img || discColour?.disc === disc) return;
  const read = () => {
    try {
      const size = 48, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data, bins = Array.from({ length: 24 }, () => ({ weight: 0, pixels: [] }));
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = x - size / 2, dy = y - size / 2; if (dx * dx + dy * dy > (size * .42) ** 2) continue; // inside the rim only
        const i = (y * size + x) * 4, R = data[i], G = data[i + 1], B = data[i + 2], A = data[i + 3];
        const max = Math.max(R, G, B), min = Math.min(R, G, B), sat = max ? (max - min) / max : 0;
        if (A < 200 || max < 60 || sat < .3) continue; // skip shadows, glare and grey stamp ink
        const d = max - min, hue = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
        const bin = bins[Math.floor(hue / 6 * 24) % 24]; bin.weight += sat * max; bin.pixels.push([R, G, B, max]);
      }
      const top = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best);
      if (top.pixels.length < 12) return;
      // The plastic's own colour: the brightest third of the dominant hue, so shadows don't muddy it.
      const bright = top.pixels.sort((a, b) => b[3] - a[3]).slice(0, Math.max(6, Math.ceil(top.pixels.length / 3)));
      let r = 0, g = 0, b = 0; for (const [R, G, B] of bright) { r += R; g += G; b += B; }
      const n = bright.length, lift = Math.min(1.6, 235 / Math.max(1, r / n, g / n, b / n)); // indoor photos read darker than the plastic looks on screen
      const hex = v => Math.min(255, Math.round(v / n * lift)).toString(16).padStart(2, '0');
      discColour = { disc, colour: `#${hex(r)}${hex(g)}${hex(b)}` };
      const group = document.querySelector('.swatches'); if (group) { group.innerHTML = swatchMarkup(ui.design.accent); bindSwatches(); }
    } catch { /* An unreadable photo simply leaves Match disc disabled. */ }
  };
  if (img.complete && img.naturalWidth) read(); else img.addEventListener('load', read, { once: true });
}
function bindSwatches() {
  document.querySelectorAll('[data-accent]').forEach(button => button.onclick = () => {
    if (!button.dataset.accent) return;
    $('accent').value = button.dataset.accent;
    ui.design = readDesign(); change({ design: structuredClone(ui.design) }, `Accent set to ${button.getAttribute('aria-label') ?? 'the disc colour'}. Your graphic is ready.`);
  });
}

// ---- Confirmation inside the export bar, where the person just tapped ----
function clearNoticeLater() {
  const shown = lastDownload?.at; // clears itself so it never hides the preview for long
  setTimeout(() => { if (lastDownload?.at === shown) { lastDownload = null; document.querySelector('.downloaded')?.remove(); } }, 9000);
}
function downloadedMarkup() {
  if (!lastDownload || Date.now() - lastDownload.at > 9000) return '';
  if (lastDownload.kind === 'keep') return `<div class="downloaded" role="status"><span class="downloaded-mark" aria-hidden="true">✓</span><div><strong>${lastDownload.already ? 'Already kept' : 'Kept this exact version'}</strong><p>It stays in this browser after reload. <a href="#captures-title" class="jump-kept">Show kept graphics</a></p></div></div>`;
  const d = lastDownload, next = d.format === 'png' ? (d.transparent ? 'Drop it on the track above your footage; the checkerboard areas stay see-through.' : 'Drop it on the track above your footage.') : 'Open it in your editor or design tool.';
  return `<div class="downloaded" role="status"><span class="downloaded-mark" aria-hidden="true">✓</span><div><strong>Downloaded ${d.format.toUpperCase()} · ${d.width} × ${d.height}</strong><p><span class="downloaded-file">${text(d.filename)}</span> ${next}</p></div></div>`;
}

function controlsMarkup() {
  const design = ui.design;
  const choice = study => `<button type="button" role="radio" class="composition-choice" data-study="${text(study.id)}" aria-checked="${study.id === design.study}" title="${text(study.note ?? study.name)}"><span class="composition-thumb" data-study-thumb="${text(study.id)}" aria-hidden="true"></span><span class="composition-name">${text(shortStudyName(study))}</span></button>`;
  const picker = `<fieldset class="composition-field"><legend>Composition</legend><input type="hidden" id="composition" value="${text(design.study)}">${ui.mode === 'single' ? `<p class="composition-group">DiscStudio cards</p><div class="composition-picker" role="radiogroup" aria-label="DiscStudio cards">${nativeStudies.map(choice).join('')}</div><p class="composition-group">Compositions</p>` : ''}<div class="composition-picker" role="radiogroup" aria-label="Compositions">${compositionStudies.map(choice).join('')}</div></fieldset>`;
  if (isNativeStudy(design.study)) {
    const selected = nativeStudy(design.study), scale = design.nativeScale ?? .66;
    return `<aside class="controls-panel panel" aria-labelledby="style-title"><div class="section-heading"><div><span class="eyebrow">STEP 2 · STYLE</span><h2 id="style-title">Make it yours</h2></div></div><form id="design-form"><div class="native-primary-controls">${picker}<p class="subtle">DiscStudio card pixels, kept with this exact disc. Placement stays anchored to the layout.</p><label>Card size <output id="native-scale-value">${Math.round(scale * 100)}%</output><input id="native-scale" type="range" min="0.5" max="1.5" step="0.01" value="${scale}" aria-label="Native card size"></label></div><div class="field-pair canvas-fields"><label>Canvas<select id="orientation" disabled>${option(selected.orientation, selected.orientation === 'portrait' ? 'Portrait' : 'Landscape', selected.orientation)}</select></label><label>Accent<input id="accent" type="color" value="${text(design.accent)}"></label></div><div class="swatches" role="group" aria-label="Accent colour">${swatchMarkup(design.accent)}</div><p class="subtle">Canvas dimensions follow the selected card layout.</p><div class="field-pair"><label>Disc side<select id="native-side">${option('left', 'Left', design.nativeSide ?? selected.side)}${option('right', 'Right', design.nativeSide ?? selected.side)}</select></label><label>Highlight<select id="native-highlight">${option('digits', 'Digits', design.nativeHighlight ?? selected.highlight)}${option('tiles', 'Tile blocks', design.nativeHighlight ?? selected.highlight)}</select></label></div></form></aside>`;
  }
  return `<aside class="controls-panel panel" aria-labelledby="style-title"><div class="section-heading"><div><span class="eyebrow">STEP 2 · STYLE</span><h2 id="style-title">Make it yours</h2></div></div><form id="design-form">${picker}<div class="field-pair placement-fields"><fieldset class="placement-field"><legend>Placement <span class="optional">${text(({ 'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right', 'top-left': 'Top left', 'top-right': 'Top right' })[design.placement] ?? '')}</span></legend><input type="hidden" id="placement" value="${text(design.placement)}"><div class="placement-frame" role="radiogroup" aria-label="Where the graphic sits in the video frame">${[['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom center'], ['bottom-right', 'Bottom right']].map(([v, name]) => `<button type="button" role="radio" class="placement-spot spot-${v}" data-placement="${v}" aria-checked="${v === design.placement}" aria-label="${name}" title="${name}"><span aria-hidden="true"></span></button>`).join('')}</div></fieldset><label>Width<select id="composition-size">${compositionSizeStudies.map(size => option(size.id, size.id === 'balanced' ? 'Preferred' : size.id === 'full-width' ? 'Maximum' : 'Compact', design.compositionSize)).join('')}</select></label></div><div class="field-pair canvas-fields"><label>Canvas<select id="orientation">${option('landscape', 'Landscape', design.orientation)}${option('portrait', 'Portrait', design.orientation)}</select></label><label>Accent<input id="accent" type="color" value="${text(design.accent)}"></label></div><div class="swatches" role="group" aria-label="Accent colour">${swatchMarkup(design.accent)}</div><label>Title <span class="optional">optional</span><input id="graphic-title" maxlength="80" value="${text(design.title)}" placeholder="For the next shot"></label><details class="fine-tuning"><summary>More control</summary><div class="field-pair"><label>Background<input id="background" type="color" value="${text(design.background)}"></label><label>Text<input id="foreground" type="color" value="${text(design.foreground)}"></label></div><label>Canvas background<select id="frame">${option('none', 'Transparent', design.frame)}${option('filled', 'Solid', design.frame)}</select></label><div class="field-pair"><label>X offset <span class="optional">px</span><input id="offset-x" type="number" min="-120" max="120" step="20" value="${Number(design.compositionOffsetX) || 0}"></label><label>Y offset <span class="optional">px</span><input id="offset-y" type="number" min="-120" max="120" step="20" value="${Number(design.compositionOffsetY) || 0}"></label></div></details></form>${battleMarkup()}${bagMarkup()}</aside>`;
}

// Kept thumbnails render inline and crop to the graphic, like the composition thumbnails.
function paintKeptThumbs() {
  document.querySelectorAll('[data-capture-thumb]').forEach((slot, index) => {
    try {
      const capture = value(slot.dataset.captureThumb);
      slot.innerHTML = uniqueIds(capture.graphic.svg, `kept-${index}-`);
      slot.querySelector('svg')?.setAttribute('aria-hidden', 'true');
      slot.style.aspectRatio = `${capture.graphic.width} / ${capture.graphic.height}`;
      closeUp(slot, capture.graphic, true);
    } catch { slot.classList.add('is-unavailable'); }
  });
}

function capturesMarkup() {
  const captures = context().graphics ?? [];
  return `<section class="captures panel" aria-labelledby="captures-title"><div class="section-heading"><div><span class="eyebrow">READY WHEN YOU ARE</span><h2 id="captures-title">Kept graphics <span class="inline-count">${captures.length}</span></h2></div><span class="subtle">Exact saved versions</span></div>${captures.length ? `<div class="capture-list">${captures.slice().reverse().map(address => { const capture = value(address); return `<button type="button" class="capture-choice ${capturedPreview?.address === address ? 'is-selected' : ''}" data-capture="${text(address)}" aria-pressed="${capturedPreview?.address === address}"><span class="capture-thumbnail" data-capture-thumb="${text(address)}" aria-hidden="true"></span><span><strong>${text(capture.title)}</strong><small>${text(keptDetail(capture))}</small></span><span class="capture-arrow" aria-hidden="true">↗</span></button>`; }).join('')}</div>` : '<p class="empty-note">Keep a graphic to come back to its exact version.</p>'}</section>`;
}

async function portraitBounds(graphic, holder) {
  if (portraitBoundsCache?.svg === graphic.svg) return portraitBoundsCache.promise;
  const source = holder.querySelector('image')?.getAttribute('href');
  if (!source?.startsWith('data:image/png;base64,')) throw Error('No self-contained native preview image.');
  const promise = (async () => {
    const image = new Image(); image.src = source; await image.decode();
    if (image.naturalWidth !== graphic.width || image.naturalHeight !== graphic.height) throw Error('Preview image dimensions differ from its canvas.');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const pixels = canvas.getContext('2d', { willReadFrequently: true }); pixels.drawImage(image, 0, 0);
    const bounds = alphaBounds(pixels.getImageData(0, 0, canvas.width, canvas.height));
    if (!bounds) throw Error('No native artwork pixels to frame.');
    return bounds;
  })();
  portraitBoundsCache = { svg: graphic.svg, promise };
  return promise;
}

// Re-appending a node that is already in place still blurs whatever had focus inside it,
// so only move the grid's children when their order actually differs.
function orderGrid(grid, ...nodes) {
  if (nodes.length === grid.children.length && nodes.every((node, index) => grid.children[index] === node)) return;
  grid.append(...nodes);
}

async function framePortraitPreview(graphic) {
  const request = ++portraitFrameRequest;
  const grid = root.querySelector('.studio-grid'), preview = root.querySelector('.preview-column');
  const controls = root.querySelector('.controls-panel'), shelf = root.querySelector('.shelf');
  if (!grid || !preview || !controls || !shelf) return;
  const size = $('native-scale'), holder = $('graphic-preview'), toggle = $('preview-framing');
  const title = $('preview-title'), note = $('preview-note');
  title.dataset.standardTitle ??= title.textContent;
  const compact = Boolean(graphic?.provenance?.rasterOnly && graphic.width === 1080 && graphic.height === 1920 && matchMedia('(max-width:760px)').matches);
  root.classList.toggle('compact-native-portrait', compact);
  root.classList.toggle('compact-native-controls', compact && Boolean(size));
  holder.classList.remove('artwork-detail');
  holder.dataset.previewFraming = 'canvas';
  toggle.hidden = true; // the Close-up / Whole frame switch in the toolbar drives this framing
  if (compact) {
    if (size) {
      const anchor = size.closest('.native-primary-controls'); // above the thumbnail picker, so the card stays in view
      if (anchor.previousElementSibling !== preview) anchor.before(preview); // moving an element blurs focus inside it
      orderGrid(grid, ...[...grid.children].filter(node => node !== controls && node !== shelf), controls, shelf);
    } else {
      orderGrid(grid, preview, shelf, controls);
    }
  } else {
    orderGrid(grid, shelf, preview, controls);
    title.textContent = title.dataset.standardTitle;
    note.textContent = note.dataset.standardNote;
    return;
  }
  const fullCanvas = () => {
    title.textContent = capturedPreview ? 'Kept version: canvas' : 'Full canvas';
    toggle.textContent = 'Artwork detail';
    toggle.setAttribute('aria-label', 'Show artwork detail preview');
    note.textContent = `${capturedPreview ? 'Kept version. Your current design stays available. ' : ''}Full canvas. Preview backgrounds are not exported.`;
  };
  fullCanvas();
  if (ui.view !== 'closeup') return;
  holder.dataset.previewFraming = 'loading';
  try {
    const bounds = await portraitBounds(graphic, holder);
    if (request !== portraitFrameRequest || holder !== $('graphic-preview') || graphic !== currentGraphic()) return;
    title.textContent = capturedPreview ? 'Kept version: detail' : 'Artwork detail';
    toggle.textContent = 'Full canvas';
    toggle.setAttribute('aria-label', 'Show full canvas preview');
    const available = root.querySelector('.export-bar').getBoundingClientRect().top - holder.getBoundingClientRect().top - 12;
    if (available < 80) {
      holder.dataset.previewFraming = 'canvas';
      fullCanvas();
      note.textContent += ' Scroll to inspect the canvas around the export notice.';
      return;
    }
    const height = Math.min(240, available);
    const fit = fitArtwork({ canvasWidth: graphic.width, canvasHeight: graphic.height, bounds, width: holder.parentElement.clientWidth, height });
    for (const [name, number] of Object.entries({ 'canvas-width': graphic.width, 'canvas-height': graphic.height, 'frame-scale': fit.scale, 'frame-x': fit.x, 'frame-y': fit.y, 'frame-height': height })) holder.style.setProperty(`--portrait-${name}`, String(number));
    holder.classList.add('artwork-detail');
    holder.dataset.previewFraming = 'detail';
    title.textContent = capturedPreview ? 'Kept version: detail' : 'Artwork detail';
    toggle.textContent = 'Full canvas';
    toggle.setAttribute('aria-label', 'Show full canvas preview');
    note.textContent = `${capturedPreview ? 'Kept version. Your current design stays available. ' : ''}Zoomed artwork preview. Full canvas shows the exact exported placement.`;
  } catch {
    if (request !== portraitFrameRequest || holder !== $('graphic-preview') || graphic !== currentGraphic()) return;
    if (portraitBoundsCache?.svg === graphic.svg) portraitBoundsCache = null;
    holder.dataset.previewFraming = 'canvas';
    fullCanvas();
    note.textContent += ' Artwork detail is unavailable; your export is unchanged.';
  }
}
function schedulePortraitFrame() {
  if (portraitReflowFrame) cancelAnimationFrame(portraitReflowFrame);
  portraitReflowFrame = requestAnimationFrame(() => { portraitReflowFrame = 0; framePortraitPreview(currentGraphic()); });
}
addEventListener('resize', schedulePortraitFrame);
window.visualViewport?.addEventListener('resize', schedulePortraitFrame);

function paintPreview() {
  const graphic = currentGraphic(), holder = $('graphic-preview');
  if (!holder) return;
  holder.innerHTML = graphic?.svg ?? '<div class="empty-preview"><span aria-hidden="true">↗</span><h3>Build your lineup.</h3><p>Choose 2–4 prepared discs to see your graphic.</p></div>';
  holder.style.aspectRatio = graphic ? `${graphic.width} / ${graphic.height}` : '16 / 9';
  holder.className = `graphic-preview preview-${ui.background}`;
  if (graphic) {
    closeUp(holder, graphic);
    holder.setAttribute('role', 'img');
    const disc = rows.find(row => row.address === ui.selectedDisc);
    holder.setAttribute('aria-label', `${ui.mode === 'single' && disc ? `${disc.seed.manufacturer} ${rowName(disc)}` : 'Lineup'} graphic, ${studyName(ui.design.study) ?? 'custom'} layout, ${graphic.width} by ${graphic.height}`);
    holder.querySelector('svg')?.setAttribute('aria-hidden', 'true');
  }
  document.querySelectorAll('[data-preview-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.previewView === ui.view)));
  $('preview-dimensions').textContent = graphic ? `${graphic.width} × ${graphic.height}` : '1920 × 1080';
  $('preview-kind').textContent = graphic ? (capturedPreview?.capture.design.frame ?? ui.design.frame) === 'none' ? 'Transparent PNG' : 'Solid background' : 'Choose your lineup';
  const framing = graphic && ui.view === 'closeup' ? ` Close-up shows the graphic larger; your download is the full ${graphic.width} × ${graphic.height} frame.` : '';
  $('preview-note').textContent = (capturedPreview ? 'Kept version · your current design stays available.' : 'The background is preview only.') + framing;
  $('return-live').hidden = !capturedPreview;
  $('keep-graphic').hidden = Boolean(capturedPreview);
  $('download-png').disabled = hasConflict() || !graphic;
  $('keep-graphic').disabled = hasConflict() || !graphic;
  $('download-svg').disabled = hasConflict() || !graphic;
  const raster = graphic?.provenance?.rasterOnly === true;
  $('download-svg').textContent = raster ? 'SVG image' : 'SVG';
  $('download-svg').setAttribute('aria-label', raster ? 'Download SVG containing raster image' : 'Download editable SVG');
  if (raster) $('preview-note').textContent = capturedPreview ? 'Kept native card pixels. Your current design stays available.' : 'Native card pixels on a transparent canvas. The SVG contains this raster image.';
  document.querySelectorAll('[data-preview-background]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.previewBackground === ui.background)));
  $('preview-note').dataset.standardNote = $('preview-note').textContent;
  framePortraitPreview(graphic);
}

async function renderCurrent() {
  if (!rows.length) throw Error('No prepared discs are available in this fixture.');
  currentResult = ui.mode === 'single' ? await workspace.single(ui.selectedDisc, ui.design) : ui.selection.length >= 2 && ui.selection.length <= 4 ? await workspace.battle(ui.selection, ui.design) : null;
}

const focusKeys = ['disc', 'mode', 'study', 'placement', 'accent', 'previewView', 'previewBackground', 'capture'];
function focusToken() {
  const el = document.activeElement;
  if (!el || el === document.body || !root.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  for (const key of focusKeys) if (el.dataset?.[key] != null) return `[data-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${CSS.escape(el.dataset[key])}"]`;
  return null;
}

function paint() {
  const keepBar = root.querySelector('.export-bar'), refocus = focusToken();
  root.innerHTML = `<section class="workspace-heading"><div><span class="eyebrow">GOOD TO GO</span><h1>Your discs. Your next video.</h1></div><nav class="mode-nav" aria-label="Graphic type">${[['single', 'Single'], ['battle', 'Battle'], ['bag', 'Bag lineup']].map(([mode, label]) => `<button type="button" data-mode="${mode}" aria-pressed="${ui.mode === mode}">${label}</button>`).join('')}</nav></section><div class="studio-grid">${shelfMarkup()}<section class="preview-column" aria-labelledby="preview-title"><div class="preview-heading"><div><span class="eyebrow">YOUR GRAPHIC</span><h2 id="preview-title">${capturedPreview ? 'A kept version' : ui.mode === 'single' ? 'One disc. Ready for its moment.' : ui.mode === 'battle' ? 'Set the scene.' : 'Your selected lineup.'}</h2></div><button id="return-live" type="button" class="text-button" hidden>Back to current image</button></div><div class="preview-shell"><div class="preview-toolbar"><div class="view-switch" role="group" aria-label="Preview framing">${[['closeup', 'Close-up'], ['frame', 'Whole frame']].map(([v, label]) => `<button type="button" data-preview-view="${v}" aria-pressed="${ui.view === v}">${label}</button>`).join('')}</div><span id="preview-dimensions" class="preview-dimensions"></span><button id="preview-framing" type="button" class="preview-framing-toggle" aria-label="Toggle artwork detail and full canvas preview" hidden>Full canvas</button><div class="background-switch" aria-label="Preview background">${[['checker', 'Checkerboard'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => `<button type="button" data-preview-background="${v}" aria-label="${label} preview background" aria-pressed="${ui.background === v}" title="${label}"><span class="swatch swatch-${v}" aria-hidden="true"></span></button>`).join('')}</div></div><div id="graphic-preview" data-testid="graphic-preview" class="graphic-preview"></div><div class="preview-bottom"><span class="transparency-dot" aria-hidden="true"></span><strong id="preview-kind"></strong></div></div><p id="preview-note" class="preview-note"></p><div class="export-bar">${downloadedMarkup()}<div class="export-copy"><span class="eyebrow">STEP 3 · TAKE IT TO YOUR VIDEO</span><p>Download keeps this exact version.</p></div><div class="export-actions"><button id="keep-graphic" type="button" data-needs-ready class="button-secondary">Keep version</button><button id="download-png" type="button" data-needs-ready class="button-primary">Download PNG <span aria-hidden="true">↓</span></button><button id="download-svg" type="button" data-needs-ready class="svg-button" aria-label="Download editable SVG">SVG</button></div></div></section>${controlsMarkup()}</div>${capturesMarkup()}`;
  if (keepBar) { // the same buttons stay under the finger even if a save repaints mid-tap
    const fresh = root.querySelector('.export-bar');
    keepBar.querySelector('.downloaded')?.remove();
    const note = fresh.querySelector('.downloaded'); if (note) keepBar.prepend(note);
    fresh.replaceWith(keepBar);
  }
  paintPreview();
  bind();
  if (refocus) root.querySelector(refocus)?.focus({ preventScroll: true });
  paintCompositionThumbs();
  paintKeptThumbs();
  bindSwatches();
  sampleDiscColour();
  paintExportFailure();
  diagnostics();
}

function lastExportFailure() {
  const address = context().exports?.at(-1);
  if (!address) return null;
  const record = value(address);
  return record.status === 'Failed' ? record : null;
}

function failedCapture(record) {
  if (!record || !['png', 'svg'].includes(record.format)) return null;
  try {
    const capture = value(record.capture);
    return capture?.graphic?.svg ? { address: record.capture, capture } : null;
  } catch { return null; }
}

function paintExportFailure({ focus = false } = {}) {
  const bar = root.querySelector('.export-bar');
  if (!bar) return;
  schedulePortraitFrame();
  let notice = $('export-failure');
  if (!notice) {
    notice = document.createElement('section');
    notice.id = 'export-failure';
    notice.className = 'export-failure';
    notice.setAttribute('role', 'alert');
    notice.setAttribute('tabindex', '-1');
    notice.setAttribute('aria-labelledby', 'export-failure-title');
    bar.append(notice);
  }
  const record = lastExportFailure(), held = failedCapture(record);
  notice.hidden = !record;
  bar.classList.toggle('has-export-failure', Boolean(record));
  const currentHeld = capturedPreview ?? (currentResult ? workspace.existingCapture?.(currentResult) : null);
  const retryCurrentPng = record?.format === 'png' && held && currentHeld && held.address === currentHeld.address;
  $('download-png').innerHTML = `${retryCurrentPng ? 'Retry PNG' : 'Download PNG'} <span aria-hidden="true">&#8595;</span>`;
  if (!record) { notice.replaceChildren(); return; }
  const format = record.format === 'svg' ? 'SVG' : 'PNG';
  notice.innerHTML = `<div><strong id="export-failure-title">Last ${format} export failed</strong><p>${text(record.error || 'The image could not be converted.')} Your kept graphic is unchanged.</p></div>${held ? `<button id="retry-export" type="button" class="button-secondary">Retry ${format}</button>` : '<p>Open a kept graphic to choose another export.</p>'}`;
  if ($('retry-export')) {
    $('retry-export').disabled = busy || hasConflict();
    $('retry-export').onclick = () => run(() => download(record.format, held), { kind: 'retry-export', capture: held.address, format: record.format });
  }
  if (focus) {
    notice.focus({ preventScroll: true });
    notice.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
}

function readDesign() {
  const study = $('composition').value;
  if (isNativeStudy(study)) {
    return nativeControlDesign(ui.design, { study, scale: $('native-scale') ? Number($('native-scale').value) : undefined, side: $('native-side')?.value, highlight: $('native-highlight')?.value, accent: $('accent')?.value });
  }
  if (isNativeStudy(ui.design.study)) return { ...defaultDesign, ...context().legacyDesign, study };
  return { ...ui.design, study, placement: $('placement').value, compositionSize: $('composition-size').value, orientation: $('orientation').value, accent: $('accent').value, title: $('graphic-title').value, background: $('background').value, foreground: $('foreground').value, frame: $('frame').value, compositionOffsetX: Number($('offset-x').value), compositionOffsetY: Number($('offset-y').value) };
}

function change(patch, note = 'Saved. Your graphic is ready.') {
  capturedPreview = null;
  return run(async () => { await workspace.change(patch); ui.design = { ...defaultDesign, ...context().design }; await renderCurrent(); paint(); message(note); }, { kind: 'change', patch, ui });
}

async function keepCurrent(explicit = false) {
  if (capturedPreview) return capturedPreview;
  if (!currentResult) throw Error('Choose a disc or a 2–4-disc lineup first.');
  const key = resultKey(currentResult);
  if (!explicit && keptResults.has(key)) return keptResults.get(key);
  if (!explicit) {
    const existing = workspace.existingCapture(currentResult);
    if (existing) { keptResults.set(key, existing); return existing; }
  }
  const held = await workspace.keep(currentResult);
  const normalized = typeof held === 'string' ? { address: held, capture: value(held) } : held;
  if (!normalized?.address || !normalized?.capture?.graphic) throw Error('The saved graphic did not return its retained capture.');
  keptResults.set(key, normalized);
  return normalized;
}

async function download(format, retainedCapture = null) {
  const held = retainedCapture ?? await keepCurrent(), capture = held.capture;
  let record;
  try {
    const blob = format === 'png' ? await pngFromSvg(capture.graphic.svg, capture.graphic.width, capture.graphic.height) : new Blob([capture.graphic.svg], { type: 'image/svg+xml' });
    const hash = await sha256(blob), slug = capture.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'graphic';
    const filename = `thro-${slug}-${capture.graphic.width}x${capture.graphic.height}-${hash.slice(0, 8)}.${format}`;
    record = { status: 'Bytes ready', downloadRequested: false, capture: held.address, svgHash: capture.hash, format, width: capture.graphic.width, height: capture.graphic.height, byteLength: blob.size, hash, filename };
    await workspace.recordExport(record);
    downloadBlob(blob, filename);
    lastDownload = { kind: 'download', filename, format, width: capture.graphic.width, height: capture.graphic.height, transparent: (capture.design?.frame ?? 'none') === 'none', at: Date.now() };
    paint();
    clearNoticeLater();
    message(`${format.toUpperCase()} ready · ${capture.graphic.width} × ${capture.graphic.height}. Download requested.`);
  } catch (error) {
    if (!hasConflict() && !record) { try { await workspace.recordExport({ status: 'Failed', capture: held.address, svgHash: capture.hash, format, error: String(error) }); } catch { /* Preserve the original failure and any workspace conflict. */ } }
    refreshCaptures();
    paintExportFailure({ focus: true });
    throw error;
  }
}

function bindCaptureChoices() {
  document.querySelectorAll('[data-capture]').forEach(button => button.onclick = () => { capturedPreview = { address: button.dataset.capture, capture: value(button.dataset.capture) }; paint(); $('graphic-preview')?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('preview-title').focus?.(); });
}

function refreshCaptures() {
  const section = root.querySelector('.captures');
  if (!section) return;
  section.outerHTML = capturesMarkup();
  bindCaptureChoices();
  paintKeptThumbs();
}

function bind() {
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
    ui.mode = button.dataset.mode;
    if (ui.mode !== 'single' && ui.selection.length === 0) ui.selection = rows.slice(0, 2).map(row => row.address);
    const remembered = isNativeStudy(ui.design.study) || isNativeStudy(context().singleDesign?.study);
    change({ throMode: ui.mode, graphicsPurpose: ui.mode === 'single' ? 'spotlight' : 'competition', selection: [...ui.selection] }, remembered ? ui.mode === 'single' ? 'Saved. Your Single card treatment is restored.' : 'Saved. This lineup uses its own composition; your native Single treatment is kept.' : 'Saved. Your graphic is ready.');
  });
  document.querySelectorAll('[data-disc]').forEach(button => button.onclick = () => {
    const address = button.dataset.disc;
    if (ui.mode === 'single') { ui.selectedDisc = address; change({ selectedDisc: address }); }
    else {
      const selected = ui.selection.includes(address);
      if (!selected && ui.selection.length >= 4) { message('This graphic uses up to four exact copies. Remove one to choose another.'); return; }
      ui.selection = selected ? ui.selection.filter(item => item !== address) : [...ui.selection, address];
      change({ selection: [...ui.selection] });
    }
    button.classList.toggle('is-selected', ui.mode === 'single' || ui.selection.includes(address));
    button.setAttribute('aria-pressed', String(ui.mode === 'single' || ui.selection.includes(address)));
  });
  $('design-form').onsubmit = event => event.preventDefault();
  $('design-form').onchange = () => { ui.design = readDesign(); change({ design: structuredClone(ui.design) }); };
  $('preview-framing').onclick = () => { ui.view = $('graphic-preview').dataset.previewFraming === 'detail' ? 'frame' : 'closeup'; paintPreview(); };
  document.querySelectorAll('[data-preview-view]').forEach(button => button.onclick = () => { ui.view = button.dataset.previewView; rememberPreview(); paintPreview(); });
  document.querySelectorAll('[data-study]').forEach(button => button.onclick = () => {
    if ($('composition').value === button.dataset.study) return;
    $('composition').value = button.dataset.study;
    document.querySelectorAll('[data-study]').forEach(item => item.setAttribute('aria-checked', String(item === button)));
    ui.design = readDesign(); change({ design: structuredClone(ui.design) }, `${button.querySelector('.composition-name').textContent} applied. Your graphic is ready.`);
  });
  document.querySelectorAll('[data-placement]').forEach(button => button.onclick = () => {
    if ($('placement').value === button.dataset.placement) return;
    $('placement').value = button.dataset.placement;
    document.querySelectorAll('[data-placement]').forEach(item => item.setAttribute('aria-checked', String(item === button)));
    ui.design = readDesign(); change({ design: structuredClone(ui.design) }, `Moved to ${button.getAttribute('aria-label').toLowerCase()}. Your graphic is ready.`);
  });
  if ($('native-scale')) $('native-scale').oninput = event => { $('native-scale-value').textContent = `${Math.round(Number(event.target.value) * 100)}%`; };
  document.querySelectorAll('[data-preview-background]').forEach(button => button.onclick = () => { ui.background = button.dataset.previewBackground; rememberPreview(); paintPreview(); });
  $('keep-graphic').onclick = () => run(async () => {
    const existing = capturedPreview ? null : currentResult ? workspace.existingCapture(currentResult) : null; // keeping the same graphic twice adds nothing
    if (!existing) await keepCurrent(true);
    lastDownload = { kind: 'keep', already: Boolean(existing), at: Date.now() };
    paint(); clearNoticeLater();
    message(existing ? 'Already kept. That exact version is in Kept graphics.' : 'Kept. This exact version is in Kept graphics, even after reload.');
  }, { kind: 'keep', ui });
  $('download-png').onclick = () => run(() => download('png'), { kind: 'download', format: 'png', ui });
  $('download-svg').onclick = () => run(() => download('svg'), { kind: 'download', format: 'svg', ui });
  $('return-live').onclick = () => { capturedPreview = null; paint(); };
  bindCaptureChoices();
  const edit = data => run(async () => { capturedPreview = null; await workspace.editBattle(data); await renderCurrent(); paint(); message('Saved. This image has your updated turn and points.'); }, { kind: 'battle-edit', edit: data, ui });
  if ($('battle-turn')) $('battle-turn').onchange = event => edit({ kind: 'turn', id: event.target.value || null });
  document.querySelector('[data-battle-equal]')?.addEventListener('click', () => edit({ kind: 'equal' }));
  document.querySelectorAll('[data-points]').forEach(input => input.onchange = () => edit({ kind: 'points', id: input.dataset.points, points: input.value === '' ? NaN : Number(input.value) }));
  document.querySelectorAll('[data-entry-size],[data-entry-color]').forEach(input => input.onchange = () => {
    const id = input.dataset.entrySize ?? input.dataset.entryColor;
    edit({ kind: 'style', id, style: { scale: Number(document.querySelector(`[data-entry-size="${id}"]`).value), accent: document.querySelector(`[data-entry-color="${id}"]`).value } });
  });
  if ($('bag-name')) $('bag-name').oninput = event => { ui.bagName = event.target.value; };
  if ($('save-bag')) $('save-bag').onclick = () => run(async () => {
    if (!ui.bagName.trim()) throw Error('Give this bag a name first.');
    await workspace.createBag(ui.bagName, [...ui.selection]); paint(); message(`Saved “${ui.bagName.trim()}” with its exact copies and order.`);
  }, { kind: 'create-bag', name: ui.bagName, selection: [...ui.selection], ui });
  if ($('saved-bag')) $('saved-bag').onchange = event => {
    if (!event.target.value) return;
    const bag = value(event.target.value); ui.bagName = bag.name; ui.selection = bag.versions.map(item => item.address);
    change({ name: ui.bagName, selection: [...ui.selection] }, `Opened “${bag.name}”. Its saved version is preserved.`);
  };
}

$('download-draft').onclick = () => {
  const draft = { schema: 'thro-pending-draft@1', pending: workspace?.draft ?? null, recovery: recoveredDraft, conflict: workspace?.conflict ?? null, attempted: failedIntent, controls: ui };
  downloadBlob(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }), 'thro-pending-draft.json');
  message('Pending draft download requested. The latest saved workspace is unchanged.');
};
$('reload-latest').onclick = () => {
  queue = queue.then(async () => {
    setBusy(true);
    try {
      const previous = { draft: workspace.draft, attempted: failedIntent, controls: structuredClone(ui) };
      const loaded = await workspace.reload();
      workspace = loaded.workspace;
      recoveredDraft = { ...previous, recovery: loaded.recovery ?? null };
      rows = await workspace.model.shelfForDisplay(); adoptContext(); capturedPreview = null; currentResult = null; failedIntent = null; keptResults.clear();
      await renderCurrent(); paint();
      $('conflict').hidden = false; $('conflict').classList.add('is-recovered'); document.body.classList.remove('has-conflict');
      $('conflict-title').textContent = 'Latest saved workspace loaded. Your previous draft is retained.';
      $('conflict-copy').textContent = 'You can continue with the saved workspace. The previous pending draft remains available as a JSON download; it has not been merged or applied.';
      $('reload-latest').hidden = true; message('Latest saved workspace loaded.');
    } catch (error) { message(error.message || String(error), true); showConflict(error); }
    finally { setBusy(false); diagnostics(); }
  });
};

try {
  const fixture = await loadFixture();
  workspace = await openWorkspace({ storage: localStorage, locks: navigator.locks, fixture });
  rows = await workspace.model.shelfForDisplay(); adoptContext();
  window.__throStarted?.();
  await renderCurrent(); paint(); setBusy(false); message('Ready. Choose your graphic, then take it to your video.');
  if (debug) {
    window.throQA = Object.freeze({ get workspace() { return workspace; }, get result() { return currentResult; }, get controls() { return structuredClone(ui); }, get busy() { return busy; }, settled: () => queue, inspect: () => workspace.model.inspect() });
    try { const response = await fetch('./BUILD_INFO.json'); if (response.ok) buildInfo = await response.json(); } catch { /* A development build may have no build receipt. */ }
    diagnostics();
  }
} catch (error) {
  window.__throStarted?.(); // the app shows its own startup error; the index.html watchdog stands down
  root.setAttribute('aria-busy', 'false');
  root.innerHTML = '<section class="opening startup-error"><h1>Your workspace could not open.</h1><p>Your existing saved data has been preserved. Reload to try again.</p><button type="button" id="retry-open" class="button-primary">Reload workspace</button></section>';
  $('retry-open').onclick = () => location.reload(); message(error.message || String(error), true);
  if (debug) { $('diagnostics').hidden = false; $('diagnostic-values').textContent = error.stack || String(error); }
}
