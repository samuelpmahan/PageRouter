// Card revision 2, laid out for a 30-second look (rung 9; Sam: "waiting on an answer is how you become a waiter" — an open
// decision gets every alternative built and measured, with the evidence in front of the person who decides).
// For each prepared disc and each of the 11 Single layouts, the card is drawn under both values of the site's decision
// thro.card.revision, by the real renderer. Identical pixels are proven (the PNG bytes are compared), not asserted; each card
// carries its measured reading order and the Final demonstration's Thus line from a real world run. The decision control only
// records Sam's answer in this browser; it changes nothing on the site and merges nothing.
// The workspace is opened fresh from the prepared samples in memory, under its own key and lock: saved work is never touched.
import { loadFixture } from './prepared-fixture.mjs';
import { openWorkspace } from './workspace.mjs';
import { nativeStudies, nativeDesign, nativeCardRequest, useSiteCardRevision, cardRevisions } from './native-cards.mjs';
import { createThroWorld, screen, guarantees, readingOf, measuredOrder, hierarchyVerdict, photoDefinition, SITE_FILL } from './thro-world.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FILL = { 1: 'thro.card.revision/discstudio-6.6.1', 2: 'thro.card.revision/thro-r2' };
const PART = { disc: 'disc', name: 'name', numbers: 'numbers', other: 'rest' };
const memoryStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
// Crop both revisions of a card to the same rectangle: every measured part of either drawing, padded (frame pixels).
function cropBox(layouts, width, height) {
  const boxes = layouts.flatMap(l => [l.photo, l.name, l.numbers, ...(l.other ?? [])]).filter(b => b && Number.isFinite(b.x));
  const pad = 56, x0 = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad), y0 = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad);
  const x1 = Math.min(width, Math.max(...boxes.map(b => b.x + b.w)) + pad), y1 = Math.min(height, Math.max(...boxes.map(b => b.y + b.h)) + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
async function crop(src, box) {
  const img = new Image(); img.src = src; await img.decode();
  const scale = Math.min(1, 720 / box.w), canvas = document.createElement('canvas');
  canvas.width = Math.round(box.w * scale); canvas.height = Math.round(box.h * scale);
  canvas.getContext('2d').drawImage(img, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
const pngOf = svg => /href=["'](data:image\/png;base64,[^"']+)/.exec(svg)?.[1] ?? null;

// ---- The decision: recorded in this browser only.
const KEY = 'thro-revision-review';
const recorded = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
function paintDecision() {
  const r = recorded();
  document.querySelectorAll('[data-choice]').forEach(b => b.setAttribute('aria-pressed', String(r?.choice === b.dataset.choice)));
  $('#recorded').textContent = r ? `Recorded in this browser ${new Date(r.at).toLocaleString()}. It changes nothing on the site; the merge is still a separate step.` : 'Nothing recorded yet. Your answer stays in this browser; it changes nothing on the site.';
}
document.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => { try { localStorage.setItem(KEY, JSON.stringify({ choice: b.dataset.choice, at: Date.now() })); } catch { /* per page */ } paintDecision(); });
paintDecision();

async function main() {
  const status = $('#progress');
  const fixture = await loadFixture();
  const workspace = await openWorkspace({ storage: memoryStorage(), locks: navigator.locks, fixture, key: 'thro.review:prepared-samples' });
  const model = workspace.model, adapter = await import('./vendor/discstudio-cards/thro-adapter.mjs'), world = createThroWorld();
  const discs = [];
  for (const row of await model.shelfForDisplay()) { const disc = model.value(row.address); discs.push({ disc, resolved: model.experience.resolve(disc), record: fixture.find(f => `ds.px.seed.${f.mold}` === disc.mold && (f.plastic ?? null) === (disc.plastic ?? null)) }); }
  const total = discs.length * nativeStudies.length * 2; let done = 0;
  const results = [];
  for (const study of [...nativeStudies].sort((a, b) => (b.preset in cardRevisions) - (a.preset in cardRevisions))) {
    const section = document.createElement('section'); section.className = 'layout'; section.id = study.preset;
    section.innerHTML = `<h2>${esc(study.name.replace(/^[A-Z0-9-]+ · /, ''))} <small>${esc(study.preset.toUpperCase())}</small> <span class="same" hidden></span></h2><div class="discs"></div>`;
    $('#layouts').append(section);
    let identical = true;
    for (const { disc, resolved, record } of discs) {
      const pair = {};
      for (const revision of [1, 2]) {
        useSiteCardRevision(revision);
        const design = nativeDesign(model.context.design, study.id);
        const result = await adapter.renderDiscStudioCard(nativeCardRequest({ disc, resolved, design }));
        const layout = result.layout, reading = readingOf(layout, resolved.name, ['speed', 'glide', 'turn', 'fade'].map(f => resolved[f] ?? null));
        const def = photoDefinition(record);
        const run = screen(world, { disc: { id: disc.id, mold: disc.mold, plastic: disc.plastic ?? null, weight: disc.weight ?? null },
          facts: { name: resolved.name, manufacturer: resolved.manufacturer, speed: resolved.speed ?? null, glide: resolved.glide ?? null, turn: resolved.turn ?? null, fade: resolved.fade ?? null },
          design, photo: def?.sha256 ?? '0'.repeat(64), layout, photos: [def] }, { ...SITE_FILL, 'thro.card.revision': FILL[revision] });
        const final = guarantees(world, run).find(g => g.cause === 'final');
        pair[revision] = { png: pngOf(result.svg), layout, size: [result.width, result.height], drew: result.revision ?? 1, order: measuredOrder(reading), scaffold: hierarchyVerdict(layout).accepted, thus: final.demonstration.thus, portrait: study.orientation === 'portrait' };
        status.textContent = `Drawing ${++done} of ${total}…`;
      }
      const same = pair[1].png !== null && pair[1].png === pair[2].png; // the full PNG bytes, before any cropping for display
      const box = cropBox([pair[1].layout, pair[2].layout], ...pair[2].size);
      for (const r of [1, 2]) pair[r].shown = await crop(pair[r].png, box);
      identical &&= same;
      results.push({ layout: study.preset, disc: resolved.name, same, drew: [pair[1].drew, pair[2].drew], scaffold: [pair[1].scaffold, pair[2].scaffold] });
      const card = r => `<figure class="card"><img alt="" src="${r.shown}"><figcaption><span class="order">${r.order.map((p, i) => `<i>${i + 1}</i>${PART[p]}`).join(' ')}</span><span class="thus">${esc(r.thus)}</span></figcaption></figure>`;
      section.querySelector('.discs').insertAdjacentHTML('beforeend', `<div class="disc ${same ? 'same' : 'differs'}"><h3>${esc(resolved.manufacturer)} ${esc(resolved.name)}</h3>${same
        ? `<div class="pair one"><div class="col"><p class="rev">1 = 2 <small>same PNG bytes</small></p>${card(pair[2])}</div></div>`
        : `<div class="pair"><div class="col"><p class="rev">1</p>${card(pair[1])}</div><div class="col"><p class="rev">2</p>${card(pair[2])}</div></div>`}</div>`);
    }
    const badge = section.querySelector('.same'); badge.hidden = false;
    badge.textContent = identical ? '1 = 2 for every disc' : 'revision 2 changes this layout'; badge.className = `same ${identical ? '' : 'changes'}`;
    if (identical) section.classList.add('collapsed');
  }
  useSiteCardRevision(2);
  const changed = [...new Set(results.filter(r => !r.same).map(r => r.layout))];
  status.textContent = `${total} cards drawn. Revision 2 changes ${changed.map(c => c.toUpperCase()).join(' and ') || 'nothing'}; the other ${nativeStudies.length - changed.length} layouts are the same PNG bytes for every disc.`;
  window.__review = { done: true, results, changed };
}
main().catch(error => { $('#progress').textContent = `Could not draw the cards: ${error.message}`; window.__review = { done: true, error: String(error) }; });
