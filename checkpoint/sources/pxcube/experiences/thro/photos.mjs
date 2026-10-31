// thro · your photos (Sam, 25 Oct: "Don't pre crop them. Seeing the crop happen is part of the demo").
// Ten raw phone photos → Argon's rim fit runs here, in a worker, on the photo's own pixels → the page draws what it found, in the
// order it found it (coarse rim, three fine fits, the per-octant join), then unwarps the disc into a circle. That circle, with a
// mold, goes to the editor as a real shelf disc (photo-bag.mjs). Argon's own run on the same photos is kept only as a check: the
// caption shows how far the live fit lands from it, as a number.
import { saveBag } from './photo-bag.mjs';
import { enter, record } from './thro-calculations.mjs';
import { moldFeed } from './mold-feed.mjs';
const V = '?v=28ac2b39fab85255';
// Mold search reads one ranked list a page at a time, loading the next page as the list scrolls (mold-feed.mjs). The build
// writes how many harvested videos name each mold; without that file every mold counts the same.
// The catalog (mold-library.js and the packed mold-runtime.bin) and the counts load when the search box is first focused or
// typed in, or when the discs are handed to the editor, not with the page (30 Oct: the photos page was over its 75,000 byte
// code budget with them in its first load). The sample photos' own molds come in the built photos.json, so the page can name
// them without the catalog. A search typed before the catalog arrives waits for it, so the first list shown is already ranked.
let molds = null, feed = null, catalogLoading = null;
const loadCatalog = () => catalogLoading ??= Promise.all([
  import(`./vendor/discstudio-cards/mold-library.js${V}`),
  import(`./vendor/discstudio-cards/mold-runtime-index.js${V}`),
  fetch('./assets/molds/mold-mentions.json').then(r => r.ok ? r.json() : {}, () => ({})),
]).then(([library, { packedMoldIndex }, heard]) => { molds = library; feed = moldFeed(packedMoldIndex, heard.mentions ?? {}); });
const PAGE = 12;
const $ = id => document.getElementById(id);
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COL = { coarse: css('--coarse'), 'v1-band-snap': css('--b1'), 'v2-overmold-outer': css('--b2'), 'v3-polar-dp-band': css('--b3'), accent: css('--accent') };
const BRANCHES = ['v1-band-snap', 'v2-overmold-outer', 'v3-polar-dp-band'];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const manifest = await (await fetch('./assets/photos/photos.json')).json();
const image = src => new Promise((ok, no) => { const i = new Image(); i.decoding = 'async'; i.onload = () => ok(i); i.onerror = () => no(Error(`Could not load ${src}`)); i.src = src; });
const sampleMold = meta => { if (meta.mold && !meta.record) throw Error(`photos.json names ${meta.mold} without its record; rebuild with build.mjs`); return meta.record ?? null; };
const photos = manifest.photos.map(meta => ({ meta, label: meta.name, img: null, result: null, ms: 0, mold: sampleMold(meta), cut: null, show: 'disc' }));
let current = null, busy = false, frame = null, run = null, uploads = 0;
const narrow = matchMedia('(max-width:980px)');

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
    worker.postMessage({ name: p.meta.name, width: img.naturalWidth, height: img.naturalHeight, reference: p.meta.argon ?? null, working: { width: c.width, height: c.height, data } }, [data.buffer]);
  });
}

