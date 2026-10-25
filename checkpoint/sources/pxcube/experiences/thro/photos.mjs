// thro · your photos (Sam, 25 Oct: "Don't pre crop them. Seeing the crop happen is part of the demo").
// Ten raw phone photos → Argon's rim fit runs here, in a worker, on the photo's own pixels → the page draws what it found, in the
// order it found it (coarse rim, three fine fits, the per-octant join), then unwarps the disc into a circle. That circle, with a
// mold, goes to the editor as a real shelf disc (photo-bag.mjs). Argon's own run on the same photos is kept only as a check: the
// caption shows how far the live fit lands from it, as a number.
import { saveBag } from './photo-bag.mjs';
const V = '?v=28ac2b39fab85255';
const molds = await import(`./vendor/discstudio-cards/mold-library.js${V}`);
const $ = id => document.getElementById(id);
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COL = { coarse: css('--coarse'), 'v1-band-snap': css('--b1'), 'v2-overmold-outer': css('--b2'), 'v3-polar-dp-band': css('--b3'), accent: css('--accent') };
const BRANCHES = ['v1-band-snap', 'v2-overmold-outer', 'v3-polar-dp-band'];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const manifest = await (await fetch('./assets/photos/photos.json')).json();
const image = src => new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => no(Error(`Could not load ${src}`)); i.src = src; });
const photos = manifest.photos.map(meta => ({ meta, img: null, result: null, ms: 0, mold: meta.mold ? molds.moldRecord(meta.mold) : null, cut: null }));
let current = null, busy = false, frame = null;

// ---- worker: Argon's rim fit on the photo's pixels (1024 px working copy, results in the photo's own pixel space) ----
const worker = new Worker(new URL('./rimfit-worker.mjs', import.meta.url), { type: 'module' });
const waiting = new Map();
worker.onmessage = ({ data }) => { const w = waiting.get(data.name); waiting.delete(data.name); data.error ? w.no(Error(data.error)) : w.ok(data); };
function fit(p) {
  const { img } = p, k = 1024 / Math.max(img.naturalWidth, img.naturalHeight);
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
  const data = x.getImageData(0, 0, c.width, c.height).data;
  return new Promise((ok, no) => {
    waiting.set(p.meta.name, { ok, no });
    worker.postMessage({ name: p.meta.name, width: img.naturalWidth, height: img.naturalHeight, working: { width: c.width, height: c.height, data } }, [data.buffer]);
  });
}

// ---- geometry ----
const radiusAlong = (e, th) => { const a = e.angle * DEG, u = Math.cos(th - a), v = Math.sin(th - a); return 1 / Math.sqrt((u / e.rx) ** 2 + (v / e.ry) ** 2); };
// The affine map that sends ellipse e (image px) to a circle of radius R centred at (X, Y): p' = A·p + t.
function unwarp(e, R, X, Y) {
  const a = e.angle * DEG, c = Math.cos(a), s = Math.sin(a), ix = R / e.rx, iy = R / e.ry;
  const m11 = c * c * ix + s * s * iy, m12 = c * s * (ix - iy), m22 = s * s * ix + c * c * iy; // R·diag(R/rx, R/ry)·Rᵀ
  return [m11, m12, m12, m22, X - (m11 * e.cx + m12 * e.cy), Y - (m12 * e.cx + m22 * e.cy)];
}
const mix = (A, B, t) => A.map((v, i) => v + (B[i] - v) * t);
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const clamp01 = t => Math.max(0, Math.min(1, t));

// ---- the stage ----
const view = $('view'), vx = view.getContext('2d');
function size() {
  const r = view.getBoundingClientRect(), d = devicePixelRatio || 1;
  view.width = Math.round(r.width * d); view.height = Math.round(r.height * d);
  if (frame) draw(frame);
}
new ResizeObserver(size).observe(view);
function fitView(img) {
  const W = view.width, H = view.height, s = Math.min(W / img.naturalWidth, H / img.naturalHeight) * 0.94;
  return { s, ox: (W - img.naturalWidth * s) / 2, oy: (H - img.naturalHeight * s) / 2, W, H };
}
// Stroke an ellipse (image px) on the stage, from polar angle 0 to `upTo` (radians), optionally only between th0 and th1.
function strokeEllipse(e, vw, { color, width = 2, dash = [], upTo = TAU, from = 0, alpha = 1, glow = 0 }) {
  if (upTo <= from) return;
  vx.save(); vx.globalAlpha = alpha; vx.strokeStyle = color; vx.lineWidth = width * (devicePixelRatio || 1); vx.setLineDash(dash.map(d => d * (devicePixelRatio || 1)));
  if (glow) { vx.shadowColor = color; vx.shadowBlur = glow * (devicePixelRatio || 1); }
  vx.beginPath();
  const n = Math.max(8, Math.ceil((upTo - from) / TAU * 180));
  for (let i = 0; i <= n; i++) {
    const th = from + (upTo - from) * i / n, r = radiusAlong(e, th);
    const x = vw.ox + vw.s * (e.cx + r * Math.cos(th)), y = vw.oy + vw.s * (e.cy + r * Math.sin(th));
    i ? vx.lineTo(x, y) : vx.moveTo(x, y);
  }
  vx.stroke(); vx.restore();
}

