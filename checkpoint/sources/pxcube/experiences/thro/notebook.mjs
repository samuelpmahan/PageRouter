// thro engineering notebook, page 1: a datasheet for one Calculation, "where are the card's pixels" (Sam, 23 Oct: "standardized,
// replaceable parts … if you can re-implement it so that it replicates exactly in a faster time, keep it … if you add a corner
// case, you remeasure"). One Part definition, three implementations, one gauge, measured live in this browser: every card is drawn
// by the real renderer, A and B scan the same decoded pixels, C is what the renderer reports without a decode. Nothing here is
// typed in; the only premises are the two editable numbers that set C's tolerance.
// The workspace is opened fresh from the prepared samples in memory, under its own key: saved work is never touched.
import { loadFixture } from './prepared-fixture.mjs';
import { openWorkspace } from './workspace.mjs';
import { nativeStudies, nativeDesign, nativeCardRequest } from './native-cards.mjs';
import { alphaBounds as boundsA } from './preview-frame.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const memoryStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const ms = x => `${x < 1 ? x.toFixed(2) : x.toFixed(1)} ms`;
const pngOf = svg => /href=["'](data:image\/png;base64,[^"']+)/.exec(svg)?.[1] ?? null;

// The Part: { x, y, w, h }, half-open, canvas pixels. Each vendor's fitting, adapted to it.
const fit = {
  A: b => (b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null),
  B: b => (b ? { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] } : null),
  C: b => (b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null),
};
const edges = b => [b.x, b.y, b.x + b.w, b.y + b.h];
const exact = (p, q) => p && q && edges(p).every((v, i) => v === edges(q)[i]);
const worstEdge = (p, q) => (p && q ? Math.max(...edges(p).map((v, i) => Math.abs(v - edges(q)[i]))) : Infinity);

// Premises for C's tolerance: one screen pixel at the close-up's zoom. The zoom was measured on iter-43 at Sam's 1540×784
// window (the preview shows 1.172 screen pixels per canvas pixel; 1280×900: 1.056; 390 phone: 0.551).
// Three channels, one vote per card (Sam, 23 Oct: "why do they need three sensors and not just two"). With two that disagree you
// know something is wrong but not which; with three, the two that agree outvote the third. A and B share the decode of the PNG
// (a common mode: for any fault before the scan they are one channel); C is the dissimilar channel, the renderer's own report.
function vote(r, T) {
  const ab = exact(r.a, r.b), ac = worstEdge(r.c, r.a) <= T, bc = worstEdge(r.c, r.b) <= T;
  if (ab && ac && bc) return { tag: '3 of 3 agree', ok: true };
  if (ab) return { tag: 'C outvoted by A and B', ok: false, out: 'C' };
  if (ac) return { tag: 'B outvoted by A and C', ok: false, out: 'B' };
  if (bc) return { tag: 'A outvoted by B and C', ok: false, out: 'A' };
  return { tag: 'no majority', ok: false, out: '?' };
}
const tol = () => { const v = Number($('#tol').value); return Number.isFinite(v) && v >= 0 ? v : 0; };