// ---- geometry ----
const radiusAlong = (e, th) => { const a = e.angle * DEG, u = Math.cos(th - a), v = Math.sin(th - a); return 1 / Math.sqrt((u / e.rx) ** 2 + (v / e.ry) ** 2); };
const SIZE = 800; // the cutout; thro/crop/unwarp maps the ellipse onto an 800 px circle
// Place the registered unwarp (ellipse -> 800 px circle) on the stage: scale to radius R and move the centre to (X, Y).
function place(M, R, X, Y) { const k = R / (SIZE / 2); return [M[0] * k, M[1] * k, M[2] * k, M[3] * k, (M[4] - SIZE / 2) * k + X, (M[5] - SIZE / 2) * k + Y]; }
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
  const rs = ease(clamp01(f.result ?? 0));
  vx.globalAlpha = (1 - 0.82 * u) * (1 - rs); vx.setTransform(...base); vx.drawImage(p.img, 0, 0); vx.setTransform(1, 0, 0, 1, 0, 0); vx.globalAlpha = 1;
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
  if (f.final > 0 && u < 1) strokeEllipse(e, vw, { color: COL.accent, width: 3, upTo: TAU * clamp01(f.final * 1.6), alpha: fade * (1 - rs), glow: 14 });
  if (u > 0) { // the unwarp: one affine map, from "the disc where it lies in the photo" to "the disc face-on in the middle"
    const R = Math.min(W, H) * (0.37 + 0.09 * rs), T = mix(base, place(p.matrix, R, W / 2, H * (0.45 + 0.05 * rs)), u);
    vx.save(); vx.setTransform(...T); vx.beginPath(); vx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle * DEG, 0, TAU); vx.clip(); vx.drawImage(p.img, 0, 0); vx.restore();
    vx.save(); vx.strokeStyle = COL.accent; vx.globalAlpha = 0.9 * (1 - u * 0.6) * (1 - rs); vx.lineWidth = 3 * (devicePixelRatio || 1); vx.setTransform(...T);
    vx.beginPath(); vx.ellipse(e.cx, e.cy, e.rx, e.ry, e.angle * DEG, 0, TAU); vx.setTransform(1, 0, 0, 1, 0, 0); vx.stroke(); vx.restore();
  }
}

// ---- the crop, played ----
const STAGES = [['coarse', 900], ['fine', 1100], ['join', 1100], ['final', 600], ['unwarp', 1300], ['result', 700]];
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
  const r = p.result;
  if (!r) { $('how-meta').textContent = ''; return; }
  const dev = r.offReferencePct;
  if (dev != null) (window.__photoFits ??= {})[p.meta.name] = dev;
  $('how-meta').textContent = `${p.label}: found in ${p.ms} ms, in this browser` + (dev != null ? ` · off Argon's own run by ${dev.toFixed(2)}% of the radius` : ' · your own photo, so there is no Argon run to compare with');
}
const showDisc = p => draw({ p, coarse: 1, fine: 1, join: 1, final: 1, unwarp: p.show === 'photo' ? 0 : 1, result: p.show === 'photo' ? 0 : 1 });
async function play(p, speed = 1) {
  caption(p); steps([], p);
  let done = false, t0 = performance.now();
  const fitted = p.result ? Promise.resolve() : fit(p).then(d => {
    const live = record(d.report); p.result = live.items[0]; p.ms = p.result.ms;
    const unwarp = enter('thro/crop/unwarp', [{ name: p.meta.name, ellipse: p.result.output, size: SIZE }]); p.matrix = unwarp.items[0].matrix;
    p.reports = [live, unwarp];
  });
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
  p.cut = await cutout(p); p.played = true;
  thumbs(); panel(); bag(); witness(p);
  if (!run && narrow.matches && !p.mold) $('disc').scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
}
// The disc, face-on, on transparency: the same affine map as the animation's last frame, at 800 px.
async function cutout(p) {
  const report = enter('thro/crop/cutout', [{ name: p.meta.name, img: p.img, ellipse: p.result.output, size: SIZE, matrix: p.matrix }]);
  p.reports.push(report);
  const off = report.items[0].canvas, c = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  c.getContext('2d').drawImage(off, 0, 0);
  let src = c.toDataURL('image/webp', 0.88);
  if (!src.startsWith('data:image/webp')) src = c.toDataURL('image/png');
  return { canvas: c, src };
}
// Every guarantee that ran for this photo, as Argon's runner reported it.
function witness(p) {
  $('witness').replaceChildren(...(p?.reports ?? []).map(r => {
    const d = document.createElement('div'); d.className = 'calc';
    d.innerHTML = `<b>${r.calculationId}</b> <span>${r.selfGuaranteeStatus}</span>` + Object.values(r.guarantees).map(g => `<small title="${g.description}">${g.id} · ${g.metric}</small>`).join('');
    return d;
  }));
}

