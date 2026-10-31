// Where the card's own controls (the strip of Side / Colour / Plate, and the recipe with its sliders) sit around the preview.
// On a laptop they sit directly under the card inside the preview panel. On a phone the Download bar goes straight under the card
// (so the card and Download share the first screen and nothing floats over the card), and the strip and recipe follow the bar.
export const onPhone = () => matchMedia('(max-width:760px)').matches;

/** The element the strip should follow: the Download bar on a phone, otherwise the preview itself. */
export function chromeAnchor(holder) {
  const bar = holder.closest('.preview-column')?.querySelector(':scope > .export-bar');
  return onPhone() && bar ? bar : holder;
}

/** Remove the strip and recipe wherever they were put (inside the panel, or after the Download bar). */
export function clearChrome(holder) {
  for (const scope of new Set([holder.parentElement, holder.closest('.preview-column')])) scope?.querySelectorAll(':scope > .ce-strip, :scope > .cp-recipe').forEach(node => node.remove());
}

// Where a small control goes on the card: the first of its candidate spots (holder pixels, the control's centre) where the control
// sits wholly inside the preview and covers none of the card's content or the controls already placed (Sam, 30 Oct: controls sit on
// what they control, never over it). With no clear spot (a phone, where the card fills the preview) it takes the spot, held inside
// the preview, that covers least: a handle, the knob or another control (hard) counts far more than the card's content, so a
// control may sit on the plate but never on something else you press.
// keep: [{x, y, w, h}] holder-pixel boxes nothing may cover; hard: the pressable ones among them. Returns the box the control now
// takes, to keep clear of the next one.
export function placeClear(el, spots, keep, holderW, holderH, inset = 4, hard = []) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const boxAt = ({ x, y }) => ({ x: x - w / 2, y: y - h / 2, w, h });
  const inside = b => b.x >= inset && b.y >= inset && b.x + b.w <= holderW - inset && b.y + b.h <= holderH - inset;
  const clear = b => keep.every(k => !k || b.x >= k.x + k.w || b.x + b.w <= k.x || b.y >= k.y + k.h || b.y + b.h <= k.y);
  let spot = spots.find(s => { const b = boxAt(s); return inside(b) && clear(b); });
  if (!spot) {
    const held = s => ({ x: Math.max(inset + w / 2, Math.min(holderW - inset - w / 2, s.x)), y: Math.max(inset + h / 2, Math.min(holderH - inset - h / 2, s.y)) });
    const over = (b, k) => k ? Math.max(0, Math.min(b.x + b.w, k.x + k.w) - Math.max(b.x, k.x)) * Math.max(0, Math.min(b.y + b.h, k.y + k.h) - Math.max(b.y, k.y)) : 0;
    const cost = s => { const b = boxAt(s); return keep.reduce((n, k) => n + over(b, k), 0) + 50 * hard.reduce((n, k) => n + over(b, k), 0); };
    spot = spots.map(held).reduce((best, s) => cost(s) < cost(best) ? s : best);
  }
  Object.assign(el.style, { left: `${spot.x}px`, top: `${spot.y}px` });
  return boxAt(spot);
}

/** Candidate spots around a box (holder pixels) for a control w × h: beside it on the given sides, at a gap, then a step further out. */
export function spotsAround(box, w, h, sides, gap = 8) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, out = [];
  for (const step of [0, 1, 2]) for (const side of sides) {
    const d = gap + step * (Math.min(w, h) + gap); // a step further out clears a handle or a badge beside it
    if (side === 'after') out.push({ x: box.x + box.w + d + w / 2, y: cy });
    else if (side === 'before') out.push({ x: box.x - d - w / 2, y: cy });
    else if (side === 'above') out.push({ x: cx, y: box.y - d - h / 2 });
    else if (side === 'below') out.push({ x: cx, y: box.y + box.h + d + h / 2 });
  }
  return out;
}