// One frame of the crop. f = { p, scan, coarse, fine, join, final, unwarp } with each stage 0..1.
function draw(f) {
  frame = f;
  const { p } = f, W = view.width, H = view.height;
  vx.setTransform(1, 0, 0, 1, 0, 0); vx.clearRect(0, 0, W, H);
  if (!p.img) return;
  const vw = fitView(p.img), base = [vw.s, 0, 0, vw.s, vw.ox, vw.oy], r = p.result, e = r?.output;
  const u = ease(clamp01(f.unwarp ?? 0));
  // The photo, fading back as the disc lifts out of it.
  vx.globalAlpha = 1 - 0.82 * u; vx.setTransform(...base); vx.drawImage(p.img, 0, 0); vx.setTransform(1, 0, 0, 1, 0, 0); vx.globalAlpha = 1;
  if (f.scan != null && !r) { // working: Argon's coarse pass casts 72 rays from the middle; show them turning
    const cx = vw.ox + vw.s * p.img.naturalWidth / 2, cy = vw.oy + vw.s * p.img.naturalHeight / 2, R = Math.hypot(W, H) / 2;
    vx.save(); vx.strokeStyle = COL.coarse; vx.lineWidth = devicePixelRatio || 1;
    for (let i = 0; i < 72; i++) { const th = i * 5 * DEG + f.scan * 0.9; vx.globalAlpha = 0.08 + 0.5 * ((Math.sin(th * 1 - f.scan * 3) + 1) / 2) ** 6; vx.beginPath(); vx.moveTo(cx, cy); vx.lineTo(cx + R * Math.cos(th), cy + R * Math.sin(th)); vx.stroke(); }
    vx.restore();
  }
  if (!r) return;
  const fade = 1 - u;
  if (f.coarse > 0) {
    strokeEllipse(r.coarse, vw, { color: COL.coarse, width: 2, dash: [7, 6], upTo: TAU * clamp01(f.coarse), alpha: fade * (1 - 0.6 * clamp01(f.final ?? 0)) });
    if (r.innerRimRing) strokeEllipse(r.innerRimRing, vw, { color: COL.coarse, width: 1, dash: [2, 5], upTo: TAU * clamp01(f.coarse), alpha: 0.55 * fade * (1 - clamp01(f.fine ?? 0)) });
  }
  if (f.fine > 0) BRANCHES.forEach((id, i) => {
    const t = clamp01(f.fine * 3 - i);
    strokeEllipse(r.branches[`fine/${id}`], vw, { color: COL[id], width: 1.5, upTo: TAU * t, alpha: fade * (1 - 0.75 * clamp01(f.final ?? 0)) });
  });
  if (f.join > 0) r.pickedPerArc.forEach((id, o) => {
    const t = clamp01(f.join * 8 - o); if (!t) return;
    const from = o * Math.PI / 4;
    strokeEllipse(r.branches[`fine/${id}`], vw, { color: COL[id], width: 6, from, upTo: from + Math.PI / 4 * t, alpha: fade * (1 - 0.7 * clamp01(f.final ?? 0)), glow: 10 });
  });
  if (f.final > 0 && u < 1) strokeEllipse(e, vw, { color: COL.accent, width: 3, upTo: TAU * clamp01(f.final * 1.6), alpha: fade, glow: 14 });
  if (u > 0) { // the unwarp: one affine map, from "the disc where it lies in the photo" to "the disc face-on in the middle"
    const R = Math.min(W, H) * 0.37, T = mix(base, unwarp(e, R, W / 2, H * 0.45), u);
    vx.save(); vx.setTransform(...T); vx.beginPath(); vx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle * DEG, 0, TAU); vx.clip(); vx.drawImage(p.img, 0, 0); vx.restore();
    vx.save(); vx.strokeStyle = COL.accent; vx.globalAlpha = 0.9 * (1 - u * 0.6); vx.lineWidth = 3 * (devicePixelRatio || 1); vx.setTransform(...T);
    vx.beginPath(); vx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle * DEG, 0, TAU); vx.setTransform(1, 0, 0, 1, 0, 0); vx.stroke(); vx.restore();
  }
}

