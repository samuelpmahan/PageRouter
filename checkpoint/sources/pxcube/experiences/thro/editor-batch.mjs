// Batch export: one PNG per disc, in the current layout, as a single .zip (editor-zip.mjs); optionally trimmed to the card's pixels.
// Nothing here draws a card: the caller renders each disc through the workspace and hands over the renderer's SVG and its measured layout.
import { zipStore } from './editor-zip.mjs';
import { alphaBounds } from './preview-frame.mjs';

/** The card's visible pixels as an integer box inside the canvas, from the renderer's report (layout.card: { x, y, w, h }), or null. */
export function cardPixelBox(card, canvas) {
  if (!card || ![card.x, card.y, card.w, card.h].every(Number.isFinite) || card.w <= 0 || card.h <= 0) return null;
  const x = Math.max(0, Math.floor(card.x)), y = Math.max(0, Math.floor(card.y));
  const width = Math.min(canvas.width, Math.ceil(card.x + card.w)) - x, height = Math.min(canvas.height, Math.ceil(card.y + card.h)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

const slug = text => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'disc';

/** Unique, tidy file names, each carrying its own size: thro-mvp-servo-1920x1080.png, then -2, -3 for a repeated name.
 *  items: [{ label, width, height }]. */
export function fileNames(items) {
  const used = new Map();
  return items.map(({ label, width, height }) => {
    const base = `thro-${slug(label)}-${width}x${height}`, n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return `${base}${n > 1 ? `-${n}` : ''}.png`;
  });
}

const canvasOf = (width, height) => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
const toBlob = canvas => canvas.convertToBlob ? canvas.convertToBlob({ type: 'image/png' }) : new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(Error('The PNG could not be encoded.'))), 'image/png'));

/** Trim a transparent PNG blob to a box; with no box, to its non-transparent pixels. Returns { blob, box } (box null when nothing is visible). */
export async function cropPng(blob, box = null) {
  const bitmap = await createImageBitmap(blob);
  try {
    let at = box;
    if (!at) {
      const probe = canvasOf(bitmap.width, bitmap.height), context = probe.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      at = alphaBounds(context.getImageData(0, 0, bitmap.width, bitmap.height));
      if (!at) return { blob, box: null };
    }
    const out = canvasOf(at.width, at.height);
    out.getContext('2d').drawImage(bitmap, at.x, at.y, at.width, at.height, 0, 0, at.width, at.height);
    return { blob: await toBlob(out), box: at };
  } finally { bitmap.close?.(); }
}

/** items: [{ name, blob }] → a zip Blob of PNGs. */
export async function zipPngs(items) {
  const entries = [];
  for (const { name, blob } of items) entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
  return new Blob([zipStore(entries)], { type: 'application/zip' });
}
