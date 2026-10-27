// thro paper card (P01): the Mid-Century Retro ThroCard Sam posted to his Instagram story, 27 Oct 14:37 (Destroyer).
// A standalone, opaque card: warm paper, the disc photo in a circle with a soft drop shadow and a thin outer ring, the mold name
// big, a one-line description, four flight tiles (the first, speed, in the accent colour) and the thro logo in the footer.
// Thro-owned (not part of the pinned DiscStudio vendor files). Geometry is measured from Sam's screenshot, as fractions of the
// card's width W, so the card scales without changing shape. renderPaperCard(...) resolves to a canvas.
const PAPER = '#f3e8d2', INK = '#2b2420', MUTED = '#6f6253', CREAM = '#f3e8d2', ACCENT = '#e0632e';
export const PAPER_CARD_ASPECT = 1023 / 733;   // height / width, from the screenshot

/** "Distance driver" etc. from the speed number (the catalog carries no category). */
export function discClass(speed) {
  if (speed == null) return null;
  if (speed >= 10) return 'Distance driver';
  if (speed >= 6) return 'Fairway driver';
  if (speed >= 4) return 'Midrange';
  return 'Putter';
}
const fmt = n => n == null ? '–' : (Number.isInteger(n) ? String(n) : String(n));
const loadImage = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error(`Could not load ${src}`)); i.src = src; });

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fitText(ctx, text, maxWidth, startPx, weight, family) {
  let px = startPx;
  for (; px > 10; px -= 2) { ctx.font = `${weight} ${px}px ${family}`; if (ctx.measureText(text).width <= maxWidth) break; }
  return px;
}

/**
 * @param {{name:string, manufacturer?:string, plastic?:string|null, weight?:number|null, flights:(number|null)[],
 *          photoSrc?:string|null, logoSrc?:string|null, accent?:string, labels?:boolean, width?:number}} o
 */
export async function renderPaperCard({ name, manufacturer, plastic = null, weight = null, flights, photoSrc = null, logoSrc = null, accent = ACCENT, labels = true, width = 900 }) {
  const W = Math.round(width), H = Math.round(W * PAPER_CARD_ASPECT), u = W / 733;   // u: one screenshot pixel
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), ctx = c.getContext('2d');
  const family = '"Jost", system-ui, sans-serif';
  if (document.fonts?.load) await Promise.all(['800 40px Jost', '600 20px Jost', '500 20px Jost'].map(f => document.fonts.load(f).catch(() => {})));

  // the card: paper, rounded corners (transparent outside them so it sits on any background)
  roundRect(ctx, 0, 0, W, H, 28 * u); ctx.fillStyle = PAPER; ctx.fill();

  // disc: thin outer ring, soft drop shadow, the photo clipped to a circle
  const cx = 367 * u, cy = 338 * u, r = 248 * u, ring = 282 * u;
  ctx.beginPath(); ctx.arc(cx, cy, ring, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(43,36,32,0.18)'; ctx.lineWidth = 2.5 * u; ctx.stroke();
  ctx.save(); ctx.shadowColor = 'rgba(43,36,32,0.30)'; ctx.shadowBlur = 34 * u; ctx.shadowOffsetX = 12 * u; ctx.shadowOffsetY = 18 * u;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#d9cdb4'; ctx.fill(); ctx.restore();
  if (photoSrc) {
    try {
      const img = await loadImage(photoSrc);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      const s = Math.max((2 * r) / img.width, (2 * r) / img.height); ctx.drawImage(img, cx - img.width * s / 2, cy - img.height * s / 2, img.width * s, img.height * s);
      ctx.restore();
    } catch { /* keeps the plain disc */ }
  }

  // name: as big as fits the inner width
  const name0 = String(name ?? '').toUpperCase(), inner = W - 2 * 44 * u;
  const namePx = fitText(ctx, name0, inner, Math.round(98 * u), 800, family);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 ${namePx}px ${family}`; ctx.fillText(name0, W / 2, 685 * u);

  // one-line description: class · maker plastic · weight
  const sub = [discClass(flights?.[0]), [manufacturer, plastic].filter(Boolean).join(' '), weight ? `${weight} g` : null].filter(Boolean).join(' · ');
  ctx.fillStyle = MUTED; ctx.font = `500 ${fitText(ctx, sub, inner, Math.round(27 * u), 500, family)}px ${family}`; ctx.fillText(sub, W / 2, 735 * u);

  // flight tiles: speed in the accent, the rest ink
  const tileY = 773 * u, tileH = 127 * u, tileW = 155 * u, gap = 16 * u, x0 = (W - (4 * tileW + 3 * gap)) / 2;
  const names = ['SPEED', 'GLIDE', 'TURN', 'FADE'];
  for (let i = 0; i < 4; i++) {
    const x = x0 + i * (tileW + gap);
    roundRect(ctx, x, tileY, tileW, tileH, 12 * u); ctx.fillStyle = i === 0 ? accent : INK; ctx.fill();
    ctx.fillStyle = i === 0 ? '#fff4e6' : CREAM;
    if (labels) { ctx.font = `600 ${Math.round(17 * u)}px ${family}`; ctx.letterSpacing = `${(3 * u).toFixed(1)}px`; ctx.fillText(names[i], x + tileW / 2 + 1.5 * u, tileY + 36 * u); ctx.letterSpacing = '0px'; }
    const digits = fmt(flights?.[i]);
    ctx.font = `800 ${fitText(ctx, digits, tileW - 16 * u, Math.round((labels ? 62 : 72) * u), 800, family)}px ${family}`;
    ctx.fillText(digits, x + tileW / 2, tileY + (labels ? 104 : 90) * u);
  }

  // footer: the thro logo left, "ThroCard" right
  if (logoSrc) {
    try { const logo = await loadImage(logoSrc), lh = 56 * u, lw = logo.width / logo.height * lh; ctx.drawImage(logo, 36 * u, 932 * u, lw, lh); } catch { /* no logo */ }
  }
  ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.font = `600 ${Math.round(23 * u)}px ${family}`; ctx.letterSpacing = `${(1 * u).toFixed(1)}px`;
  ctx.fillText('ThroCard', W - 38 * u, 970 * u); ctx.letterSpacing = '0px';
  return c;
}

/** A 1080x1920 Instagram/TikTok story image: the card centred on ink, as large as fits with a margin. */
export async function storyImage(cardCanvasOrImage, { background = '#2b2420' } = {}) {
  const S = Object.assign(document.createElement('canvas'), { width: 1080, height: 1920 }), ctx = S.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, S.width, S.height);
  const w0 = cardCanvasOrImage.width, h0 = cardCanvasOrImage.height, s = Math.min(880 / w0, 1340 / h0);
  const w = w0 * s, h = h0 * s;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
  ctx.drawImage(cardCanvasOrImage, (S.width - w) / 2, (S.height - h) / 2 - 40, w, h); ctx.restore();
  return S;
}