async function main() {
  const progress = $('#progress');
  const sticker = await import('./vendor/discstudio-cards/sticker-raster.mjs?v=28ac2b39fab85255');
  const fixture = await loadFixture();
  const workspace = await openWorkspace({ storage: memoryStorage(), locks: navigator.locks, fixture, key: 'thro.notebook:prepared-samples' });
  const model = workspace.model, adapter = await import('./vendor/discstudio-cards/thro-adapter.mjs');
  const discs = [];
  for (const row of await model.shelfForDisplay()) { const disc = model.value(row.address); discs.push({ disc, resolved: model.experience.resolve(disc) }); }
  const placements = [['as laid out', d => d], ['moved 120, −60', d => ({ ...d, nativeNudge: { x: 120, y: -60 } })], ['sized 100%', d => ({ ...d, nativeScale: 1 })]];
  const total = discs.length * nativeStudies.length * placements.length; let done = 0;
  const rows = [];
  for (const study of nativeStudies) for (const { disc, resolved } of discs) for (const [placement, place] of placements) {
    const design = place(nativeDesign(model.context.design, study.id));
    const result = await adapter.renderDiscStudioCard(nativeCardRequest({ disc, resolved, design }));
    const src = pngOf(result.svg), W = result.width, H = result.height;
    // Read the pixels back once; A and B scan the same bytes.
    let t = performance.now();
    const img = new Image(); img.src = src; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, W, H); const readback = performance.now() - t;
    t = performance.now(); const a = fit.A(boundsA(pixels)); const scanA = performance.now() - t;
    t = performance.now(); let b; try { b = fit.B(sticker.alphaBounds(pixels.data, W, H)); } catch { b = null; } const scanB = performance.now() - t;
    const c = fit.C(result.layout?.card ?? null);
    rows.push({ layout: study.preset, name: study.name, disc: resolved.name, placement, W, H, src, a, b, c, readback, scanA, scanB });
    progress.textContent = `Drawing and measuring card ${++done} of ${total}…`;
  }
  window.__notebook = { rows: rows.map(({ src, ...r }) => r) };
  paint(rows);
  $('#tol').addEventListener('input', () => paint(rows));
  progress.textContent = `${total} cards drawn by the real renderer and measured in this browser (${navigator.hardwareConcurrency ?? '?'} logical cores).`;
  window.__notebook.done = true;
}

