// DiscStudio 6.6.1 card renderer, packaged for thro (build 28ac2b39fab85255).
// One call turns a thro disc into thro's own graphic contract: { svg, width, height }.
// The SVG wraps the exact PNG the DiscStudio export panel makes, so thro's existing
// pngFromSvg export path reproduces those pixels unchanged. Nothing in thro changes.
import { CARD_SIZE, browserFrames, sizeBrowserSticker, ensureCardFonts } from './browser-card-renderer.js?v=28ac2b39fab85255';
import { drawCard } from './card-renderer-core.js?v=28ac2b39fab85255';
import { getMoldDetails } from './mold-library.js?v=28ac2b39fab85255';
import { alphaBounds as rasterAlphaBounds, cardRasterIdentity, stickerOrigin } from './sticker-raster.mjs?v=28ac2b39fab85255';
import { imageLayer } from './frame-seek.mjs?v=28ac2b39fab85255';
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

// ---- Layout: what the unchanged DiscStudio drawing code drew, and where ----
// thro checks each card against its rule (disc photo > mold name > flight numbers >
// everything else) and frames its close-up from these boxes. They are recorded from
// the Canvas2D calls as DiscStudio makes them; the pixels are not touched.
const drawn = new WeakMap();
const sheet = ctx => { let s = drawn.get(ctx.canvas); if (!s) drawn.set(ctx.canvas, s = { items: [], clip: null, clips: [], arc: null }); return s; };
const scaleOf = m => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
const angleOf = m => Math.atan2(m.b, m.a) * 180 / Math.PI;
const skewOf = m => Math.abs(m.a * m.c + m.b * m.d) > 1e-6 || Math.abs(Math.hypot(m.a, m.b) - Math.hypot(m.c, m.d)) > 1e-6;
function boxThrough(m, x0, y0, x1, y1) {
  const xs = [], ys = [];
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) { xs.push(m.a * x + m.c * y + m.e); ys.push(m.b * x + m.d * y + m.f); }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function itemThrough(item, m) {
  if (item.kind === 'photo') {
    const r = item.r * scaleOf(m), cx = m.a * item.cx + m.c * item.cy + m.e, cy = m.b * item.cx + m.d * item.cy + m.f;
    return { ...item, cx, cy, r, x: cx - r, y: cy - r, w: r * 2, h: r * 2, angle: item.angle + angleOf(m), skewed: item.skewed || skewOf(m) };
  }
  return { ...item, ...boxThrough(m, item.x, item.y, item.x + item.w, item.y + item.h), size: item.size * scaleOf(m) };
}
// Type size is the drawn font size (after DiscStudio's fitFont), so a descender never counts as size.
const fontPx = font => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
let recording = false;
function recordCanvasDrawing() {
  if (recording || typeof CanvasRenderingContext2D === 'undefined') return;
  recording = true;
  const P = CanvasRenderingContext2D.prototype, o = {};
  for (const k of ['save', 'restore', 'beginPath', 'arc', 'clip', 'clearRect', 'drawImage', 'fillText']) o[k] = P[k];
  P.save = function (...a) { const s = sheet(this); s.clips.push(s.clip); return o.save.apply(this, a); };
  P.restore = function (...a) { const s = sheet(this); s.clip = s.clips.length ? s.clips.pop() : null; return o.restore.apply(this, a); };
  P.beginPath = function (...a) { sheet(this).arc = null; return o.beginPath.apply(this, a); };
  P.arc = function (x, y, r, a0, a1, ...rest) {
    const m = this.getTransform();
    sheet(this).arc = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6 ? { kind: 'photo', cx: m.a * x + m.c * y + m.e, cy: m.b * x + m.d * y + m.f, r: r * scaleOf(m), angle: angleOf(m), skewed: skewOf(m) } : null;
    return o.arc.call(this, x, y, r, a0, a1, ...rest);
  };
  P.clip = function (...a) { const s = sheet(this); if (s.arc) s.clip = s.arc; return o.clip.apply(this, a); };
  P.clearRect = function (x, y, w, h) {
    if (this.getTransform().isIdentity && x <= 0 && y <= 0 && x + w >= this.canvas.width && y + h >= this.canvas.height) sheet(this).items = [];
    return o.clearRect.call(this, x, y, w, h);
  };
  P.drawImage = function (source, ...a) {
    const s = sheet(this), child = drawn.get(source);
    if (child?.items.length) { // a layer or sticker canvas: carry its boxes through this placement
      let sx = 0, sy = 0, sw = source.width, sh = source.height, dx, dy, dw, dh;
      if (a.length === 2) [dx, dy, dw, dh] = [a[0], a[1], sw, sh]; else if (a.length === 4) [dx, dy, dw, dh] = a; else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
      const kx = dw / sw, ky = dh / sh, m = this.getTransform().multiply(new DOMMatrix([kx, 0, 0, ky, dx - sx * kx, dy - sy * ky]));
      for (const item of child.items) s.items.push(itemThrough(item, m));
    } else if (s.clip) s.items.push({ ...s.clip }); // the disc photo, drawn inside its circle
    return o.drawImage.call(this, source, ...a);
  };
  P.fillText = function (text, x, y, maxWidth) {
    const value = String(text);
    if (value.trim()) {
      const t = this.measureText(value), m = this.getTransform(), k = maxWidth !== undefined && t.width > maxWidth ? maxWidth / t.width : 1;
      sheet(this).items.push({ kind: 'text', text: value, ...boxThrough(m, x - t.actualBoundingBoxLeft * k, y - t.actualBoundingBoxAscent, x + t.actualBoundingBoxRight * k, y + t.actualBoundingBoxDescent), size: fontPx(this.font) * scaleOf(m) });
    }
    return maxWidth === undefined ? o.fillText.call(this, text, x, y) : o.fillText.call(this, text, x, y, maxWidth);
  };
}
const union = items => {
  if (!items.length) return null;
  const x = Math.min(...items.map(i => i.x)), y = Math.min(...items.map(i => i.y));
  return { x, y, w: Math.max(...items.map(i => i.x + i.w)) - x, h: Math.max(...items.map(i => i.y + i.h)) - y, size: Math.max(...items.map(i => i.size ?? i.h)) };
};
const round = box => box && Object.fromEntries(Object.entries(box).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]));
/** Sort the recorded drawing into the card's hierarchy. Name: the mold name as drawn
 *  (DiscStudio upper-cases it). Numbers: the flight values, one per tile. */
