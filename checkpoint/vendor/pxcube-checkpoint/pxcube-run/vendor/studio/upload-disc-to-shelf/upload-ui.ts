import { initialDraft, flightFields, type Draft, type Depiction, type createExperience } from './model.ts';
import { plasticGuides } from './plastics.ts';
import { createDiscView } from './disc-view.ts';
import { recipeFromDraft, validatePaintRecipe, renderDepiction } from './paint-recipe.ts';
import { fuzzyMoldOptions } from './mold-search.ts';

export type PhotoCrop = { centerX: number; centerY: number; radiusX: number; radiusY: number };

export const cropZoomNudges = [-10, -5, -3, -1, 1, 3, 5, 10] as const;
const minCropRadiusRatio = .03;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function validDimensions(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw Error('Photo dimensions must be positive.');
}

/** Selection center and ellipse radii are normalized independently to source width/height. */
export function clampCropSelection(width: number, height: number, crop: PhotoCrop): PhotoCrop {
  validDimensions(width, height);
  const minimum = minCropRadiusRatio;
  const radiusX = clamp(Number.isFinite(crop.radiusX) ? crop.radiusX : .4, minimum, .5);
  const radiusY = clamp(Number.isFinite(crop.radiusY) ? crop.radiusY : .4, minimum, .5);
  const centerX = clamp(Number.isFinite(crop.centerX) ? crop.centerX : .5, radiusX, 1 - radiusX);
  const centerY = clamp(Number.isFinite(crop.centerY) ? crop.centerY : .5, radiusY, 1 - radiusY);
  return { centerX, centerY, radiusX, radiusY };
}

export function cropForDetectedCircle(width: number, height: number, circle: DiscCircle): PhotoCrop {
  return clampCropSelection(width, height, { centerX: circle.x / width, centerY: circle.y / height, radiusX: circle.radius / width, radiusY: circle.radius / height });
}

export function resizeCrop(width: number, height: number, crop: PhotoCrop, deltaPercent: number): PhotoCrop {
  if (!cropZoomNudges.includes(deltaPercent as typeof cropZoomNudges[number])) throw Error('Unsupported crop selection nudge.');
  const bounded = clampCropSelection(width, height, crop);
  const radiusDelta = deltaPercent / 200;
  return clampCropSelection(width, height, { ...bounded, radiusX: bounded.radiusX + radiusDelta, radiusY: bounded.radiusY + radiusDelta });
}

export function sourceImagePlacement(width: number, height: number, size: number) {
  validDimensions(width, height);
  if (!Number.isFinite(size) || size <= 0) throw Error('Preview size must be positive.');
  const scale = Math.min(size / width, size / height);
  return { x: (size - width * scale) / 2, y: (size - height * scale) / 2, width: width * scale, height: height * scale, scale };
}

export function cropExportMapping(width: number, height: number, size: number, crop: PhotoCrop) {
  validDimensions(width, height);
  if (!Number.isFinite(size) || size <= 0) throw Error('Output size must be positive.');
  const selection = clampCropSelection(width, height, crop), radiusX = selection.radiusX * width, radiusY = selection.radiusY * height;
  const centerX = selection.centerX * width, centerY = selection.centerY * height;
  return { sourceX: centerX - radiusX, sourceY: centerY - radiusY, sourceWidth: radiusX * 2, sourceHeight: radiusY * 2, outputSize: size, selection };
}

export type DiscCircle = { x: number; y: number; radius: number; confidence: number };