// ---- the crop, played ----
const STAGES = [['coarse', 900], ['fine', 1100], ['join', 1100], ['final', 600], ['unwarp', 1300]];
function steps(on, p) {
  const r = p?.result;
  for (const li of $('steps').children) li.classList.toggle('on', on.includes(li.dataset.k));
  const fmt = e => `${Math.round(e.rx)} × ${Math.round(e.ry)} px · ${e.angle.toFixed(0)}°`;
  $('s-coarse').textContent = r && on.includes('coarse') ? `coarse: ${fmt(r.coarse)}${r.innerRimRing ? ' · inner ring found' : ''}` : 'colour bands on 72 rays, 8 octants vote';
  $('s-fine').textContent = r && on.includes('fine') ? BRANCHES.map(id => Math.round(r.branches[`fine/${id}`].rx)).join(' · ') + ' px across-radius' : 'band snap · overmold outer · polar path';
  $('s-join').textContent = r && on.includes('join') ? `arcs from: ${r.pickedPerArc.map(id => ({ 'v1-band-snap': 'S', 'v2-overmold-outer': 'O', 'v3-polar-dp-band': 'P' })[id]).join('')} · ${Math.round(r.liveWitness.octantSupport * 8)}/8 octants agree` : 'one ellipse from 8 arcs';
  $('s-unwarp').textContent = r && on.includes('unwarp') ? `${fmt(r.output)} → circle · squash ${((1 - r.output.ry / r.output.rx) * 100).toFixed(1)}%` : 'undo the camera tilt';
}
function caption(p) {
  const r = p.result, a = p.meta.argon;
  if (!r) { $('cap').innerHTML = `<span>${p.meta.name} · ${p.img.naturalWidth}×${p.img.naturalHeight}</span>`; return; }
  const dev = Math.max(...['cx', 'cy', 'rx', 'ry'].map(k => Math.abs(r.output[k] - a[k]))) / a.rx * 100;
  (window.__photoFits ??= {})[p.meta.name] = +dev.toFixed(2);
  $('cap').innerHTML = `<span>${p.meta.name}</span><span>found in ${p.ms} ms, in this browser</span><span>off Argon's own run by ${dev.toFixed(2)}% of the radius</span>`;
}
async function play(p, speed = 1) {
  caption(p); steps([], p);
  let done = false, t0 = performance.now();
  const fitted = p.result ? Promise.resolve() : fit(p).then(d => { p.result = d.result; p.ms = d.ms; });
  fitted.catch(() => {}).finally(() => { done = true; });
  await new Promise(ok => { const spin = now => { if (done && now - t0 > 500 / speed) return ok(); draw({ p, scan: (now - t0) / 400 }); requestAnimationFrame(spin); }; requestAnimationFrame(spin); });
  await fitted; caption(p);
  const f = { p }, on = [];
  for (const [k, ms] of STAGES) {
    const dur = reduced ? 1 : ms / speed, s = performance.now();
    if (['coarse', 'fine', 'join', 'unwarp'].includes(k)) on.push(k);
    steps(on, p);
    await new Promise(ok => { const tick = now => { f[k] = clamp01((now - s) / dur); draw(f); f[k] < 1 ? requestAnimationFrame(tick) : ok(); }; requestAnimationFrame(tick); });
  }
  p.cut = cutout(p); p.played = true;
  thumbs(); panel(); bag();
}
// The disc, face-on, on transparency: the same affine map as the animation's last frame, at 800 px.
function cutout(p) {
  const S = 800, c = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = c.getContext('2d'), e = p.result.output;
  x.imageSmoothingQuality = 'high'; x.setTransform(...unwarp(e, S / 2, S / 2, S / 2));
  x.beginPath(); x.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle * DEG, 0, TAU); x.clip(); x.drawImage(p.img, 0, 0);
  let src = c.toDataURL('image/webp', 0.88);
  if (!src.startsWith('data:image/webp')) src = c.toDataURL('image/png');
  return { canvas: c, src };
}