// ---- strip, panel, bag ----
function thumbs() {
  if (current?.el) { const st = $('strip'), e = current.el, row = getComputedStyle(st).flexDirection === 'row'; st.scrollTo(row ? { left: e.offsetLeft - (st.clientWidth - e.offsetWidth) / 2 } : { top: e.offsetTop - (st.clientHeight - e.offsetHeight) / 2 }); }
  for (const p of photos) {
    const b = p.el; b.setAttribute('aria-current', String(p === current));
    const state = p.cut ? (p.mold ? 'ready' : 'needs-mold') : 'raw'; b.dataset.state = state; b.querySelector('.tag').textContent = { raw: '', ready: '✓', 'needs-mold': 'Name it' }[state];
    const c = b.querySelector('canvas'), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
    if (p.result && p.img) { // the fitted rim, on the thumbnail (cover-cropped like the img)
      const s = Math.max(c.width / p.img.naturalWidth, c.height / p.img.naturalHeight), vw = { s, ox: (c.width - p.img.naturalWidth * s) / 2, oy: (c.height - p.img.naturalHeight * s) / 2 };
      const e = p.result.output; x.strokeStyle = COL.accent; x.lineWidth = 2.5; x.beginPath(); x.ellipse(vw.ox + s * e.cx, vw.oy + s * e.cy, s * e.rx, s * e.ry, e.angle * DEG, 0, TAU); x.stroke();
    }
  }
}
function panel() {
  const p = current;
  const fl = p.mold?.flight?.join(' | ') ?? '';
  $('flight').textContent = p.cut && p.mold ? fl : '';
  if (!p.cut) { $('disc-title').textContent = 'Crop a photo to see your disc'; $('cut-note').textContent = 'Pick a photo, then press Crop this photo.'; }
  else if (p.mold) { $('disc-title').textContent = `${p.mold.manufacturer} ${p.mold.mold}`; $('cut-note').textContent = 'Not this disc? Search again below.'; }
  else { $('disc-title').textContent = 'Which mold is this?'; $('cut-note').textContent = 'Name it to send it to the editor.'; }
  $('mold').hidden = !p.cut;
  if (document.activeElement !== $('mold')) $('mold').value = p.mold ? `${p.mold.manufacturer} ${p.mold.mold}` : '';
  hits();
}
// Closest catalog matches for a name the search does not know: longest prefixes of each word, then the shorter ones.
function closest(q, limit = 5) {
  const seen = new Map(), words = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
  for (let len = 8; len >= 2 && seen.size < limit; len--)
    for (const w of words) if (w.length >= len) for (const m of molds.searchMolds(w.slice(0, len), limit)) if (seen.size < limit && !seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()];
}
let more = null; // { query, cursor, total, shown } while the typed search has pages left to load
const more$ = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) nextPage(); }, { root: $('hits'), rootMargin: '0px 0px 24px 0px' });
function hitButton(found) {
  const { match: _match, heard: _heard, ...m } = found, p = current;
  const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(p.mold?.id === m.id));
  b.innerHTML = `${m.manufacturer} <b>${m.mold}</b><small>${(m.flight ?? []).join(' | ')}</small>`;
  b.onclick = () => { p.mold = m; $('mold').value = `${m.manufacturer} ${m.mold}`; $('mold').blur(); panel(); thumbs(); bag(); };
  return b;
}
function moreRow() {
  const row = document.createElement('p'); row.className = 'more';
  row.textContent = `${more.total - more.shown} more`;
  return row;
}
function nextPage() {
  if (!more?.cursor) return;
  const page = feed.search(more.query, { limit: PAGE, cursor: more.cursor });
  more = { ...more, cursor: page.nextCursor, shown: more.shown + page.items.length };
  const list = $('hits'), old = list.querySelector('.more');
  more$.disconnect();
  old?.replaceWith(...page.items.map(hitButton), ...(more.cursor ? [moreRow()] : []));
  const row = list.querySelector('.more'); if (row) more$.observe(row);
}
function hits() {
  const p = current, q = $('mold').value.trim();
  const own = p.mold ? `${p.mold.manufacturer} ${p.mold.mold}` : '';
  const typing = q && q !== own;
  more$.disconnect(); more = null;
  if (typing && !feed) { loadCatalog().then(hits); return; }
  let rows = p.mold && !typing ? [p.mold] : [], note = null;
  if (typing) {
    const page = feed.search(q, { limit: PAGE });
    rows = page.items;
    more = { query: q, cursor: page.nextCursor, total: page.total, shown: rows.length };
  }
  if (typing && !rows.length) {
    rows = closest(q);
    note = document.createElement('p'); note.className = 'nomatch';
    note.innerHTML = `The catalog has no mold called <b></b>.` + (rows.length ? ' Closest matches:' : ' Try the maker\u2019s name or the first letters.');
    note.querySelector('b').textContent = `\u201c${q}\u201d`;
  }
  $('hits').replaceChildren(...(note ? [note] : []), ...rows.map(hitButton), ...(more?.cursor ? [moreRow()] : []));
  $('hits').scrollTop = 0;
  const row = $('hits').querySelector('.more'); if (row) more$.observe(row);
}
$('mold').addEventListener('input', hits);
$('mold').addEventListener('focus', loadCatalog, { once: true });
const ready = () => photos.filter(p => p.cut && p.mold);
const left = () => photos.filter(p => p.cut && !p.mold);
function bag() {
  const r = ready(), out = left();
  $('bag').replaceChildren(...r.map(p => { const c = Object.assign(document.createElement('canvas'), { width: 68, height: 68, title: p.mold.mold }); c.getContext('2d').drawImage(p.cut.canvas, 0, 0, 68, 68); return c; }));
  $('make').disabled = !r.length || busy;
  const cropped = photos.filter(p => p.cut).length;
  const names = out.slice(0, 3).map(p => p.label).join(', ') + (out.length > 3 ? ` and ${out.length - 3} more` : '');
  $('status').innerHTML = cropped
    ? `<b>${cropped} of ${photos.length}</b> cropped · <b>${r.length}</b> going to the editor` + (out.length ? `<span class="warn">${out.length} cropped ${out.length === 1 ? 'disc is' : 'discs are'} not going to the editor, because no mold is chosen: ${names}. <button type="button" class="link" id="name-them">Name ${out.length === 1 ? 'it' : 'them'}</button></span>` : '')
    : `<b>${photos.length} photos</b>, none cropped yet.`;
  const nt = $('name-them'); if (nt) nt.onclick = () => nameThem(out[0]);
  controls();
}
async function nameThem(p) { if (busy) return; await select(p); $('disc').scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); $('mold').focus({ preventScroll: true }); }
function controls() {
  const todo = photos.filter(q => !q.cut).length;
  $('crop').hidden = !!current?.cut; $('crop').disabled = busy;
  $('all').hidden = !todo || (!!current && !current.cut && todo === 1 && !run); $('all').disabled = busy;
  $('all').textContent = run ? `Cropping ${run.i} of ${run.n}…` : `Crop all ${todo}`;
  $('flip').hidden = !current?.cut || busy; $('flip').textContent = current?.show === 'photo' ? 'Show the disc' : 'Show the photo';
  $('adds').classList.toggle('one', !matchMedia('(pointer:coarse)').matches);
}
function setBusy(on) { busy = on; bag(); }

