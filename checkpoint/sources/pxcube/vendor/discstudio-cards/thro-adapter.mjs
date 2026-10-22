// DiscStudio 6.6.1 card renderer, packaged for thro (build 28ac2b39fab85255).
// One call turns a thro disc into thro's own graphic contract: { svg, width, height }.
// The SVG wraps the exact PNG the DiscStudio export panel makes, so thro's existing
// pngFromSvg export path reproduces those pixels unchanged. Nothing in thro changes.
import { renderCardBlob, renderPlacedCardBlob, CARD_SIZE } from './browser-card-renderer.js?v=28ac2b39fab85255';
import { defaultCardAppearance, validateCardAppearance } from './export-queue-core.js?v=28ac2b39fab85255';
import { anchoredDefaultPlacement } from './transform-geometry.mjs?v=28ac2b39fab85255';

export const build = '28ac2b39fab85255';
export const version = '6.6.1';
export const DEFAULT_CARD_SCALE = 0.66; // what the DiscStudio export panel uses for an untouched card
export const presets = Object.freeze([
  { id: 'u01', orientation: 'vertical', name: 'U01 · Compact scorebug' }, { id: 'u02', orientation: 'vertical', name: 'U02 · Stacked poster' },
  { id: 'u03-front', orientation: 'vertical', name: 'U03 · Disc in front' }, { id: 'u03-behind', orientation: 'vertical', name: 'U03 · Disc behind' },
  { id: 'u04', orientation: 'vertical', name: 'U04 · Kinetic name' }, { id: 'u05', orientation: 'vertical', name: 'U05 · Glass drawer' },
  { id: 'b01', orientation: 'horizontal', name: 'B01 · Hero rail' }, { id: 'b02', orientation: 'horizontal', name: 'B02 · Split nameplate' },
  { id: 'b03', orientation: 'horizontal', name: 'B03 · Framed hero' }, { id: 'b04', orientation: 'horizontal', name: 'B04 · Peak mark' },
  { id: 'b05', orientation: 'horizontal', name: 'B05 · Stamp macro' },
]);
const presetById = id => { const p = presets.find(item => item.id === id); if (!p) throw Error(`Unknown DiscStudio card layout "${id}".`); return p; };

function flightNumber(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw Error('Invalid flight number.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw Error('Invalid flight number.');
  return number;
}

/** Map a thro disc (prepared fixture or shelf record) onto DiscStudio's card input.
 *  photoSrc: the disc's prepared photo URL (thro: fixture `file`, or the shelf's depiction src).
 *  flights: [speed, glide, turn, fade] when thro already resolved them; otherwise DiscStudio
 *  looks the mold up in its own catalog by `disc.mold` (e.g. "mvp--servo").
 *  Null, undefined and blank flights remain unknown; invalid known values reject. */
export function cardFromThroDisc(disc, { photoSrc, flights } = {}) {
  if (!disc?.mold && !flights) throw Error('A thro disc needs a mold id or explicit flight numbers.');
  const src = photoSrc ?? disc.depiction?.src ?? disc.file;
  if (!src) throw Error('A thro disc needs a prepared photo.');
  const mold = typeof disc.mold === 'string' && disc.mold.startsWith('ds.px.seed.') ? disc.mold : `ds.px.seed.${disc.mold}`;
  const card = { id: disc.id ?? disc.mold, mold, plastic: disc.plastic ?? null, weight: disc.weight ?? null, depiction: { kind: 'photo', src } };
  if (flights) card.renderer = { moldName: disc.name, manufacturer: disc.manufacturer, flights: flights.map(flightNumber) };
  else if (disc.name || disc.manufacturer) card.renderer = { moldName: disc.name, manufacturer: disc.manufacturer };
  return card;
}

async function alphaBounds(blob) {
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, b = [bitmap.width, bitmap.height, 0, 0];
  for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) if (d[(y * bitmap.width + x) * 4 + 3]) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x + 1 > b[2]) b[2] = x + 1; if (y + 1 > b[3]) b[3] = y + 1; }
  return { bounds: b, width: bitmap.width, height: bitmap.height };
}
const toDataUrl = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });

function validatePanelScale(scale) {
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 1.5) throw Error('Invalid card scale; expected a finite number from 0.5 to 1.5.');
}

/** Resolve the existing native geometry without changing explicit transforms.
 *  scale applies only to panel-default; other placement modes retain their own scale. */
export function resolveCardPlacement(placement, footprint, scale = DEFAULT_CARD_SCALE) {
  if (placement === 'native') return { scale: 1, dx: 0, dy: 0 };
  if (placement !== 'panel-default') return placement;
  validatePanelScale(scale);
  return anchoredDefaultPlacement({ ...footprint, scale });
}

/** Render one card. placement: 'panel-default' (the export panel's untouched card: 66%,
 *  anchored to its own corner), 'native' (full-size card), or { scale, dx, dy }.
 *  Optional scale applies only to panel-default, retaining its native corner anchor.
 *  Returns { svg, width, height, png, preset, orientation, appearance, placement, build }. */
export async function renderDiscStudioCard({ disc, photoSrc, flights, preset = 'b01', appearance, placement = 'panel-default', scale = DEFAULT_CARD_SCALE }) {
  if (placement === 'panel-default') validatePanelScale(scale);
  const { id, orientation } = presetById(preset);
  const look = validateCardAppearance({ ...defaultCardAppearance(id), ...(appearance ?? {}) });
  const card = cardFromThroDisc(disc, { photoSrc, flights });
  let footprint;
  if (placement === 'panel-default') { const native = await renderCardBlob(card, orientation, id, look); const a = await alphaBounds(native); footprint = { width: a.width, height: a.height, alphaBounds: a.bounds }; }
  const transform = resolveCardPlacement(placement, footprint, scale);
  const png = await renderPlacedCardBlob(card, orientation, id, transform, look);
  const { w: width, h: height } = CARD_SIZE[orientation];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${await toDataUrl(png)}"/></svg>`;
  return { svg, width, height, png, preset: id, orientation, appearance: look, placement: transform, build };
}