function paint(rows) {
  const T = tol();
  $('#tolwhy').innerHTML = `Why ${T} canvas pixels: C places the drag outline and frames the close-up. At your 1540×784 window the close-up shows <b>1.172</b> screen pixels per canvas pixel (measured on iter-43), so ${T} canvas pixels is <b>${(T * 1.172).toFixed(2)}</b> screen pixels there. Change the number and every verdict below is recomputed.`;
  const n = rows.length;
  const abExact = rows.filter(r => exact(r.a, r.b)).length;
  const cWorst = Math.max(...rows.map(r => worstEdge(r.c, r.a)));
  const cWithin = rows.filter(r => worstEdge(r.c, r.a) <= T).length;
  const cExact = rows.filter(r => exact(r.c, r.a)).length;
  const verdict = ok => `<span class="${ok ? 'pass' : 'fail'}">${ok ? 'passes' : 'fails'}</span>`;
  $('#results tbody').innerHTML = [
    `<tr><td><span class="sw a"></span>A</td><td>${n} of ${n} by definition (it is the reference scan)</td><td class="num">0</td><td class="num">${ms(median(rows.map(r => r.scanA)))} scan</td><td>${verdict(true)}</td></tr>`,
    `<tr><td><span class="sw b"></span>B</td><td>${abExact} of ${n} exactly equal to A</td><td class="num">${Math.max(...rows.map(r => worstEdge(r.b, r.a)))}</td><td class="num">${ms(median(rows.map(r => r.scanB)))} scan</td><td>${verdict(abExact === n)}</td></tr>`,
    `<tr><td><span class="sw c"></span>C</td><td>${cExact} of ${n} exactly; ${cWithin} of ${n} within ${T}</td><td class="num">${cWorst.toFixed(1)}</td><td class="num">0 (no decode)</td><td>${verdict(cWithin === n)} at ${T}</td></tr>`,
  ].join('');
  const votes = rows.map(r => vote(r, T)), unanimous = votes.filter(v => v.ok).length;
  const outvoted = ['A', 'B', 'C', '?'].map(k => [k, votes.filter(v => v.out === k).length]).filter(([, n]) => n);
  $('#readback').innerHTML = `A and B each also need the PNG decoded and read back: <b>${ms(median(rows.map(r => r.readback)))}</b> per card (median), which C never pays.</p>
    <p><b>The vote, card by card:</b> ${unanimous} of ${n} cards 3 of 3${outvoted.length ? `; ${outvoted.map(([k, m]) => (k === '?' ? `${m} with no majority` : `${k} outvoted on ${m}`)).join(', ')}` : ''}. <span class="${unanimous === n ? 'pass' : 'fail'}">${unanimous === n ? '✓' : '✗'}</span>
    A and B share the decode, so for a fault before the scan (a wrong decode, a wrong canvas size) they are one channel and agree with each other while both are wrong; only C, which never decodes, would outvote them there. For a fault in the scan itself they are two independent channels.`;
  // Which way C is off: outside the pixels (outline a little loose) or inside (outline cuts the card).
  const inside = rows.filter(r => r.c && r.a && (r.c.x > r.a.x || r.c.y > r.a.y || r.c.x + r.c.w < r.a.x + r.a.w || r.c.y + r.c.h < r.a.y + r.a.h)).length;
  const worst = rows.reduce((p, r) => (worstEdge(r.c, r.a) > worstEdge(p.c, p.a) ? r : p), rows[0]);
  $('#demo').innerHTML = `<p><b>This is for</b> putting the drag outline and the close-up frame where the card's pixels are, on every tap, without delaying the tap.</p>
    <p><b>Because</b> A and B read the finished PNG back (${ms(median(rows.map(r => r.readback)))} per card here, more on a phone) while C is reported by the renderer from the scan it already does to place the card.</p>
    <p><b>It does</b>: B equals A on ${abExact} of ${n} cards, so the two scanners are interchangeable once their fittings are adapted (inclusive versus exclusive end, null versus throw). C is within ${cWorst.toFixed(1)} canvas pixels of A on every card (worst: ${esc(worst.disc)} in ${esc(worst.layout.toUpperCase())}, ${esc(worst.placement)}); on ${inside} of ${n} cards it sits inside the pixels on some edge.</p>
    <p><b>Thus</b> ${cWithin === n ? `C may stand in for A wherever ${T} canvas pixels (${(T * 1.172).toFixed(2)} screen pixels at your window) is tolerable, which is the editor and the close-up; A or B stay the part to use wherever the exact pixels matter, such as cropping a sticker.` : `C may <b>not</b> stand in for A at ${T} canvas pixels: ${n - cWithin} cards fall outside. Either widen the tolerance with a reason, or make C exact.`} <span class="${cWithin === n ? 'pass' : 'fail'}">${cWithin === n ? 'QED' : 'not shown'}</span></p>`;
  $('#cards').innerHTML = rows.map(r => {
    const u = [r.a, r.c].filter(Boolean), x0 = Math.max(0, Math.min(...u.map(b => b.x)) - 24), y0 = Math.max(0, Math.min(...u.map(b => b.y)) - 24);
    const x1 = Math.min(r.W, Math.max(...u.map(b => b.x + b.w)) + 24), y1 = Math.min(r.H, Math.max(...u.map(b => b.y + b.h)) + 24);
    const rect = (b, cls) => (b ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="${cls}"/>` : '');
    const d = worstEdge(r.c, r.a);
    return `<figure><div class="pic" style="aspect-ratio:${x1 - x0}/${y1 - y0}"><img alt="" style="width:${(100 * r.W / (x1 - x0)).toFixed(3)}%;margin-left:${(-100 * x0 / (x1 - x0)).toFixed(3)}%;margin-top:${(-100 * y0 / (x1 - x0)).toFixed(3)}%" src="${r.src}">
      <svg viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" preserveAspectRatio="none" aria-hidden="true"><g fill="none" vector-effect="non-scaling-stroke">${rect(r.a, 'a')}${rect(r.b, 'b')}${rect(r.c, 'c')}</g></svg></div>
      <figcaption><span class="t">${esc(r.disc)} · ${esc(r.layout.toUpperCase())} · ${esc(r.placement)}</span><span class="d">${(v => `<span class="${v.ok ? 'pass' : 'fail'}">${v.tag}</span>`)(vote(r, T))} · C off by ${d.toFixed(1)} px</span></figcaption></figure>`;
  }).join('');
}
const style = document.createElement('style');
style.textContent = 'figure svg .a{stroke:#c8f49d;stroke-width:2.5px}figure svg .b{stroke:#ffd166;stroke-width:2px;stroke-dasharray:8 6}figure svg .c{stroke:#ff7ab6;stroke-width:2px;stroke-dasharray:2 4}figure svg rect{vector-effect:non-scaling-stroke}';
document.head.append(style);
main().catch(error => { $('#progress').textContent = `Could not measure: ${error.message}`; window.__notebook = { done: true, error: String(error) }; });