function layoutOf(items, moldName) {
  const name = String(moldName ?? '').toUpperCase(), photos = items.filter(i => i.kind === 'photo').sort((a, b) => b.r - a.r);
  const texts = items.filter(i => i.kind === 'text');
  const nameItems = texts.filter(i => name && i.text.toUpperCase() === name), numberItems = texts.filter(i => !nameItems.includes(i) && /^(?:-?\d+(?:\.\d+)?|\?)$/.test(i.text.trim()));
  const other = texts.filter(i => !nameItems.includes(i) && !numberItems.includes(i));
  return { photo: round(photos[0] ?? null), name: round(union(nameItems)), numbers: round(union(numberItems)), other: other.map(i => round({ text: i.text, x: i.x, y: i.y, w: i.w, h: i.h, size: i.size })) };
}

const photoCache = new Map();
function loadImage(source) {
  if (!photoCache.has(source)) {
    photoCache.set(source, new Promise((resolve, reject) => { const image = new Image(); image.decoding = 'async'; image.onload = () => resolve(image); image.onerror = () => reject(new Error('Prepared photo could not be read for this card.')); image.src = source; }));
    if (photoCache.size > 8) photoCache.delete(photoCache.keys().next().value);
  }
  return photoCache.get(source);
}
const newCanvas = (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
const canvasBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Browser could not encode the card PNG.')), 'image/png'));
const blobImage = async blob => { const url = URL.createObjectURL(blob); try { const image = new Image(); image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); } };
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
 *  Returns { svg, width, height, png, layout, preset, orientation, appearance, placement, build }.
 *  layout: { photo, name, numbers, other } boxes in canvas pixels, as drawn. */
export async function renderDiscStudioCard({ disc, photoSrc, flights, preset = 'b01', appearance, placement = 'panel-default', scale = DEFAULT_CARD_SCALE }) {
  if (placement === 'panel-default') validatePanelScale(scale);
  const { id, orientation } = presetById(preset);
  const look = validateCardAppearance({ ...defaultCardAppearance(id), ...(appearance ?? {}) });
  const card = cardFromThroDisc(disc, { photoSrc, flights });
  const { w: width, h: height } = CARD_SIZE[orientation];
  // The native card, drawn once. DiscStudio's renderCardBlob makes exactly these calls;
  // drawing it here keeps the canvas, so its layout can be read and its pixels reused
  // for placement instead of drawing the whole card a second time.
  recordCanvasDrawing();
  const nativeCanvas = newCanvas(width, height), nativeContext = nativeCanvas.getContext('2d');
  if (!nativeContext) throw new Error('Canvas2D is unavailable in this browser.');
  await ensureCardFonts();
  await drawCard(nativeContext, card, orientation, id, { loadImage, getMoldDetails, strictPhoto: true, createCanvas: newCanvas, frameRenderer: browserFrames }, look);
  const nativePng = await canvasBlob(nativeCanvas), nativeItems = drawn.get(nativeCanvas)?.items ?? [];
  const nativeBounds = rasterAlphaBounds(nativeContext.getImageData(0, 0, width, height).data, width, height);
  const footprint = placement === 'panel-default' ? { width, height, alphaBounds: [...nativeBounds] } : undefined;
  const transform = resolveCardPlacement(placement, footprint, scale);
  let png = nativePng, toPlaced = new DOMMatrix();
  if (!(transform.scale === 1 && transform.dx === 0 && transform.dy === 0)) {
    // DiscStudio's renderPlacedCardBlob, from the PNG already made: size the sticker, then place it.
    const sticker = sizeBrowserSticker(await blobImage(nativePng), width, height, nativeBounds, cardRasterIdentity(card, orientation, id, look), transform.scale);
    const origin = stickerOrigin({ width, height, nativeBounds: sticker.nativeBounds, placement: transform, sticker });
    const placed = newCanvas(width, height), context = placed.getContext('2d');
    if (!context) throw new Error('Canvas2D is unavailable in this browser.');
    browserFrames.seek(context, { width, height, layers: [{ ...imageLayer('placement-card', sticker.identity, sticker.canvas, sticker.width, sticker.height), ...origin }] }, 0);
    png = await canvasBlob(placed);
    const k = transform.scale;
    toPlaced = new DOMMatrix([k, 0, 0, k, origin.x - nativeBounds[0] * k - sticker.cropOffset.x, origin.y - nativeBounds[1] * k - sticker.cropOffset.y]);
  }
  const layout = layoutOf(nativeItems.map(item => itemThrough(item, toPlaced)), card.renderer?.moldName ?? disc.name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="${await toDataUrl(png)}"/></svg>`;
  return { svg, width, height, png, layout, preset: id, orientation, appearance: look, placement: transform, build };
}