// A deliberately small, deterministic edge-ring search. It runs once against a
// downsampled working image; it is a helpful first guess, not a recognition claim.
export function detectDiscCircle(data: Uint8ClampedArray, width: number, height: number): DiscCircle | null {
  if (width < 32 || height < 32 || data.length < width * height * 4) return null;
  const sample = (x: number, y: number) => {
    const i = (Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const distance = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const shortest = Math.min(width, height), minRadius = Math.max(12, Math.floor(shortest * .18)), maxRadius = Math.floor(shortest * .48);
  let best: DiscCircle | null = null;
  for (let radius = minRadius; radius <= maxRadius; radius += 4) {
    const step = Math.max(3, Math.floor(radius / 8));
    for (let y = radius; y <= height - radius; y += step) for (let x = radius; x <= width - radius; x += step) {
      let score = 0;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 18) {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        score += distance(sample(x + dx * (radius - 2), y + dy * (radius - 2)), sample(x + dx * (radius + 2), y + dy * (radius + 2)));
      }
      score = score / 36 * (1 + radius / shortest);
      if (!best || score > best.confidence) best = { x, y, radius, confidence: score };
    }
  }
  return best && best.confidence >= 18 ? best : null;
}

// No store, persistence, sibling view or app boot is created by importing this module.
export async function mountUpload({ root, experience, onSaved = (_address: string) => {}, random = Math.random }: {
  root: ParentNode; experience: ReturnType<typeof createExperience>; onSaved?: (address: string) => void; random?: () => number;
}) {
const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
const input = (id: string) => $(id) as HTMLInputElement;
const discView = createDiscView(experience);
let depiction: Depiction = await experience.selectPainting(random);
let painting = depiction, photo: Depiction | null = null;
function resetPaintSeed() { input('paint-seed').value = String(recipeFromDraft(initialDraft(), painting).seed); }
function recipe(material: Draft) {
  if (!input('paint-seed').value.trim()) throw Error('Enter a painting seed.');
  const selected = experience.seedAt(material.mold);
  const label = input('customize-label').checked ? (input('paint-label').value.trim() || `${selected.manufacturer} · ${selected.name}`) : null;
  return validatePaintRecipe({ ...recipeFromDraft(material, painting), seed: Number(input('paint-seed').value), label });
}
let photoBusy = false;
const defaults = initialDraft();
type SeedOption = ReturnType<typeof experience.seedOptions>[number];
const seedLabel = ({ seed }: SeedOption) => `${seed.manufacturer} · ${seed.name}`;
let availableSeeds: SeedOption[] = [], visibleSeeds: SeedOption[] = [], activeSeed = -1;
let selectionSerial = 0, autoNickname = '', nicknameDirty = false;
function eligibleSeeds() { return experience.seedOptions(); }
function closeSeedChoices() {
  $('mold-options').hidden = true; input('mold-search').setAttribute('aria-expanded', 'false'); input('mold-search').removeAttribute('aria-activedescendant'); activeSeed = -1;
}
function ensureAvailableSeeds() {
  if (!availableSeeds.length) availableSeeds = eligibleSeeds();
  return availableSeeds;
}
function renderSeedChoices(query = input('mold-search').value) {
  visibleSeeds = fuzzyMoldOptions(ensureAvailableSeeds(), query, seedLabel);
  $('mold-options').replaceChildren(...visibleSeeds.map((row, index) => {
    const option = document.createElement('div'); option.id = `mold-option-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = seedLabel(row);
    option.addEventListener('pointerdown', event => { event.preventDefault(); chooseSeed(row); }); return option;
  }));
  $('mold-options').hidden = visibleSeeds.length === 0; input('mold-search').setAttribute('aria-expanded', String(visibleSeeds.length > 0)); activeSeed = -1;
}
async function chooseSeed(row: SeedOption) {
  const token = ++selectionSerial;
  const currentNickname = input('nickname').value.trim();
  if (!nicknameDirty && (!currentNickname || currentNickname === autoNickname)) { input('nickname').value = row.seed.name; autoNickname = row.seed.name; nicknameDirty = false; }
  input('seed').value = row.address; input('mold-search').value = seedLabel(row); closeSeedChoices(); suggestPlastics();
  const nextPainting = await experience.selectPainting(random);
  if (token !== selectionSerial) return;
  painting = nextPainting; depiction = nextPainting; resetPaintSeed(); preview();
}
// Start with an honest empty composer. The mold input is the first decision;
// no catalog item or plastic should be implied before the user chooses one.
input('mold-search').value = '';
input('seed').value = '';
const overrides = document.createElement('details');
overrides.innerHTML = '<summary>Edit flight numbers (this disc only)</summary><p>Unchecked fields inherit from the mold. Check to specialize; checked + blank means unknown.</p>' + flightFields.map(field => `<label><span><input id="own-${field}" type="checkbox"> Own ${field}</span><input id="disc-${field}" aria-label="Disc ${field}" type="number" step="any" disabled></label>`).join('');
$('flight').after(overrides);
for (const field of flightFields) input(`own-${field}`).addEventListener('change', () => { input(`disc-${field}`).disabled = !input(`own-${field}`).checked; });
function draft(): Draft { return { mold: input('seed').value, nickname: input('nickname').value.trim(), plastic: input('plastic').value.trim(), weight: input('weight').value === '' ? null : Number(input('weight').value), Color1: input('Color1').value, Color2: input('Color2').value, paintMode: input('paint-mode').value as Draft['paintMode'], colorPainting: input('color-painting').checked,
  ...Object.fromEntries(flightFields.filter(field => input(`own-${field}`).checked).map(field => [field, input(`disc-${field}`).value === '' ? null : Number(input(`disc-${field}`).value)])) }; }
function preview() {
 try {
  syncDepictionControls();
  const material = draft();
  if (!material.mold) {
   $('flight').textContent = '';
   $('depiction-name').textContent = '';
   $('preview').replaceChildren();
   input('plastic').disabled = true;
   input('photo').disabled = true;
   input('save').disabled = true;
   return;
  }
  const resolved = experience.resolve(material);
  input('photo').disabled = false;
  $('flight').textContent = `FLIGHT  ${flightFields.map(field => resolved[field] ?? '?').join(' / ')}`;
  for (const field of flightFields) input(`disc-${field}`).placeholder = String(experience.seedAt(material.mold)[field] ?? 'Unknown');
  $('depiction-name').textContent = depiction.name.replaceAll('-', ' ');
  input('color-painting').disabled = depiction.kind === 'photo';
  $('paint-help').textContent = depiction.kind === 'photo' ? 'Photos stay untouched; mode changes the backing only.' : '50/50 swaps palettes across the disc. Halo blends center into rim.';
  const customizeLabel = input('customize-label').checked;
  $('paint-label-controls').hidden = !customizeLabel; input('customize-label').setAttribute('aria-expanded', String(customizeLabel));
  (input('depiction-choice') as unknown as HTMLSelectElement).querySelector<HTMLOptionElement>('option[value="photo"]')!.disabled = !photo;
  input('depiction-choice').value = depiction.kind;
  const art = renderDepiction({ recipe: recipe(material), photo, choice: depiction.kind, seed: experience.seedAt(material.mold) });
  const view=discView(material, depiction, art); $('preview').replaceChildren(view); applyFinishPreview();
 } catch (error) { $('status').textContent = String(error); }
}
$('composer').addEventListener('input', event => { const id=(event.target as HTMLElement).id; if (event.target !== $('depiction-choice') && !finishIds.includes(id)) preview(); });
function suggestPlastics() {
  if (!input('seed').value) {
   input('plastic').replaceChildren(new Option('Choose a mold first', ''));
   input('plastic').value = '';
   input('plastic').disabled = true;
   input('save').disabled = true;
   ($('plastic-source') as HTMLAnchorElement).hidden = true;
   return;
  }
  const seed = experience.seedAt(input('seed').value);
  const guide = plasticGuides[seed.manufacturer] ?? { values: [], source: '' };
  const preferred = input('plastic').value;
  const unavailable = guide.values.length === 0;
  input('plastic').replaceChildren(...['', ...guide.values].map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || (unavailable ? `Plastics not loaded for ${seed.manufacturer}` : 'Choose plastic'); return option; }));
  input('plastic').value = guide.values.includes(preferred) ? preferred : '';
  input('plastic').disabled = unavailable;
  updateSaveState();
  const link = $('plastic-source') as HTMLAnchorElement; link.href = guide.source; link.textContent = `${seed.manufacturer} plastic guide`; link.hidden = !guide.source;
}
function updateSaveState() {
 input('save').disabled = photoBusy || input('plastic').disabled || !input('seed').value || !input('plastic').value;
}
['change', 'input'].forEach(event => input('plastic').addEventListener(event, updateSaveState));
input('nickname').addEventListener('input', () => { nicknameDirty = input('nickname').value !== autoNickname; });
input('mold-search').addEventListener('focus', () => renderSeedChoices(''));
input('mold-search').addEventListener('input', () => {
  selectionSerial++;
  input('seed').value = '';
  // Typing is exploratory even when it happens to equal a catalog label;
  // commitment only occurs through an option click or keyboard Enter.
  suggestPlastics(); renderSeedChoices(); preview();
});
input('mold-search').addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeSeedChoices(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  if (!visibleSeeds.length) return;
  if (event.key === 'Enter' && activeSeed < 0 && visibleSeeds.length === 1) activeSeed = 0;
  else if (event.key === 'ArrowDown') activeSeed = (activeSeed + 1) % visibleSeeds.length;
  else if (event.key === 'ArrowUp') activeSeed = (activeSeed - 1 + visibleSeeds.length) % visibleSeeds.length;
  if (event.key === 'Enter' && activeSeed >= 0) { event.preventDefault(); chooseSeed(visibleSeeds[activeSeed]); return; }
  if (activeSeed >= 0) {
    event.preventDefault(); root.querySelectorAll<HTMLElement>('#mold-options [role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSeed)));
    input('mold-search').setAttribute('aria-activedescendant', `mold-option-${activeSeed}`);
  }
});
input('mold-search').addEventListener('blur', () => { setTimeout(() => { if (!input('seed').value) $('status').textContent = 'Choose a mold from the suggestions.'; closeSeedChoices(); }); });
$('shuffle').addEventListener('click', async () => { painting = await experience.selectPainting(random); depiction = painting; resetPaintSeed(); preview(); });
$('depiction-choice').addEventListener('change', () => { depiction = input('depiction-choice').value === 'photo' && photo ? photo : painting; preview(); });
const finishIds = ['rim-size', 'underglow', 'stamp-x', 'stamp-y'];
const paintingControls = [...root.querySelectorAll<HTMLElement>('.painting-only')];
function syncDepictionControls() {
  const photoMode = depiction.kind === 'photo';
  root.classList.toggle('photo-mode', photoMode);
  paintingControls.forEach(control => { control.hidden = photoMode; });
  if (photoMode) {
    input('customize-label').checked = false;
    input('customize-label').setAttribute('aria-expanded', 'false');
    $('paint-label-controls').hidden = true;
  }
}
function applyFinishPreview() {
  const view = $('preview').querySelector<HTMLElement>('figure'); if (!view) return;
  const glow = Number(input('underglow').value), painted = depiction.kind !== 'photo';
  view.classList.add('experimental-preview');
  view.style.setProperty('--exp-rim', `${painted ? Number(input('rim-size').value) : 0}px`);
  view.style.setProperty('--exp-glow-blur', `${Math.round(glow * 34)}px`);
  view.style.setProperty('--exp-glow-spread', `${Math.round(glow * 8)}px`);
  view.style.setProperty('--exp-glow-color', `rgba(230,182,110,${(.25 + glow * .65).toFixed(2)})`);
  view.style.setProperty('--exp-x', `${painted ? Number(input('stamp-x').value) * 8 : 0}%`);
  view.style.setProperty('--exp-y', `${painted ? Number(input('stamp-y').value) * 8 : 0}%`);
}
for (const id of finishIds) input(id).addEventListener('input', applyFinishPreview);
let cropBitmap: ImageBitmap | null = null; let cropFile: File | null = null; let cropWorking: HTMLCanvasElement | null = null;
const cropIds = ['crop-center-x', 'crop-center-y', 'crop-radius-x', 'crop-radius-y'];
function cropState(): PhotoCrop { return { centerX: Number(input('crop-center-x').value), centerY: Number(input('crop-center-y').value), radiusX: Number(input('crop-radius-x').value), radiusY: Number(input('crop-radius-y').value) }; }
function setCrop(next: PhotoCrop) {
  if (!cropWorking) return;
  const crop = clampCropSelection(cropWorking.width, cropWorking.height, next);
  input('crop-center-x').value = String(crop.centerX); input('crop-center-y').value = String(crop.centerY);
  input('crop-radius-x').value = String(crop.radiusX); input('crop-radius-y').value = String(crop.radiusY);
  input('crop-scale-x').value = String(crop.radiusX * 2); input('crop-scale-y').value = String(crop.radiusY * 2);
  scheduleCropPreview();
}
function circleLockedCrop(width: number, height: number, ratio = .4): PhotoCrop {
  const radius = Math.min(width, height) * ratio;
  return { centerX:.5, centerY:.5, radiusX:radius / width, radiusY:radius / height };
}
function resetCrop() { if (cropWorking) setCrop(circleLockedCrop(cropWorking.width, cropWorking.height)); }
function updateCropPreview() {
  if (!cropWorking) return;
  const canvas = $('crop-preview') as HTMLCanvasElement, ctx = canvas.getContext('2d')!, crop = cropState();
  const placement = sourceImagePlacement(cropWorking.width, cropWorking.height, canvas.width);
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#dfe5db'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cropWorking, placement.x, placement.y, placement.width, placement.height);
  const centerX = placement.x + crop.centerX * placement.width, centerY = placement.y + crop.centerY * placement.height;
  const radiusX = crop.radiusX * cropWorking.width * placement.scale, radiusY = crop.radiusY * cropWorking.height * placement.scale;
  // One selection boundary only: everything it contains is kept; the
  // semitransparent exterior is what will be trimmed. The border is painted
  // into the same source-space canvas, so it stays honest as the stage grows.
  ctx.save(); ctx.fillStyle = 'rgba(18,39,31,.68)'; ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.beginPath(); ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.96)'; ctx.lineWidth = Math.max(2, canvas.width / 260); ctx.stroke(); ctx.restore();
  ($('crop-zoom-value') as HTMLOutputElement).value = `${Math.round(crop.radiusX * 200)}% × ${Math.round(crop.radiusY * 200)}% selection`;
}
let cropFrame = 0;
function scheduleCropPreview() { if (cropFrame) return; cropFrame = requestAnimationFrame(() => { cropFrame = 0; updateCropPreview(); }); }
type CropDrag = { mode:'move'|'resize'; x:number; y:number; crop:PhotoCrop };
let cropDrag:CropDrag|null=null;
const cropStage=$('crop-stage');
function stagePoint(event: PointerEvent) { const rect = cropStage.getBoundingClientRect(); return { x:event.clientX - rect.left, y:event.clientY - rect.top }; }
function stageSelection(crop: PhotoCrop) {
  if (!cropWorking) return null;
  const placement = sourceImagePlacement(cropWorking.width, cropWorking.height, cropStage.clientWidth), centerX = placement.x + crop.centerX * placement.width, centerY = placement.y + crop.centerY * placement.height;
  return { placement, centerX, centerY, radiusX: crop.radiusX * cropWorking.width * placement.scale, radiusY: crop.radiusY * cropWorking.height * placement.scale };
}
cropStage.addEventListener('pointerdown',event=>{
  if (!cropWorking) return;
  const crop = cropState(), view = stageSelection(crop); if (!view) return;
  const point = stagePoint(event), normalized = Math.hypot((point.x - view.centerX) / view.radiusX, (point.y - view.centerY) / view.radiusY), edge = Math.max(10 / Math.max(1, view.radiusX), .08);
  if (Math.abs(normalized - 1) <= edge) cropDrag={mode:'resize',x:event.clientX,y:event.clientY,crop};
  else if (normalized < 1) cropDrag={mode:'move',x:event.clientX,y:event.clientY,crop};
  else return;
  cropStage.setPointerCapture(event.pointerId); event.preventDefault();
});
cropStage.addEventListener('pointermove',event=>{
  if (!cropDrag || !cropWorking) return;
  const view = stageSelection(cropDrag.crop), point = stagePoint(event); if (!view) return;
  if (cropDrag.mode === 'move') {
    const dx = (event.clientX - cropDrag.x) / view.placement.scale, dy = (event.clientY - cropDrag.y) / view.placement.scale;
    setCrop({ ...cropDrag.crop, centerX:cropDrag.crop.centerX + dx / cropWorking.width, centerY:cropDrag.crop.centerY + dy / cropWorking.height });
  } else {
    const sourceX = (point.x - view.placement.x) / view.placement.scale, sourceY = (point.y - view.placement.y) / view.placement.scale;
    const factor = Math.max(Math.abs(sourceX - cropDrag.crop.centerX * cropWorking.width) / (cropDrag.crop.radiusX * cropWorking.width), Math.abs(sourceY - cropDrag.crop.centerY * cropWorking.height) / (cropDrag.crop.radiusY * cropWorking.height));
    setCrop({ ...cropDrag.crop, radiusX:cropDrag.crop.radiusX * factor, radiusY:cropDrag.crop.radiusY * factor });
  }
});
for (const eventName of ['pointerup','pointercancel']) cropStage.addEventListener(eventName,()=>{cropDrag=null;});
function stepZoom(deltaPercent:number){ if (cropWorking) setCrop(resizeCrop(cropWorking.width, cropWorking.height, cropState(), deltaPercent)); }
cropStage.addEventListener('wheel',event=>{event.preventDefault();stepZoom(event.deltaY<0?10:-10);},{passive:false});
for (const button of root.querySelectorAll<HTMLButtonElement>('[data-zoom-delta]')) button.addEventListener('click',()=>stepZoom(Number(button.dataset.zoomDelta)));
function autoFitCrop() {
  if (!cropWorking) return resetCrop();
  const context = cropWorking.getContext('2d', { willReadFrequently:true })!, circle = detectDiscCircle(context.getImageData(0,0,cropWorking.width,cropWorking.height).data,cropWorking.width,cropWorking.height);
  setCrop(circle ? cropForDetectedCircle(cropWorking.width,cropWorking.height,circle) : circleLockedCrop(cropWorking.width,cropWorking.height));
  $('photo-crop-help').textContent = circle ? 'Auto-fit found the likely edge. Drag inside the aperture to move it; drag its edge to resize.' : 'We centered the photo. Drag inside the aperture to move it; drag its edge to resize.';
}
$('crop-auto').addEventListener('click', autoFitCrop);
function discardPendingPhoto() {
  if (cropBitmap) cropBitmap.close(); cropBitmap = null; cropFile = null; cropWorking = null; input('photo').value = '';
}
$('photo').addEventListener('change', async () => {
  const file = input('photo').files?.[0]; if (!file) return;
  photoBusy = true; input('save').disabled = true; input('shuffle').disabled = true;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15_000_000) throw new Error('Choose a JPEG, PNG or WebP image under 15 MB. HEIC is not supported by this browser.');
    discardPendingPhoto(); cropFile = file; cropBitmap = await createImageBitmap(file);
    const workingScale = Math.min(1, 720 / Math.max(cropBitmap.width, cropBitmap.height)); cropWorking = document.createElement('canvas'); cropWorking.width = Math.max(1, Math.round(cropBitmap.width * workingScale)); cropWorking.height = Math.max(1, Math.round(cropBitmap.height * workingScale)); cropWorking.getContext('2d')!.drawImage(cropBitmap,0,0,cropWorking.width,cropWorking.height);
    resetCrop(); autoFitCrop(); ($('photo-crop') as HTMLDialogElement).showModal(); $('crop-auto').focus();
  } catch (error) { discardPendingPhoto(); $('status').textContent = String(error); }
  finally { photoBusy = false; updateSaveState(); input('shuffle').disabled = false; }
});
$('crop-cancel').addEventListener('click', () => { ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); $('status').textContent = photo ? 'Photo crop cancelled. Your prepared photo is unchanged.' : 'Photo crop cancelled. Your painting is unchanged.'; });
$('photo-crop').addEventListener('cancel', event => { event.preventDefault(); $('crop-cancel').click(); });
for (const id of cropIds) input(id).addEventListener('input', scheduleCropPreview);
for (const id of ['crop-scale-x', 'crop-scale-y']) { input(id).min = '.06'; input(id).max = '1'; input(id).step = '.01'; }
input('crop-scale-x').addEventListener('input', () => { if (cropWorking) setCrop({ ...cropState(), radiusX: Number(input('crop-scale-x').value) / 2 }); });
input('crop-scale-y').addEventListener('input', () => { if (cropWorking) setCrop({ ...cropState(), radiusY: Number(input('crop-scale-y').value) / 2 }); });
$('crop-reset').addEventListener('click', resetCrop);
$('crop-apply').addEventListener('click', () => {
  if (!cropBitmap || !cropFile) return;
  const bitmap = cropBitmap, fileName = cropFile.name, size = Math.min(1024, Math.max(256, Math.min(bitmap.width, bitmap.height)));
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!, mapping = cropExportMapping(bitmap.width, bitmap.height, size, cropState());
  ctx.save(); ctx.beginPath(); ctx.ellipse(size / 2, size / 2, size / 2, size / 2, 0, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(bitmap, mapping.sourceX, mapping.sourceY, mapping.sourceWidth, mapping.sourceHeight, 0, 0, size, size); ctx.restore();
  photo = { kind: 'photo', name: fileName, src: canvas.toDataURL('image/webp', .86) }; depiction = photo;
  ($('photo-crop') as HTMLDialogElement).close(); discardPendingPhoto(); $('status').textContent = 'Photo cropped locally. The original file is unchanged.'; preview(); updateSaveState();
});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if (photoBusy || input('save').disabled) return;
  input('save').disabled = true;
  try {
    const material = draft();
    const address = await experience.save(material, depiction, { recipe: recipe(material), photo });
    onSaved(address); $('status').textContent = `Saved and read back: ${address}. Add another when you’re ready.`;
    input('nickname').value = ''; autoNickname = ''; nicknameDirty = false; input('photo').value = '';
    for (const field of flightFields) { input(`own-${field}`).checked = false; input(`disc-${field}`).value = ''; input(`disc-${field}`).disabled = true; }
    painting = await experience.selectPainting(random); depiction = painting; photo = null;
    input('customize-label').checked = false; input('paint-label').value = ''; resetPaintSeed(); preview();
  } catch (error) { $('status').textContent = `Not saved: ${String(error)}`; }
  finally { updateSaveState(); }
});
input('Color1').value = defaults.Color1; input('Color2').value = defaults.Color2; resetPaintSeed(); suggestPlastics(); preview();
return { refresh: preview };
}