async function select(p) {
  if (busy) return;
  current = p; thumbs(); panel(); witness(p);
  if (!p.img) p.img = await image(p.meta.file);
  caption(p); $('cap').textContent = '';
  if (p.cut) { steps(['coarse', 'fine', 'join', 'unwarp'], p); showDisc(p); }
  else { steps([], p); draw({ p }); }
  setBusy(false);
}
async function crop(p, speed) {
  setBusy(true); current = p; p.show = 'disc'; thumbs(); panel(); $('cap').textContent = '';
  try { if (!p.img) p.img = await image(p.meta.file); await play(p, speed); }
  catch (error) { $('cap').textContent = `Could not crop ${p.label}: ${error.message}`; console.error(error); }
  finally { setBusy(false); }
}
async function cropAll(list) {
  run = { i: 0, n: list.length };
  try { for (const p of list) { run.i++; controls(); await crop(p, 2.4); if (!p.cut) break; } }
  finally { run = null; setBusy(false); }
}
$('crop').onclick = () => crop(current, 1);
$('all').onclick = () => cropAll(photos.filter(p => !p.cut));
$('flip').onclick = () => { current.show = current.show === 'photo' ? 'disc' : 'photo'; showDisc(current); controls(); };

// ---- your own photos: straighten by EXIF, shrink to 1600 px on the long side (like the samples), join the strip ----
async function prepare(file) {
  let src = null, w = 0, h = 0;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; } catch { src = null; }
  if (!src) { // browsers orient an <img> by its EXIF on their own
    const url = URL.createObjectURL(file);
    try { src = await image(url); w = src.naturalWidth; h = src.naturalHeight; } finally { URL.revokeObjectURL(url); }
  }
  if (!w || !h) throw Error('empty image');
  const k = Math.min(1, 1600 / Math.max(w, h)), c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); src.close?.();
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.92));
  if (!blob) throw Error('could not re-encode');
  return URL.createObjectURL(blob);
}
async function addFiles(files) {
  const fresh = [], bad = [];
  for (const f of files) {
    try {
      const url = await prepare(f), n = ++uploads;
      const p = { meta: { name: `Upload-${n}`, file: url }, label: f.name.replace(/\.[^.]+$/, '') || `Photo ${n}`, img: null, result: null, ms: 0, mold: null, cut: null, show: 'disc' };
      photos.push(p); mkThumb(p); fresh.push(p);
    } catch { bad.push(f.name); }
  }
  $('cap').textContent = bad.length ? `Could not read ${bad.join(', ')}. Try a JPEG or PNG.` : '';
  if (!fresh.length) return;
  bag();
  if (busy) return;
  await select(fresh[0]);
  await cropAll(fresh);
}
$('add-btn').onclick = () => $('add').click();
$('cam-btn').onclick = () => $('cam').click();
for (const id of ['add', 'cam']) $(id).onchange = e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) addFiles(f); };