// ---- strip, panel, bag ----
function thumbs() {
  for (const p of photos) {
    const b = p.el; b.setAttribute('aria-current', String(p === current));
    const tag = b.querySelector('.tag'); tag.textContent = p.cut ? (p.mold ? 'in bag' : 'needs mold') : 'raw'; tag.classList.toggle('done', !!(p.cut && p.mold));
    const c = b.querySelector('canvas'), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
    if (p.result && p.img) { // the fitted rim, on the thumbnail (cover-cropped like the img)
      const s = Math.max(c.width / p.img.naturalWidth, c.height / p.img.naturalHeight), vw = { s, ox: (c.width - p.img.naturalWidth * s) / 2, oy: (c.height - p.img.naturalHeight * s) / 2 };
      const e = p.result.output; x.strokeStyle = COL.accent; x.lineWidth = 2.5; x.beginPath(); x.ellipse(vw.ox + s * e.cx, vw.oy + s * e.cy, s * e.rx, s * e.ry, e.angle * DEG, 0, TAU); x.stroke();
    }
  }
}
function panel() {
  const p = current, cx = $('cut').getContext('2d'); cx.clearRect(0, 0, 240, 240);
  if (p.cut) { cx.drawImage(p.cut.canvas, 0, 0, 240, 240); $('cut-note').textContent = p.mold ? `${p.mold.manufacturer} ${p.mold.mold} · ${p.mold.flight.join(' | ')}` : 'Cropped. Which mold is it?'; }
  else $('cut-note').textContent = 'Not cropped yet.';
  $('seen').textContent = p.meta.seen;
  if (document.activeElement !== $('mold')) $('mold').value = p.mold ? `${p.mold.manufacturer} ${p.mold.mold}` : '';
  hits();
}
function hits() {
  const p = current, q = $('mold').value.trim();
  const rows = q ? molds.searchMolds(q, 6) : p.mold ? [p.mold] : [];
  $('hits').replaceChildren(...rows.map(m => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(p.mold?.id === m.id));
    b.innerHTML = `${m.manufacturer} <b>${m.mold}</b><small>${(m.flight ?? []).join(' | ')}</small>`;
    b.onclick = () => { p.mold = m; $('mold').value = `${m.manufacturer} ${m.mold}`; $('mold').blur(); panel(); thumbs(); bag(); };
    return b;
  }));
}
$('mold').addEventListener('input', hits);
function ready() { return photos.filter(p => p.cut && p.mold); }
function bag() {
  const r = ready();
  $('bag').replaceChildren(...r.map(p => { const c = Object.assign(document.createElement('canvas'), { width: 68, height: 68, title: p.mold.mold }); c.getContext('2d').drawImage(p.cut.canvas, 0, 0, 68, 68); return c; }));
  $('make').disabled = !r.length || busy;
  const cropped = photos.filter(p => p.cut).length;
  $('status').innerHTML = cropped ? `<b>${cropped} of ${photos.length}</b> cropped · <b>${r.length}</b> in your bag${cropped > r.length ? ` · ${cropped - r.length} need a mold` : ''}` : `<b>${photos.length} photos</b>, none cropped yet.`;
}
function setBusy(on) { busy = on; $('crop').disabled = on || !!current?.cut; $('crop').hidden = !!current?.cut; $('all').disabled = on || photos.every(p => p.cut); bag(); }

async function select(p) {
  if (busy) return;
  current = p; thumbs(); panel();
  if (!p.img) p.img = await image(p.meta.file);
  caption(p);
  if (p.cut) { steps(['coarse', 'fine', 'join', 'unwarp'], p); draw({ p, coarse: 1, fine: 1, join: 1, final: 1, unwarp: 1 }); }
  else { steps([], p); draw({ p }); }
  setBusy(false);
}
async function crop(p, speed) {
  setBusy(true); current = p; thumbs(); panel();
  try { if (!p.img) p.img = await image(p.meta.file); await play(p, speed); }
  catch (error) { $('cap').innerHTML = `<span>Could not crop ${p.meta.name}: ${error.message}</span>`; console.error(error); }
  finally { setBusy(false); }
}
$('crop').onclick = () => crop(current, 1);
$('all').onclick = async () => {
  for (const p of photos) if (!p.cut) { await crop(p, 2.4); if (!p.cut) break; }
};
$('make').onclick = async () => {
  const discs = ready().map(p => ({ id: `photo-${p.meta.name.toLowerCase().replace(/_/g, '-')}`, mold: p.mold.id, name: p.mold.mold, manufacturer: p.mold.manufacturer,
    plastic: p.mold.id === p.meta.mold ? p.meta.plastic : null, src: p.cut.src }));
  try { saveBag(discs); } catch (error) { $('status').textContent = `Could not hand the discs over: ${error.message}`; return; }
  const editor = (await fetch('./editor.html', { method: 'HEAD' }).catch(() => null))?.ok ? './editor.html' : './index.html';
  location.href = `${editor}?bag=photos`;
};

// ---- start ----
for (const p of photos) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.setAttribute('aria-label', `${p.meta.name}: ${p.meta.seen}`);
  b.innerHTML = `<img alt="" src="${p.meta.file}" loading="lazy"><canvas width="150" height="200"></canvas><span class="tag">raw</span>`;
  b.onclick = () => select(p); p.el = b; $('strip').append(b);
}
const start = photos.find(p => p.meta.name === 'IMG_6165') ?? photos[0];
size(); await select(start);
if (new URLSearchParams(location.search).has('auto')) $('all').click();