$('make').onclick = async () => {
  const discs = ready().map(p => ({ id: `photo-${p.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, mold: p.mold.id, name: p.mold.mold, manufacturer: p.mold.manufacturer,
    plastic: p.mold.id === p.meta.mold ? p.meta.plastic ?? null : null, src: p.cut.src }));
  let handoff;
  await loadCatalog();
  try { handoff = enter('thro/bag/handoff', [{ name: 'bag', discs, moldRecord: molds.moldRecord, save: saveBag }]); }
  catch (error) { $('status').textContent = `Could not hand the discs over: ${error.message}`; return; }
  if (handoff.selfGuaranteeStatus !== 'PASS') { $('status').textContent = `Hand-off guarantees failed: ${Object.values(handoff.guarantees).filter(g => !g.passed).map(g => g.id).join(', ')}`; return; }
  // In the production layout index.html is the ask page and the editor is editor.html; in a plain build the editor is index.html.
  const editor = /ask\.mjs/.test(await fetch('./index.html').then(r => r.text()).catch(() => '')) ? './editor.html' : './index.html';
  location.href = `${editor}?bag=photos`;
};

// ---- start ----
function mkThumb(p) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.setAttribute('aria-label', `Photo: ${p.label}`); b.dataset.state = 'raw';
  b.innerHTML = `<img alt="" src="${p.meta.file}" loading="lazy"><canvas width="150" height="200"></canvas><span class="tag"></span>`;
  b.onclick = () => select(p); p.el = b; $('strip').append(b);
}
photos.forEach(mkThumb);
const start = photos.find(p => p.meta.name === 'IMG_6165') ?? photos[0];
size(); await select(start);
if (new URLSearchParams(location.search).has('auto')) $('all').click();
